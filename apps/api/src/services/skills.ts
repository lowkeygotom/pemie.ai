// Catálogo de skills por proyecto (docs/skills-catalog.md): un agente publica
// el contenido canónico de una skill y otro agente (o persona) la instala en
// su runtime eligiendo destino. `files[].path` es lo único que este servicio
// deja escribir en el disco de quien instala, así que se valida tanto al
// publicar como al servir el paquete instalable (ver isSafeSkillFilePath).

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  isSafeSkillFilePath,
  isValidSkillSlug,
  resolveSkillRootPath,
  SKILL_DESTINATIONS,
  SKILL_ENTRY_FILE,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_TARGETS,
  type SkillDestination,
  type SkillFile,
  type SkillTarget,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

/** Quién publica: usuario autenticado (REST) o agente vía MCP. */
export interface SkillActor {
  type: "user" | "agent";
  id: string | null;
}

export interface PublishSkillInput {
  slug: string;
  name: string;
  description: string;
  files: SkillFile[];
}

/**
 * Hash canónico del contenido: paths ordenados antes de serializar para que
 * reordenar `files` en el publish no cuente como un cambio de contenido.
 */
function hashFiles(files: SkillFile[]): string {
  const canonical = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => ({ path: f.path, content: f.content }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Valida forma, paths y tamaño de `files`. Lanza el primer error encontrado. */
function validateFiles(files: SkillFile[]) {
  if (!Array.isArray(files) || files.length === 0)
    throw badRequest("La skill no tiene archivos", "empty_files");
  if (files.length > SKILL_MAX_FILES)
    throw badRequest(`Demasiados archivos (máx ${SKILL_MAX_FILES})`, "too_many_files");
  if (!files.some((f) => f.path === SKILL_ENTRY_FILE))
    throw badRequest(`Falta ${SKILL_ENTRY_FILE}`, "missing_skill_md");

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!isSafeSkillFilePath(file.path))
      throw badRequest(`Path de archivo inválido: ${file.path}`, "invalid_path");
    if (seen.has(file.path)) throw badRequest(`Path duplicado: ${file.path}`, "invalid_path");
    seen.add(file.path);
    totalBytes += Buffer.byteLength(file.content, "utf8");
  }
  if (totalBytes > SKILL_MAX_TOTAL_BYTES)
    throw badRequest(`La skill supera el límite de ${SKILL_MAX_TOTAL_BYTES} bytes`, "skill_too_large");
}

// ─── Lectura ───────────────────────────────────────────────────────────────

/** Lista las skills del proyecto, sin `files` (viewer+). */
export async function listSkills(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListSkills(projectId);
}

/** Operación (ya autorizada): summaries ordenados por actualización reciente. */
export function opListSkills(projectId: string) {
  return prisma.projectSkill.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      name: true,
      description: true,
      version: true,
      publishedByType: true,
      updatedAt: true,
    },
  });
}

export interface GetSkillOptions {
  target: SkillTarget;
  destination: SkillDestination;
}

/** Paquete instalable de una skill para un runtime/destino dados (viewer+). */
export async function getSkill(userId: string, projectId: string, slug: string, opts: GetSkillOptions) {
  await projectWithAccess(userId, projectId);
  return opGetSkill(projectId, slug, opts);
}

/** Operación (ya autorizada): arma el paquete instalable. Ver `getSkill`. */
export async function opGetSkill(projectId: string, slug: string, opts: GetSkillOptions) {
  if (!SKILL_TARGETS.includes(opts.target))
    throw badRequest(`target inválido: ${opts.target}`, "invalid_target");
  if (!SKILL_DESTINATIONS.includes(opts.destination))
    throw badRequest(`destination inválido: ${opts.destination}`, "invalid_destination");

  const skill = await prisma.projectSkill.findUnique({ where: { projectId_slug: { projectId, slug } } });
  if (!skill) throw notFound("Skill no encontrada");

  const files = skill.files as unknown as SkillFile[];
  // Los paths ya se validaron al publicar, pero esto es lo único que un agente
  // escribe en disco: si un dato llegó por otra vía (seed, migración, edición
  // directa) con un path inseguro, se corta acá y no en el disco de quien instala.
  const unsafe = files.find((f) => !isSafeSkillFilePath(f.path));
  if (unsafe) throw badRequest(`La skill tiene un path inválido: ${unsafe.path}`, "invalid_path");

  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    publishedByType: skill.publishedByType,
    updatedAt: skill.updatedAt,
    install: {
      target: opts.target,
      destination: opts.destination,
      rootPath: resolveSkillRootPath(opts.target, opts.destination, skill.slug),
      files,
    },
    availableTargets: SKILL_TARGETS,
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────

/** Publica (crea o actualiza) una skill (member+). Idempotente por `contentHash`. */
export async function publishSkill(
  userId: string,
  projectId: string,
  input: PublishSkillInput,
  actor: SkillActor
) {
  await projectWithAccess(userId, projectId, "member");
  return opPublishSkill(projectId, input, actor);
}

/** Operación (ya autorizada): upsert por [projectId, slug]. Ver `publishSkill`. */
export async function opPublishSkill(projectId: string, input: PublishSkillInput, actor: SkillActor) {
  const slug = input.slug.trim();
  if (!isValidSkillSlug(slug)) throw badRequest("Slug inválido (usa kebab-case)", "invalid_slug");
  const name = input.name.trim();
  if (!name) throw badRequest("El nombre es obligatorio", "invalid_name");
  const description = input.description.trim();
  if (!description) throw badRequest("La descripción es obligatoria", "invalid_description");

  validateFiles(input.files);
  const contentHash = hashFiles(input.files);

  const existing = await prisma.projectSkill.findUnique({ where: { projectId_slug: { projectId, slug } } });

  if (existing && existing.contentHash === contentHash) {
    // Mismo contenido: solo se refresca metadata. La version NO sube — volver a
    // publicar sin cambios no debe inflar el historial de versiones.
    return prisma.projectSkill.update({
      where: { id: existing.id },
      data: { name, description, publishedByType: actor.type, publishedById: actor.id },
    });
  }

  return prisma.projectSkill.upsert({
    where: { projectId_slug: { projectId, slug } },
    update: {
      name,
      description,
      files: input.files as unknown as Prisma.InputJsonValue,
      contentHash,
      version: { increment: 1 },
      publishedByType: actor.type,
      publishedById: actor.id,
    },
    create: {
      projectId,
      slug,
      name,
      description,
      files: input.files as unknown as Prisma.InputJsonValue,
      contentHash,
      publishedByType: actor.type,
      publishedById: actor.id,
    },
  });
}
