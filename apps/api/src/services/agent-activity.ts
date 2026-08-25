// PEM-56: estado vivo e historial de tramos de trabajo de agentes.
// El transporte solo acredita al actor; aquí se decide qué constituye el mismo
// tramo, cuándo caduca y cuándo dos agentes pisan el mismo terreno.

import {
  AGENT_ACTIVITY_STATES,
  type AgentActivity,
  type AgentActivityConflict,
  type AgentActivityList,
  type AgentActivityState,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, forbidden } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60_000;
const DEFAULT_INTERVAL_SECONDS = 60;

export interface AgentActivityActor {
  apiKeyId: string;
  agentId?: string | null;
  ownerUserId?: string | null;
}

export interface ReportActivityInput {
  summary: string;
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

type ActivityRow = AgentActivity<Date>;
type PersistedActivityRow = Omit<ActivityRow, "state"> & { state: string };
type ActivityContributor = NonNullable<ActivityRow["contributor"]>;

// Prisma representa `state` como string porque el esquema conserva una columna
// simple para una migración aditiva; solo este servicio la escribe tras validarla.
function activityFromRow(activity: PersistedActivityRow): ActivityRow {
  return { ...activity, state: activity.state as AgentActivityState };
}

function ttlMs(intervalSeconds: number): number {
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, intervalSeconds * 3_000));
}

function isLive(activity: ActivityRow, now: Date): boolean {
  return activity.state !== "done" && activity.lastSeenAt > new Date(now.getTime() - ttlMs(activity.intervalSeconds));
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
  const summary = input.summary.trim();
  if (!summary || summary.length > 280) throw badRequest("invalid_activity_summary");

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

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function isSameSegment(activity: ActivityRow, input: ReturnType<typeof normalizedInput>): boolean {
  return activity.summary === input.summary && activity.state === input.state &&
    activity.userStoryId === input.userStoryId && activity.cardId === input.cardId &&
    samePaths(activity.paths, input.paths);
}

function pathsOverlap(left: string, right: string): boolean {
  const a = left.replace(/\/$/, "");
  const b = right.replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Devuelve los choques con otros tramos vigentes; Prisma no expresa prefijos de path. */
export async function detectConflicts(projectId: string, activity: ActivityRow, now = new Date()): Promise<AgentActivityConflict<Date>[]> {
  const activities = (await prisma.agentActivity.findMany({
    where: { projectId },
    orderBy: { lastSeenAt: "desc" },
  })).map(activityFromRow);

  return activities
    .filter((candidate) => candidate.id !== activity.id && isLive(candidate, now))
    .flatMap((candidate) => {
      const reasons: AgentActivityConflict<Date>["reasons"] = [];
      const overlappingPaths = activity.paths.flatMap((path) =>
        candidate.paths.filter((otherPath) => pathsOverlap(path, otherPath)).map(() => path)
      );
      if (activity.userStoryId && activity.userStoryId === candidate.userStoryId) reasons.push("userStory");
      if (activity.cardId && activity.cardId === candidate.cardId) reasons.push("card");
      if (overlappingPaths.length) reasons.push("path");
      return reasons.length ? [{ activity: candidate, reasons, overlappingPaths: [...new Set(overlappingPaths)] }] : [];
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
  const activity = last && isSameSegment(last, data)
    ? activityFromRow(await prisma.agentActivity.update({
        where: { id: last.id },
        data: {
          lastSeenAt: new Date(),
          beats: { increment: 1 },
          // Un latido idéntico también repara tramos abiertos creados antes
          // de que las keys de proyecto heredaran la persona desde Agent.
          ...(!last.ownerUserId && ownerUserId ? { ownerUserId } : {}),
        },
      }))
    : activityFromRow(await prisma.agentActivity.create({
        data: { projectId, apiKeyId: actor.apiKeyId, agentId: actor.agentId ?? null, ownerUserId, ...data },
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
  const ownerUserIds = [...new Set(persistedHistory.flatMap((activity) => activity.ownerUserId ? [activity.ownerUserId] : []))];
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
  const history = persistedHistory.map((activity) => ({
    ...activity,
    contributor: activity.ownerUserId ? contributorByUserId.get(activity.ownerUserId) ?? null : null,
  }));
  const now = new Date();
  return { live: history.filter((activity) => isLive(activity, now)), history };
}
