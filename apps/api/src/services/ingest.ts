// Servicio de ingesta (F2): vincula repos de GitHub a proyectos y registra sus
// commits, clasificándolos por dominio. Alimentado por dos vías:
//   - webhooks push (tiempo real)      -> ingestPushEvent
//   - sincronización vía API (histórico) -> backfillRepo / backfillProject
// Toda operación se scopea por proyecto y verifica el rol del usuario.

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  classifyCommit,
  DEFAULT_DOMAIN_CONFIG,
  STATUS_COLUMN_ORDER,
  type DomainConfig,
  type Role,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { requireMembership } from "./tenancy.js";
import * as board from "./board.js";
import { fetchRecentCommits, githubAppConfigured } from "../lib/github-app.js";
import {
  fetchCommitsWithToken,
  GithubApiError,
  type NormalizedCommit,
} from "../lib/github-commits.js";
import { fetchUserRepos } from "../lib/github-oauth.js";

/** Carga un proyecto verificando que el usuario tenga `minRole` en su workspace. */
export async function projectWithAccess(userId: string, projectId: string, minRole: Role = "viewer") {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Proyecto no encontrado");
  await requireMembership(userId, project.workspaceId, minRole);
  return project;
}

/** Carga un repo (con su proyecto) verificando acceso del usuario. */
async function repoWithAccess(userId: string, repoId: string, minRole: Role = "viewer") {
  const repo = await prisma.repo.findUnique({ where: { id: repoId } });
  if (!repo) throw notFound("Repo no encontrado");
  await projectWithAccess(userId, repo.projectId, minRole);
  return repo;
}

// ─── Repos ───────────────────────────────────────────────────────────────

/**
 * Access token OAuth que el usuario concedió al iniciar sesión con GitHub. Es
 * la credencial con la que leemos sus repos y sus commits: hereda exactamente
 * los permisos que él autorizó, sin instalar nada en sus organizaciones.
 */
async function userGithubToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { accessToken: true },
  });
  if (!account?.accessToken)
    throw badRequest("Conecta tu cuenta de GitHub", "github_not_connected");
  return account.accessToken;
}

/** Lista los repos de GitHub del usuario (para el selector de vinculación). */
export async function listUserGithubRepos(userId: string) {
  return fetchUserRepos(await userGithubToken(userId));
}

export interface LinkRepoInput {
  owner: string;
  name: string;
  url?: string;
  externalId?: string;
  installationId?: string;
}

/** Vincula un repo de GitHub a un proyecto (member+). */
export async function linkRepo(userId: string, projectId: string, input: LinkRepoInput) {
  await projectWithAccess(userId, projectId, "member");
  const owner = input.owner.trim();
  const name = input.name.trim();
  if (!owner || !name) throw badRequest("Owner y nombre del repo son obligatorios", "invalid_repo");

  const existing = await prisma.repo.findUnique({
    where: { projectId_provider_owner_name: { projectId, provider: "github", owner, name } },
  });
  if (existing) throw conflict("Ese repo ya está vinculado al proyecto", "repo_exists");

  const repo = await prisma.repo.create({
    data: {
      projectId,
      provider: "github",
      owner,
      name,
      url: input.url?.trim() || `https://github.com/${owner}/${name}`,
      externalId: input.externalId ?? null,
      installationId: input.installationId ?? null,
    },
  });

  // Primera sincronización inmediata: vincular un repo y quedarse en cero
  // commits no comunica nada. Best effort — si GitHub falla, el repo queda
  // vinculado igual, pero el motivo viaja de vuelta para que la UI lo muestre
  // en vez de dejar un repo mudo en la lista.
  let ingested = 0;
  let syncError: string | null = null;
  try {
    ingested = (await syncRepoCommits(userId, repo)).ingested;
  } catch (err) {
    try {
      describeGithubFailure(err, `${owner}/${name}`);
    } catch (domainErr) {
      syncError = (domainErr as Error).message;
    }
  }

  return { repo, ingested, syncError };
}

/** Lista los repos vinculados a un proyecto, con conteo de commits (viewer+). */
export async function listRepos(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListRepos(projectId);
}

