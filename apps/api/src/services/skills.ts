// Catálogo de skills por workspace (docs/skills-catalog.md).
// El modelo decide *qué* publicar; el transporte de bytes es otra capa
// (tar.gz vía skill-transfer). Aquí vive validación, autorización y persistencia.

import { createHash, randomBytes } from "node:crypto";
import {
  isSafeSkillFilePath,
  isValidSkillSlug,
  resolveSkillRootPath,
  SKILL_DESTINATIONS,
  SKILL_DOWNLOAD_TTL_MS,
  SKILL_ENTRY_FILE,
  SKILL_INLINE_MAX_BYTES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_TARGETS,
  SKILL_UPLOAD_TTL_MS,
  type SkillDestination,
  type SkillFile,
  type SkillTarget,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, notFound } from "./errors.js";
import { requireMembership } from "./tenancy.js";
import { packSkillTarGz } from "./skill-archive.js";

/** Quién publica: usuario autenticado (REST) o agente vía MCP. */
export interface SkillActor {
  type: "user" | "agent";
  id: string | null;
}

export interface StartSkillUploadInput {
  slug: string;
  name: string;
  description: string;
}

/**
 * Hash canónico del contenido: paths ordenados antes de serializar para que
 * reordenar `files` en el publish no cuente como un cambio de contenido.
 */
export function hashFiles(files: SkillFile[]): string {
  const canonical = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => ({ path: f.path, content: f.content }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Valida slug/name/description; compartido por start upload (antes en opPublishSkill). */
export function validateSkillMeta(input: StartSkillUploadInput) {
  const slug = input.slug.trim();
  if (!isValidSkillSlug(slug)) throw badRequest("invalid_slug");
  const name = input.name.trim();
  if (!name) throw badRequest("invalid_name");
  const description = input.description.trim();
  if (!description) throw badRequest("invalid_description");
  return { slug, name, description };
}

/**
 * Acumula un AsyncIterable validando por entrada y abortando al cruzar límites
 * (misma defensa que el parser de tar: no materializar de más).
 */
export async function accumulateSkillFiles(
  source: AsyncIterable<SkillFile>
): Promise<{ files: SkillFile[]; totalBytes: number }> {
  const files: SkillFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for await (const file of source) {
    if (!isSafeSkillFilePath(file.path)) throw badRequest("invalid_path", { path: file.path });
    if (seen.has(file.path)) throw badRequest("duplicate_path", { path: file.path });
    seen.add(file.path);

    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > SKILL_MAX_FILE_BYTES)
      throw badRequest("file_too_large", { max: SKILL_MAX_FILE_BYTES, path: file.path });
    totalBytes += bytes;
    if (files.length + 1 > SKILL_MAX_FILES) throw badRequest("too_many_files", { max: SKILL_MAX_FILES });
    if (totalBytes > SKILL_MAX_TOTAL_BYTES)
      throw badRequest("skill_too_large", { max: SKILL_MAX_TOTAL_BYTES });

    files.push({ path: file.path, content: file.content });
  }

  if (files.length === 0) throw badRequest("empty_files");
  if (!files.some((f) => f.path === SKILL_ENTRY_FILE)) throw badRequest("missing_skill_md", { file: SKILL_ENTRY_FILE });

  return { files, totalBytes };
}

// ─── Lectura ───────────────────────────────────────────────────────────────

/** Lista las skills del workspace, sin archivos (viewer+). */
export async function listSkills(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  return opListSkills(workspaceId);
}

/** Operación (ya autorizada): summaries ordenados por actualización reciente. */
export function opListSkills(workspaceId: string) {
  return prisma.workspaceSkill.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      name: true,
      description: true,
      version: true,
      publishedByType: true,
      updatedAt: true,
      totalBytes: true,
    },
  });
}

export interface GetSkillOptions {
  target: SkillTarget;
  destination: SkillDestination;
  /** Origen público del API para construir downloadUrl absolutas. */
  apiBaseUrl: string;
}

/** Paquete instalable de una skill para un runtime/destino dados (viewer+). */
export async function getSkill(
  userId: string,
  workspaceId: string,
  slug: string,
  opts: GetSkillOptions
) {
  await requireMembership(userId, workspaceId);
  return opGetSkill(workspaceId, slug, opts);
}

