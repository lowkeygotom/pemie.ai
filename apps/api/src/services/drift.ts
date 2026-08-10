// Servicio F7: detección de drift (PEM-50) — alertas donde el tablero (columna
// de la HU) no coincide con la evidencia real de commits. No importa
// overview.ts: el overview consume este servicio, nunca al revés.
//
// El nombre de columna que corresponde a cada grupo de avance (STATUS_PROGRESS_GROUP)
// se resuelve leyendo el tablero real del proyecto, nunca hardcodeado — las
// columnas por defecto son fijas (ver board.ts), pero este servicio no depende
// de sus nombres literales.

import {
  DRIFT_ALERT_TYPES,
  STATUS_COLUMN_ORDER,
  STATUS_PROGRESS_GROUP,
  type DriftAlert,
  type DriftAlertType,
  type DriftReport,
  type StoryProgressGroup,
  type UserStoryStatus,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { projectWithAccess } from "./ingest.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_STALE_DAYS = 14;

export interface DetectDriftOptions {
  /** Días sin evidencia de commit tras los que un WIP se considera estancado. */
  staleDays?: number;
}

/** Alertas de drift del proyecto (viewer+). */
export async function detectDrift(
  userId: string,
  projectId: string,
  opts: DetectDriftOptions = {}
): Promise<DriftReport<Date>> {
  await projectWithAccess(userId, projectId);
  return opDetectDrift(projectId, opts);
}

interface StoryCommitJoinRow {
  storyId: string;
  key: string;
  title: string;
  status: string;
  committedAt: Date | null;
}

interface StoryAccumulator {
  key: string;
  title: string;
  status: string;
  commits: Date[];
}

type MovedActivity = { fromValue: string | null; toValue: string | null; createdAt: Date };

/**
 * Órdenes de columna (STATUS_COLUMN_ORDER) agrupadas por avance
 * (STATUS_PROGRESS_GROUP): deriva de las mismas constantes compartidas que
 * board.ts, así que un estado nuevo se clasifica solo con tocar @pemie/shared.
 */
const GROUP_ORDERS: Record<StoryProgressGroup, number[]> = (() => {
  const map: Record<StoryProgressGroup, number[]> = { not_started: [], in_flight: [], closed: [] };
  for (const [status, order] of Object.entries(STATUS_COLUMN_ORDER) as [UserStoryStatus, number][]) {
    map[STATUS_PROGRESS_GROUP[status]].push(order);
  }
  return map;
})();

/** Nombres de columna (del tablero real) que caen dentro de un grupo de avance. */
function columnNamesForGroup(
  columns: { name: string; order: number }[],
  group: StoryProgressGroup
): Set<string> {
  const orders = new Set(GROUP_ORDERS[group]);
  return new Set(columns.filter((c) => orders.has(c.order)).map((c) => c.name));
}

/**
 * Última vez que la tarjeta ENTRÓ al grupo desde fuera (fromValue fuera del
 * grupo o ausente). Una HU que va in_progress→review→in_progress no debe
 * "refrescar" su entrada en el vaivén interno: solo cuenta el cruce real de
 * la frontera del grupo.
 */
function lastEntryIntoGroup(activities: MovedActivity[], groupNames: Set<string>): Date | null {
  let since: Date | null = null;
  for (const a of activities) {
    const enteredGroup = a.toValue != null && groupNames.has(a.toValue);
    const cameFromOutside = !(a.fromValue != null && groupNames.has(a.fromValue));
    if (enteredGroup && cameFromOutside) since = a.createdAt;
  }
  return since;
}

function daysBetween(from: Date, toMs: number): number {
  return Math.max(0, Math.floor((toMs - from.getTime()) / MS_PER_DAY));
}

function zeroCounts(): Record<DriftAlertType, number> {
  return { unreported_work: 0, stalled_wip: 0 };
}

function emptyReport(staleDaysThreshold: number): DriftReport<Date> {
  return {
    correlationAvailable: false,
    staleDaysThreshold,
    alerts: [],
    countsByType: zeroCounts(),
  };
}

function sortableDate(alert: DriftAlert<Date>): Date {
  switch (alert.evidence.type) {
    case "unreported_work":
      return alert.evidence.lastCommitAt;
    case "stalled_wip":
      return alert.evidence.lastCommitAt ?? alert.evidence.inFlightSince ?? new Date(0);
  }
}

/**
 * Operación (ya autorizada): detecta drift entre el tablero y la evidencia
 * real de commits.
 *
 * Una sola query batcheada trae, por HU, cada commit que referencia su key
 * (mismo patrón `~* '\y…\y'` que `stories.opGetStoryCommitProgress`, para no
 * repetir la N+1 que ese comentario ya documenta). El resto de datos
 * (columnas del tablero, historial de movimientos) también se trae en batch:
 * nunca una query por HU.
 */
export async function opDetectDrift(
  projectId: string,
  opts: DetectDriftOptions = {}
): Promise<DriftReport<Date>> {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;

  const rows = await prisma.$queryRaw<StoryCommitJoinRow[]>`
    SELECT
      s."id" AS "storyId",
      s."key" AS "key",
      s."title" AS "title",
      s."status" AS "status",
      c."committedAt" AS "committedAt"
    FROM "user_stories" s
    LEFT JOIN "commits" c
      ON c."projectId" = s."projectId"
      AND c."message" ~* ('\\y' || s."key" || '\\y')
    WHERE s."projectId" = ${projectId}
  `;
  if (rows.length === 0) return emptyReport(staleDays);

  const stories = new Map<string, StoryAccumulator>();
  for (const row of rows) {
    let entry = stories.get(row.storyId);
    if (!entry) {
      entry = { key: row.key, title: row.title, status: row.status, commits: [] };
      stories.set(row.storyId, entry);
    }
    if (row.committedAt) entry.commits.push(row.committedAt);
  }

  // Ningún commit del proyecto referencia ninguna key: el proyecto no
  // correlaciona commits con HUs, así que comparar tablero contra evidencia
  // no dice nada (falsos positivos garantizados).
  const totalMatchedCommits = [...stories.values()].reduce((sum, s) => sum + s.commits.length, 0);
  if (totalMatchedCommits === 0) return emptyReport(staleDays);

  const board = await prisma.board.findFirst({ where: { projectId }, select: { id: true } });
  const columns = board
    ? await prisma.column.findMany({ where: { boardId: board.id }, select: { name: true, order: true } })
    : [];
  const inFlightNames = columnNamesForGroup(columns, "in_flight");

  const activities = board
    ? await prisma.cardActivity.findMany({
        where: {
          action: "moved",
          card: { boardId: board.id, userStoryId: { in: [...stories.keys()] } },
        },
        select: { fromValue: true, toValue: true, createdAt: true, card: { select: { userStoryId: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const activitiesByStory = new Map<string, MovedActivity[]>();
  for (const a of activities) {
    const storyId = a.card.userStoryId;
    if (!storyId) continue;
    const list = activitiesByStory.get(storyId) ?? [];
    list.push({ fromValue: a.fromValue, toValue: a.toValue, createdAt: a.createdAt });
    activitiesByStory.set(storyId, list);
  }

  const now = Date.now();
  const staleMs = staleDays * MS_PER_DAY;
  const alerts: DriftAlert<Date>[] = [];

  for (const [storyId, s] of stories) {
    const status = s.status as UserStoryStatus;
    const group = STATUS_PROGRESS_GROUP[status];
    const commitCount = s.commits.length;
    const lastCommitAt = commitCount > 0 ? new Date(Math.max(...s.commits.map((d) => d.getTime()))) : null;
    const story = { id: storyId, key: s.key, title: s.title, status };
    const storyActivities = activitiesByStory.get(storyId) ?? [];

    if (group === "not_started" && commitCount > 0) {
      alerts.push({ story, evidence: { type: "unreported_work", commitCount, lastCommitAt: lastCommitAt! } });
      continue;
    }

    if (group === "in_flight") {
      const inFlightSince = lastEntryIntoGroup(storyActivities, inFlightNames);
      // Los commits anteriores a la entrada al grupo son de otro ciclo de
      // trabajo: no cuentan como avance de éste. Sin entrada conocida se toman
      // todos, que es la lectura más caritativa posible.
      const commitsSince = inFlightSince
        ? s.commits.filter((d) => d.getTime() >= inFlightSince.getTime())
        : s.commits;
      const lastCommitSince =
        commitsSince.length > 0 ? new Date(Math.max(...commitsSince.map((d) => d.getTime()))) : null;

      // Reloj del estancamiento: el último avance de este ciclo, o la entrada al
      // grupo si todavía no hubo ninguno. El umbral se aplica a AMBOS casos —
      // sin eso, mover una tarjeta a "En progreso" la alertaría en el acto, con
      // cero días de antigüedad. Y sin ninguna de las dos referencias no se
      // puede afirmar cuánto lleva sin avanzar: se calla, porque una alerta con
      // `daysSince: 0` y las dos fechas nulas es ruido, no señal.
      const reference = lastCommitSince ?? inFlightSince;
      if (reference && now - reference.getTime() > staleMs) {
        alerts.push({
          story,
          evidence: {
            type: "stalled_wip",
            lastCommitAt: lastCommitSince,
            inFlightSince,
            daysSince: daysBetween(reference, now),
          },
        });
      }
    }
  }

  const typeOrder = new Map(DRIFT_ALERT_TYPES.map((t, i) => [t, i]));
  alerts.sort((a, b) => {
    const byType = typeOrder.get(a.evidence.type)! - typeOrder.get(b.evidence.type)!;
    if (byType !== 0) return byType;
    return sortableDate(b).getTime() - sortableDate(a).getTime();
  });

  const countsByType = zeroCounts();
  for (const alert of alerts) countsByType[alert.evidence.type]++;

  return { correlationAvailable: true, staleDaysThreshold: staleDays, alerts, countsByType };
}