/** Operación (ya autorizada): lista los repos vinculados a un proyecto. */
export function opListRepos(projectId: string) {
  return prisma.repo.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      owner: true,
      name: true,
      url: true,
      installationId: true,
      createdAt: true,
      _count: { select: { commits: true } },
    },
  });
}

/** Desvincula un repo (member+). Elimina también sus commits por cascade. */
export async function unlinkRepo(userId: string, repoId: string) {
  const repo = await repoWithAccess(userId, repoId, "member");
  await prisma.repo.delete({ where: { id: repo.id } });
  return { ok: true };
}

// ─── Commits ─────────────────────────────────────────────────────────────

/**
 * Inserta commits normalizados en un repo: upsert de contribuidores,
 * clasificación por dominio e inserción idempotente vía `createMany` con
 * `skipDuplicates` (unique repoId+sha) — sin excepciones por duplicado, así los
 * webhooks re-entregados no ensucian los logs. Devuelve cuántos se registraron.
 */
async function recordCommits(
  repo: { id: string; projectId: string },
  commits: NormalizedCommit[]
): Promise<number> {
  const valid = commits.filter((c) => c.sha);
  if (valid.length === 0) return 0;

  const project = await prisma.project.findUnique({ where: { id: repo.projectId } });
  if (!project) return 0;
  const config = (project.domainConfig as DomainConfig | null) ?? DEFAULT_DOMAIN_CONFIG;

  // Upsert de contribuidores (login -> id), dedup por login dentro del batch.
  const contributorId = new Map<string, string>();
  for (const c of valid) {
    const login = (c.login || c.authorName || "desconocido").toString().trim() || "desconocido";
    if (contributorId.has(login)) continue;
    const contributor = await prisma.contributor.upsert({
      where: { projectId_githubLogin: { projectId: repo.projectId, githubLogin: login } },
      update: { name: c.authorName ?? undefined, avatarUrl: c.avatarUrl ?? undefined },
      create: { projectId: repo.projectId, githubLogin: login, name: c.authorName, avatarUrl: c.avatarUrl },
    });
    contributorId.set(login, contributor.id);
  }

  // Qué SHAs ya estaban registrados, *antes* de insertarlos: `createMany` informa
  // cuántos entraron, no cuáles, y el auto-move de abajo solo debe correr sobre lo
  // nuevo. Un sync "full" vuelve a traer el histórico entero, así que sin este
  // filtro se reaplicaban las reglas de palabras clave sobre commits viejos y las
  // tarjetas movidas a mano volvían a la columna que dictaba su commit original.
  const known = new Set(
    (
      await prisma.commit.findMany({
        where: { repoId: repo.id, sha: { in: valid.map((c) => c.sha) } },
        select: { sha: true },
      })
    ).map((c) => c.sha)
  );
  const fresh = valid.filter((c) => !known.has(c.sha));

  const { count } = await prisma.commit.createMany({
    data: valid.map((c) => {
      const login = (c.login || c.authorName || "desconocido").toString().trim() || "desconocido";
      return {
        projectId: repo.projectId,
        repoId: repo.id,
        contributorId: contributorId.get(login)!,
        sha: c.sha,
        message: c.message ?? "",
        domain: classifyCommit(c.message, config),
        committedAt: c.committedAt ?? new Date(),
      };
    }),
    skipDuplicates: true,
  });

  // Auto-mover cards del Kanban según palabras clave en el mensaje del commit
  // (ej. "PRJ-123 fix: ..." -> mueve la card de esa HU a Revisión). Solo commits
  // nuevos: re-sincronizar o una re-entrega del webhook no debe volver a mover
  // nada. Best effort: nunca debe hacer fallar la ingesta de commits.
  if (fresh.length > 0) {
    try {
      await autoMoveCardsFromCommits(repo.projectId, project.key, fresh);
    } catch (err) {
      console.error("auto-move de cards desde commits falló (best effort)", err);
    }
  }

  return count;
}

/**
 * Regla de palabras clave -> `order` de columna destino. El destino se nombra
 * por el estado de HU al que equivale (STATUS_COLUMN_ORDER, @pemie/shared): mover
 * la tarjeta también mueve el estado, así que la regla se lee en esos términos.
 */
