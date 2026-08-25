// PEM-56: estado vivo e historial de tramos de trabajo de agentes.
// El transporte solo acredita al actor; aquí se decide qué constituye el mismo
// tramo, cuándo caduca y cuándo dos agentes pisan el mismo terreno.

import {
  AGENT_ACTIVITY_STATES,
  type AgentActivity,
  type AgentActivityConflict,
  type AgentActivityList,
  type AgentActivityState,
  type AgentActivityStatus,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, forbidden } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60_000;
// El latido ocurre por evento, no por polling: cinco minutos cubren un tramo
// normal de edición sin fingir que cada archivo produce un reloj periódico.
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_UNDECLARED_SUMMARY = "Edición de archivos sin tarea declarada";
// Tras una jornada de 8 h sin hechos nuevos, conservar el tramo abierto en la
// franja deja de prevenir choques y empieza a arrastrar ruido de otra sesión.
const ACTIVITY_CEILING_MS = 8 * 60 * 60_000;

export interface AgentActivityActor {
  apiKeyId: string;
  agentId?: string | null;
  ownerUserId?: string | null;
}

export interface ReportActivityInput {
  summary?: string;
  state?: AgentActivityState;
  userStoryId?: string | null;
  cardId?: string | null;
  paths?: string[];
  intervalSeconds?: number;
  model?: string | null;
}

export interface ListActivityFilters {
  agentId?: string;
  userStoryId?: string;
  from?: Date;
  to?: Date;
}

type ActivityRow = Omit<AgentActivity<Date>, "status">;
type ResolvedActivity = AgentActivity<Date>;
type PersistedActivityRow = Omit<ActivityRow, "state"> & { state: string };
type ActivityContributor = NonNullable<ResolvedActivity["contributor"]>;

// Prisma representa `state` como string porque el esquema conserva una columna
// simple para una migración aditiva; solo este servicio la escribe tras validarla.
function activityFromRow(activity: PersistedActivityRow): ActivityRow {
  return { ...activity, state: activity.state as AgentActivityState };
}

function ttlMs(intervalSeconds: number): number {
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, intervalSeconds * 3_000));
}

export function activityStatus(activity: ActivityRow, now: Date): AgentActivityStatus {
  if (activity.state === "done") return "closed";
  const ageMs = now.getTime() - activity.lastSeenAt.getTime();
  if (ageMs < ttlMs(activity.intervalSeconds)) return "active";
  return ageMs < ACTIVITY_CEILING_MS ? "idle" : "closed";
}

function normalizePaths(paths: string[] | undefined): string[] {
  const normalized = (paths ?? []).map((path) => {
    const value = path.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
    if (!value || value.split("/").includes("..")) throw badRequest("invalid_activity_path");
    return value.replace(/\/$/, "");
  });
  return [...new Set(normalized)].sort();
}

function normalizedInput(input: ReportActivityInput) {
  const summary = input.summary === undefined ? null : input.summary.trim();
  if (input.summary !== undefined && (!summary || summary.length > 280)) throw badRequest("invalid_activity_summary");

  const state = input.state ?? "working";
  if (!AGENT_ACTIVITY_STATES.includes(state)) throw badRequest("invalid_activity_state");

  const intervalSeconds = input.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw badRequest("invalid_activity_interval");

  return {
    summary,
    state,
    userStoryId: input.userStoryId ?? null,
    cardId: input.cardId ?? null,
    paths: normalizePaths(input.paths),
    intervalSeconds,
    model: input.model?.trim() || null,
  };
}

function isSameSegment(activity: ActivityRow, input: ReturnType<typeof normalizedInput>): boolean {
  return activity.summary === input.summary && activity.state === input.state &&
    activity.userStoryId === input.userStoryId && activity.cardId === input.cardId;
}