/** Operación (ya autorizada): arma el paquete instalable. Ver `getSkill`. */
export async function opGetSkill(workspaceId: string, slug: string, opts: GetSkillOptions) {
  if (!SKILL_TARGETS.includes(opts.target)) throw badRequest("invalid_target", { target: opts.target });
  if (!SKILL_DESTINATIONS.includes(opts.destination))
    throw badRequest("invalid_destination", { destination: opts.destination });

  const skill = await prisma.workspaceSkill.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
    include: { files: { select: { path: true, content: true, bytes: true }, orderBy: { path: "asc" } } },
  });
  if (!skill) throw notFound("skill_not_found");

  // Los paths ya se validaron al publicar, pero esto es lo único que un agente
  // escribe en disco: si un dato llegó por otra vía (seed, migración) con un
  // path inseguro, se corta acá y no en el disco de quien instala.
  const unsafe = skill.files.find((f) => !isSafeSkillFilePath(f.path));
  if (unsafe) throw badRequest("unsafe_skill_path", { path: unsafe.path });

  const manifest = skill.files.map((f) => ({ path: f.path, bytes: f.bytes }));
  const rootPath = resolveSkillRootPath(opts.target, opts.destination, skill.slug);
  const base = {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    publishedByType: skill.publishedByType as "user" | "agent",
    updatedAt: skill.updatedAt,
    install: {
      target: opts.target,
      destination: opts.destination,
      rootPath,
      manifest,
      totalBytes: skill.totalBytes,
    },
    availableTargets: SKILL_TARGETS,
  };

  if (skill.totalBytes <= SKILL_INLINE_MAX_BYTES) {
    return {
      ...base,
      install: {
        ...base.install,
        files: skill.files.map((f) => ({ path: f.path, content: f.content })),
      },
    };
  }

  const { downloadUrl, command } = await mintDownloadTicket(skill.id, skill.slug, opts.apiBaseUrl);
  return {
    ...base,
    install: {
      ...base.install,
      downloadUrl,
      command,
    },
  };
}

async function mintDownloadTicket(skillId: string, slug: string, apiBaseUrl: string) {
  // Purga oportunista: sin cron, mismo criterio de minimalismo del resto del repo.
  await prisma.skillDownload.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const rawToken = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SKILL_DOWNLOAD_TTL_MS);
  await prisma.skillDownload.create({
    data: { skillId, tokenHash: hashToken(rawToken), expiresAt },
  });

  const downloadUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/skill-downloads/${rawToken}`;
  const command = `mkdir -p "${slug}" && curl -sL "${downloadUrl}" | tar xz -C "${slug}"`;
  return { downloadUrl, command, expiresAt };
}

// ─── Upload (publish en dos pasos) ─────────────────────────────────────────

/** Crea el ticket de upload (member+). El contenido llega después por PUT. */
export async function startSkillUpload(
  userId: string,
  workspaceId: string,
  input: StartSkillUploadInput,
  actor: SkillActor,
  apiBaseUrl: string
) {
  await requireMembership(userId, workspaceId, "member");
  return opStartSkillUpload(workspaceId, input, actor, apiBaseUrl);
}

/** Operación (ya autorizada): crea SkillUpload y devuelve el ticket. */
export async function opStartSkillUpload(
  workspaceId: string,
  input: StartSkillUploadInput,
  actor: SkillActor,
  apiBaseUrl: string
) {
  const { slug, name, description } = validateSkillMeta(input);
  const rawToken = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SKILL_UPLOAD_TTL_MS);

  await prisma.skillUpload.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.skillUpload.create({
    data: {
      workspaceId,
      slug,
      name,
      description,
      tokenHash: hashToken(rawToken),
      actorType: actor.type,
      actorId: actor.id,
      expiresAt,
    },
  });

  const uploadUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/skill-uploads/${rawToken}`;
  // COPYFILE_DISABLE evita que el tar de macOS meta sidecars AppleDouble
  // (._archivo); uno de esos cae en la raíz del paquete y rompe el strip de
  // prefijo común en parseSkillTarGz (SKILL.md deja de encontrarse).
  const command = `COPYFILE_DISABLE=1 tar czf - -C <dir-padre> ${slug} | curl --upload-file - "${uploadUrl}"`;
  return {
    uploadUrl,
    expiresAt: expiresAt.toISOString(),
    command,
    slug,
    name,
    description,
  };
}

/**
 * Consume el ticket (un solo uso) y persiste la skill.
 * `source` es agnóstico de HTTP: tar parseado o partes multipart.
 */