const COMMIT_KEYWORD_RULES: { regex: RegExp; columnOrder: number }[] = [
  { regex: /\b(fix|close|fixes|resolves)\b/i, columnOrder: STATUS_COLUMN_ORDER.review },
  { regex: /\b(wip|progress|avance)\b/i, columnOrder: STATUS_COLUMN_ORDER.in_progress },
  { regex: /\b(review|pr|merge)\b/i, columnOrder: STATUS_COLUMN_ORDER.review },
  { regex: /\bfeat\b/i, columnOrder: STATUS_COLUMN_ORDER.in_progress },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Primera regla que matchea el mensaje, o null si ninguna aplica. */
function resolveTargetColumnOrder(message: string): number | null {
  for (const rule of COMMIT_KEYWORD_RULES) {
    if (rule.regex.test(message)) return rule.columnOrder;
  }
  return null;
}

/**
 * Inspecciona los mensajes de commit en busca de referencias a HUs (`KEY-123`)
 * y mueve su Card vinculada según palabras clave (fix/wip/review/feat...).
 * Registra la actividad como actor "agent". Silencioso si la HU o su Card no existen.
 */
async function autoMoveCardsFromCommits(
  projectId: string,
  projectKey: string,
  commits: NormalizedCommit[]
) {
  const keyPattern = new RegExp(`${escapeRegExp(projectKey)}-(\\d+)`, "i");
  for (const c of commits) {
    const message = c.message ?? "";
    const keyMatch = message.match(keyPattern);
    if (!keyMatch) continue;
    const targetOrder = resolveTargetColumnOrder(message);
    if (targetOrder == null) continue;

    const key = `${projectKey}-${keyMatch[1]}`;
    const story = await prisma.userStory.findUnique({ where: { projectId_key: { projectId, key } } });
    if (!story) continue;

    const card = await prisma.card.findUnique({ where: { userStoryId: story.id } });
    if (!card) continue;

    // Una colocación manual gana sobre el automatismo: si la última vez la movió
    // una persona, el commit no la toca hasta que ella la vuelva a mover.
    if (await board.wasLastMovedByUser(card.id)) continue;

    const column = await prisma.column.findFirst({ where: { boardId: card.boardId, order: targetOrder } });
    if (!column || column.id === card.columnId) continue;

    await board.opMoveCard(card, { columnId: column.id }, { actorType: "agent", actorId: null });
  }
}

// ─── Webhook push ──────────────────────────────────────────────────────────

/** Estructura mínima de un evento `push` de GitHub que nos interesa. */
export interface PushEvent {
  installation?: { id: number };
  repository?: { name: string; owner?: { login?: string; name?: string } };
  commits?: {
    id: string;
    message: string;
    timestamp: string;
    author?: { name?: string; username?: string };
  }[];
}

/**
 * Procesa un evento push: localiza el/los repos vinculados que coincidan con
 * owner/name (y con la instalación, si viene) y registra sus commits. No lanza
 * si el repo no está vinculado: simplemente no ingesta (se reporta en la resp).
 */
export async function ingestPushEvent(payload: PushEvent) {
  const owner = payload.repository?.owner?.login ?? payload.repository?.owner?.name ?? null;
  const name = payload.repository?.name ?? null;
  const commits = payload.commits ?? [];
  const installationId = payload.installation?.id != null ? String(payload.installation.id) : null;

  if (!owner || !name) return { ingested: 0, reason: "evento sin repo" };

  const repos = await prisma.repo.findMany({ where: { provider: "github", owner, name } });
  // Si el push trae installationId, solo repos con esa instalación (o sin una fijada aún).
  const targets = installationId
    ? repos.filter((r) => !r.installationId || r.installationId === installationId)
    : repos;

  if (targets.length === 0) return { ingested: 0, reason: "repo no vinculado a ningún proyecto" };

  const normalized: NormalizedCommit[] = commits.map((c) => ({
    sha: c.id,
    message: c.message ?? "",
    committedAt: c.timestamp ? new Date(c.timestamp) : new Date(),
    login: c.author?.username ?? null,
    authorName: c.author?.name ?? null,
    avatarUrl: null,
  }));

  let ingested = 0;
  for (const repo of targets) {
    // Fija el installationId en el repo la primera vez que llega por webhook.
    if (installationId && !repo.installationId) {
      await prisma.repo.update({ where: { id: repo.id }, data: { installationId } });
    }
    ingested += await recordCommits(repo, normalized);
  }
  return { ingested, repos: targets.length };
}

/** Repo tal como lo necesita la sincronización. */
type SyncableRepo = {
  id: string;
  projectId: string;
  owner: string;
  name: string;
  installationId: string | null;
  lastSyncedAt?: Date | null;
};

/**
 * Trae los commits de un repo y los registra. La credencial por defecto es el
 * access token OAuth del usuario —el permiso que él mismo concedió al entrar—
 * y solo se recurre a la GitHub App si el repo llegó por una instalación.
 * Asume acceso ya verificado por quien llama.
 */
async function syncRepoCommits(userId: string, repo: SyncableRepo, since?: Date) {
  const viaApp = Boolean(repo.installationId && githubAppConfigured());
  const commits = viaApp
    ? await fetchRecentCommits(repo.installationId!, repo.owner, repo.name, since)
    : await fetchCommitsWithToken(await userGithubToken(userId), repo.owner, repo.name, since);
  const ingested = await recordCommits(repo, commits);
  await prisma.repo.update({ where: { id: repo.id }, data: { lastSyncedAt: new Date() } });
  return { fetched: commits.length, ingested };
}

/** Un repo sincronizado hace menos de esto se considera al día. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Solapamiento hacia atrás en la sync incremental. GitHub filtra por fecha del
 * commit, no de llegada: un merge de una rama vieja o un rebase pueden traer
 * commits *anteriores* al último sync. Pedir una hora de más los recupera sin
 * repetir el histórico completo (el `skipDuplicates` absorbe el solape).
 */
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000;

/**
 * Traduce un fallo de la API de GitHub al error de dominio que le sirve al
 * usuario: qué pasó y qué puede hacer. Sin esto, un token vencido o un repo sin
 * permisos llegaba al front como un 500 sin explicación.
 */
function describeGithubFailure(err: unknown, repoLabel: string): never {
  if (err instanceof GithubApiError) {
    if (err.status === 401)
      throw badRequest(
        "Tu autorización de GitHub venció. Vuelve a conectar tu cuenta.",
        "github_token_expired"
      );
    if (err.status === 403)
      throw forbidden(
        `Tu cuenta de GitHub no tiene permiso para leer ${repoLabel}. Si es de una organización, revisa que la autorización de pemie.ai esté aprobada allí.`
      );
    if (err.status === 404)
      throw notFound(`No encontramos ${repoLabel}, o tu cuenta de GitHub no tiene acceso.`);
  }
  throw err;
}

/**
 * Sincroniza el histórico de un repo con la autorización de GitHub del usuario
 * (member+). Idempotente: los commits ya registrados se ignoran.
 */
export async function backfillRepo(userId: string, repoId: string, since?: Date) {
  const repo = await repoWithAccess(userId, repoId, "member");
  try {
    return await syncRepoCommits(userId, repo, since);
  } catch (err) {
    describeGithubFailure(err, `${repo.owner}/${repo.name}`);
  }
}

/**
 * Sincroniza los repos vinculados de un proyecto (member+). Un repo que falle
 * no cancela los demás: se reporta por separado para que la UI pueda mostrar
 * qué entró y qué no.
 *
 * En modo `auto` (el que dispara la pestaña al abrirse) solo se tocan los repos
 * sin sincronizar o vencidos, y de ellos únicamente lo nuevo desde su último
 * sync. Así entrar a la vista cuesta ~1 request por repo en vez del histórico
 * entero, y visitarla dos veces seguidas no cuesta nada.
 */
export async function backfillProject(
  userId: string,
  projectId: string,
  mode: "full" | "auto" = "full"
) {
  await projectWithAccess(userId, projectId, "member");
  const all = await prisma.repo.findMany({ where: { projectId } });
  const now = Date.now();
  const repos =
    mode === "auto"
      ? all.filter((r) => !r.lastSyncedAt || now - r.lastSyncedAt.getTime() > STALE_AFTER_MS)
      : all;

  let fetched = 0;
  let ingested = 0;
  const failed: { repo: string; error: string }[] = [];

  for (const repo of repos) {
    const label = `${repo.owner}/${repo.name}`;
    // Solo incremental cuando ya hubo un sync previo: si nunca se sincronizó,
    // hay que traer el histórico aunque el modo sea automático.
    const since =
      mode === "auto" && repo.lastSyncedAt
        ? new Date(repo.lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS)
        : undefined;
    try {
      const result = await syncRepoCommits(userId, repo, since);
      fetched += result.fetched;
      ingested += result.ingested;
    } catch (err) {
      try {
        describeGithubFailure(err, label);
      } catch (domainErr) {
        failed.push({ repo: label, error: (domainErr as Error).message });
      }
    }
  }

  return { repos: repos.length, fetched, ingested, failed };
}

// ─── Lectura ───────────────────────────────────────────────────────────────

export interface ListCommitsFilter {
  limit?: number;
  domain?: string;
  contributorId?: string;
  since?: Date;
  until?: Date;
}

const commitFiltersSchema = z.object({
  domain: z.string().min(1).optional().catch(undefined),
  contributorId: z.string().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().positive().optional().catch(undefined),
  since: z.coerce.date().optional().catch(undefined),
  until: z.coerce.date().optional().catch(undefined),
});

/**
 * Parsea filtros de listado de commits desde query params REST (strings) o
 * argumentos MCP (JSON tipado) — mismo parser para ambas interfaces, así
 * quedan en paridad. Entradas inválidas se ignoran (quedan `undefined`) en
 * vez de rechazar la request completa.
 */
export function parseCommitFilters(raw: Record<string, unknown>): ListCommitsFilter {
  return commitFiltersSchema.parse(raw);
}

/**
 * Actualiza la DomainConfig del proyecto y reclasifica todos sus commits
 * con la config nueva (member+). Devuelve la config persistida y cuántos
 * commits cambiaron de dominio.
 */
export async function updateDomainConfig(userId: string, projectId: string, config: DomainConfig) {
  await projectWithAccess(userId, projectId, "member");

  const keys = config.categories.map((c) => c.key);
  if (new Set(keys).size !== keys.length)
    throw badRequest("Las keys de categoría deben ser únicas", "duplicate_keys");
  if (!config.fallback.trim())
    throw badRequest("El fallback no puede estar vacío", "empty_fallback");

  await prisma.project.update({
    where: { id: projectId },
    data: { domainConfig: config as unknown as Prisma.InputJsonValue },
  });

  const commits = await prisma.commit.findMany({
    where: { projectId },
    select: { id: true, message: true, domain: true },
  });

  const byDomain = new Map<string, string[]>();
  for (const c of commits) {
    const domain = classifyCommit(c.message, config);
    if (domain === c.domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(c.id);
    byDomain.set(domain, list);
  }

  let reclassified = 0;
  for (const [domain, ids] of byDomain) {
    // Chunks por si el proyecto tiene muchos commits.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const result = await prisma.commit.updateMany({
        where: { id: { in: chunk } },
        data: { domain },
      });
      reclassified += result.count;
    }
  }

  return { config, reclassified };
}

/** Lista commits de un proyecto, más recientes primero (viewer+). */
export async function listCommits(userId: string, projectId: string, filter: ListCommitsFilter = {}) {
  await projectWithAccess(userId, projectId);
  return opListCommits(projectId, filter);
}

/** Operación (ya autorizada): lista commits del proyecto. */
export function opListCommits(projectId: string, filter: ListCommitsFilter = {}) {
  const take = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return prisma.commit.findMany({
    where: {
      projectId,
      ...(filter.domain ? { domain: filter.domain } : {}),
      ...(filter.contributorId ? { contributorId: filter.contributorId } : {}),
      ...(filter.since || filter.until
        ? {
            committedAt: {
              ...(filter.since ? { gte: filter.since } : {}),
              ...(filter.until ? { lt: filter.until } : {}),
            },
          }
        : {}),
    },
    orderBy: { committedAt: "desc" },
    take,
    select: {
      id: true,
      sha: true,
      message: true,
      domain: true,
      committedAt: true,
      contributor: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
      repo: { select: { id: true, owner: true, name: true } },
    },
  });
}