function unionPaths(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

function pathsOverlap(left: string, right: string): boolean {
  const a = left.replace(/\/$/, "");
  const b = right.replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Devuelve los choques con otros tramos vigentes; Prisma no expresa prefijos de path. */
export async function detectConflicts(projectId: string, activity: ActivityRow, now = new Date()): Promise<AgentActivityConflict<Date>[]> {
  const persistedActivities = (await prisma.agentActivity.findMany({
    where: { projectId },
    orderBy: { lastSeenAt: "desc" },
    include: {
      owner: { select: { id: true, name: true, avatarUrl: true } },
      agent: { select: { id: true, name: true } },
      userStory: { select: { id: true, key: true, title: true } },
    },
  })).map(activityFromRow);
  const activities = await resolveActivities(projectId, persistedActivities, now);

  return activities
    .filter((candidate) => {
      // La key es la identidad operativa: dos agentes de una misma persona
      // deben advertirse, pero un actor nunca debe chocar con su propia traza.
      return candidate.id !== activity.id && candidate.apiKeyId !== activity.apiKeyId && candidate.status !== "closed";
    })
    .flatMap((candidate) => {
      const reasons: AgentActivityConflict<Date>["reasons"] = [];
      const overlappingPaths = activity.paths.flatMap((path) =>
        candidate.paths.filter((otherPath) => pathsOverlap(path, otherPath)).map(() => path)
      );
      if (activity.userStoryId && activity.userStoryId === candidate.userStoryId) reasons.push("userStory");
      if (activity.cardId && activity.cardId === candidate.cardId) reasons.push("card");
      if (overlappingPaths.length) reasons.push("path");
      const ageSeconds = Math.max(0, Math.floor((now.getTime() - candidate.lastSeenAt.getTime()) / 1_000));
      return reasons.length ? [{ activity: candidate, status: candidate.status, ageSeconds, reasons, overlappingPaths: [...new Set(overlappingPaths)] }] : [];
    });
}

/** Reporta actividad con acceso member+; útil para llamadas internas ya autenticadas. */
export async function reportActivity(userId: string, projectId: string, input: ReportActivityInput, actor: AgentActivityActor) {
  await projectWithAccess(userId, projectId, "member");
  return opReportActivity(projectId, input, actor);
}

/** Operación ya autorizada: coalesce el último tramo equivalente del mismo actor. */
export async function opReportActivity(projectId: string, input: ReportActivityInput, actor: AgentActivityActor) {
  if (!actor.apiKeyId) throw forbidden("invalid_api_key");
  const data = normalizedInput(input);
  if (data.summary === null && data.paths.length === 0) {
    return { activity: null, conflicts: [] as AgentActivityConflict<Date>[] };
  }
  // Las keys de proyecto no tienen dueño propio: la persona sigue siendo la
  // dueña del Agent al que pertenecen, salvo agentes históricos sin ownerId.
  const ownerUserId = actor.ownerUserId ?? (actor.agentId
    ? (await prisma.agent.findUnique({ where: { id: actor.agentId }, select: { ownerId: true } }))?.ownerId ?? null
    : null);
  const persistedLast = await prisma.agentActivity.findFirst({
    where: { projectId, apiKeyId: actor.apiKeyId },
    orderBy: { lastSeenAt: "desc" },
  });
  const last = persistedLast ? activityFromRow(persistedLast) : null;
  const now = new Date();
  const openLast = last && activityStatus(last, now) !== "closed" ? last : null;
  const activity = data.summary === null && openLast
    ? activityFromRow(await prisma.agentActivity.update({
        where: { id: openLast.id },
        data: {
          lastSeenAt: now,
          beats: { increment: 1 },
          paths: unionPaths(openLast.paths, data.paths),
          ...(!openLast.ownerUserId && ownerUserId ? { ownerUserId } : {}),
        },
      }))
    : last && data.summary !== null && isSameSegment(last, data)
    ? activityFromRow(await prisma.agentActivity.update({
        where: { id: last.id },
        data: {
          lastSeenAt: now,
          beats: { increment: 1 },
          paths: unionPaths(last.paths, data.paths),
          // Un latido idéntico también repara tramos abiertos creados antes
          // de que las keys de proyecto heredaran la persona desde Agent.
          ...(!last.ownerUserId && ownerUserId ? { ownerUserId } : {}),
        },
      }))
    : activityFromRow(await prisma.agentActivity.create({
        data: {
          projectId,
          apiKeyId: actor.apiKeyId,
          agentId: actor.agentId ?? null,
          ownerUserId,
          ...data,
          // Sin un tramo abierto no hay narrativa que extender. Este fallback
          // honesto es el único caso en que un reporte automático la inventa.
          summary: data.summary ?? DEFAULT_UNDECLARED_SUMMARY,
        },
      }));

  return { activity, conflicts: await detectConflicts(projectId, activity) };
}

/** Lista actividad con acceso viewer+; el historial conserva incluso lo vencido. */
export async function listActivity(userId: string, projectId: string, filters: ListActivityFilters = {}): Promise<AgentActivityList<Date>> {
  await projectWithAccess(userId, projectId);
  return opListActivity(projectId, filters);
}

/** Operación ya autorizada: separa vigencia derivada de la traza persistida. */
export async function opListActivity(projectId: string, filters: ListActivityFilters = {}): Promise<AgentActivityList<Date>> {
  const persistedHistory = (await prisma.agentActivity.findMany({
    where: {
      projectId,
      ...(filters.agentId ? { agentId: filters.agentId } : {}),
      ...(filters.userStoryId ? { userStoryId: filters.userStoryId } : {}),
      ...(filters.from || filters.to ? { lastSeenAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    // La traza se consume como identidad humana: resolver aquí evita que cada
    // borde haga N joins o tenga que adivinar nombres desde ids desnormalizados.
    include: {
      owner: { select: { id: true, name: true, avatarUrl: true } },
      agent: { select: { id: true, name: true } },
      userStory: { select: { id: true, key: true, title: true } },
    },
  })).map(activityFromRow);
  const now = new Date();
  const history = await resolveActivities(projectId, persistedHistory, now);
  return { live: history.filter((activity) => activity.status !== "closed"), history };
}

/** Enriquece una página completa y resuelve su vigencia con un solo batch de Contributor. */
async function resolveActivities(projectId: string, activities: ActivityRow[], now: Date): Promise<ResolvedActivity[]> {
  const ownerUserIds = [...new Set(activities.flatMap((activity) => activity.ownerUserId ? [activity.ownerUserId] : []))];
  const contributors = ownerUserIds.length > 0
    ? await prisma.contributor.findMany({
        where: { projectId, userId: { in: ownerUserIds } },
        select: { id: true, githubLogin: true, name: true, avatarUrl: true, userId: true },
      })
    : [];
  const contributorByUserId = new Map<string, ActivityContributor>();
  for (const contributor of contributors) {
    if (!contributor.userId) continue;
    const current = contributorByUserId.get(contributor.userId);
    const identity = {
      id: contributor.id,
      githubLogin: contributor.githubLogin,
      name: contributor.name,
      avatarUrl: contributor.avatarUrl,
    };
    // Un usuario puede conservar aliases históricos; para la franja importa
    // el Contributor que sí trae la identidad observada desde GitHub.
    if (!current || (!current.avatarUrl && contributor.avatarUrl)) {
      contributorByUserId.set(contributor.userId, identity);
    }
  }
  return activities.map((activity) => ({
    ...activity,
    status: activityStatus(activity, now),
    contributor: activity.ownerUserId ? contributorByUserId.get(activity.ownerUserId) ?? null : null,
  }));
}