export async function opCompleteSkillUpload(rawToken: string, source: AsyncIterable<SkillFile>) {
  const tokenHash = hashToken(rawToken);
  const draft = await prisma.skillUpload.findUnique({ where: { tokenHash } });
  if (!draft) throw notFound("upload_ticket_not_found");
  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.skillUpload.delete({ where: { id: draft.id } }).catch(() => undefined);
    throw badRequest("upload_expired");
  }

  // Un solo uso: se borra al consumirlo, antes de parsear el cuerpo completo,
  // para que un reintento paralelo no publique dos veces el mismo ticket.
  await prisma.skillUpload.delete({ where: { id: draft.id } });

  const { files, totalBytes } = await accumulateSkillFiles(source);
  const contentHash = hashFiles(files);
  const actor = { type: draft.actorType as "user" | "agent", id: draft.actorId };

  return persistSkillFiles({
    workspaceId: draft.workspaceId,
    slug: draft.slug,
    name: draft.name,
    description: draft.description,
    files,
    totalBytes,
    contentHash,
    actor,
  });
}

async function persistSkillFiles(input: {
  workspaceId: string;
  slug: string;
  name: string;
  description: string;
  files: SkillFile[];
  totalBytes: number;
  contentHash: string;
  actor: SkillActor;
}) {
  const existing = await prisma.workspaceSkill.findUnique({
    where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: input.slug } },
  });

  if (existing && existing.contentHash === input.contentHash) {
    // Mismo contenido: solo se refresca metadata. La version NO sube — volver a
    // publicar sin cambios no debe inflar el historial de versiones.
    return prisma.workspaceSkill.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        publishedByType: input.actor.type,
        publishedById: input.actor.id,
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    const skill = await tx.workspaceSkill.upsert({
      where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: input.slug } },
      update: {
        name: input.name,
        description: input.description,
        contentHash: input.contentHash,
        totalBytes: input.totalBytes,
        version: { increment: 1 },
        publishedByType: input.actor.type,
        publishedById: input.actor.id,
      },
      create: {
        workspaceId: input.workspaceId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        contentHash: input.contentHash,
        totalBytes: input.totalBytes,
        publishedByType: input.actor.type,
        publishedById: input.actor.id,
      },
    });

    await tx.workspaceSkillFile.deleteMany({ where: { skillId: skill.id } });
    if (input.files.length > 0) {
      await tx.workspaceSkillFile.createMany({
        data: input.files.map((f) => ({
          skillId: skill.id,
          path: f.path,
          content: f.content,
          bytes: Buffer.byteLength(f.content, "utf8"),
        })),
      });
    }
    return skill;
  });
}

// ─── Archive de bajada ─────────────────────────────────────────────────────

/** Resuelve un token de descarga y arma el stream tar.gz (multi-uso dentro del TTL). */
export async function opBuildSkillArchiveByToken(rawToken: string) {
  const row = await prisma.skillDownload.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { skill: true },
  });
  if (!row) throw notFound("download_token_not_found");
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.skillDownload.delete({ where: { id: row.id } }).catch(() => undefined);
    throw badRequest("download_expired");
  }
  return opBuildSkillArchive(row.skill.workspaceId, row.skill.slug);
}

/**
 * Arma el tar.gz leyendo archivos en páginas para no cargar 8 MiB de una vez
 * en un solo array si la skill es grande.
 */
export async function opBuildSkillArchive(workspaceId: string, slug: string) {
  const skill = await prisma.workspaceSkill.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
  });
  if (!skill) throw notFound("skill_not_found");

  const PAGE = 50;
  async function* pages() {
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.workspaceSkillFile.findMany({
        where: { skillId: skill!.id },
        orderBy: { path: "asc" },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, path: true, content: true },
      });
      if (batch.length === 0) break;
      for (const row of batch) yield { path: row.path, content: row.content };
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < PAGE) break;
    }
  }

  return {
    slug: skill.slug,
    stream: packSkillTarGz(pages()),
  };
}

// ─── Borrado ───────────────────────────────────────────────────────────────

/** Hard delete de una skill (member+). Cascade limpia archivos y download tokens. */
export async function deleteSkill(userId: string, workspaceId: string, slug: string) {
  await requireMembership(userId, workspaceId, "member");
  return opDeleteSkill(workspaceId, slug);
}

export async function opDeleteSkill(workspaceId: string, slug: string) {
  const skill = await prisma.workspaceSkill.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
  });
  if (!skill) throw notFound("skill_not_found");
  await prisma.workspaceSkill.delete({ where: { id: skill.id } });
  return { ok: true as const, slug };
}
