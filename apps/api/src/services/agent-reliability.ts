// Servicio PEM-48: proporción de acciones de agente que quedan en pie.
// No vive en reports.ts: es un indicador de proyecto, no parte del informe
// diario, y mezclarlos acopla dos features que cambian por razones distintas.
//
// El nombre de columna se resuelve leyendo el tablero real (igual que drift.ts):
// CardActivity.moved guarda nombres, no ids (ver board.recordActivity).

import type { ActorType, AgentReliabilityReport } from "@pemie/shared";
import { prisma } from "../db.js";
import { projectWithAccess } from "./ingest.js";

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_SETTLE_HOURS = 2;

const TRACKED_ACTIONS = ["moved", "assigned"] as const;
type TrackedAction = (typeof TRACKED_ACTIONS)[number];

export interface AgentReliabilityOptions {
  /** Días hacia atrás de acciones de agente que entran al cálculo (default 30). */
  windowDays?: number;
  /**
   * Horas de asentamiento: excluye acciones demasiado recientes (default 2).
   * Sin esto, una acción de hace 30 segundos contaría como "sobrevivió" sin
   * que nadie haya tenido chance de revertirla, inflando el score cuanto más
   * activo esté el agente.
   */
  settleHours?: number;
}

interface ActivityRow {
  cardId: string;
  actorType: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

function emptyByAction(): AgentReliabilityReport["byAction"] {
  return {
    moved: { actions: 0, reverted: 0 },
    assigned: { actions: 0, reverted: 0 },
  };
}

function emptyReport(windowDays: number, settleHours: number): AgentReliabilityReport {
  return {
    windowDays,
    settleHours,
    agentActions: 0,
    revertedActions: 0,
    survivalRate: null,
    byAction: emptyByAction(),
  };
}

function isTrackedAction(action: string): action is TrackedAction {
  return action === "moved" || action === "assigned";
}

function chainKey(cardId: string, action: TrackedAction): string {
  return `${cardId}:${action}`;
}

/**
 * Reversión humana del cambio concreto del agente, no un toque posterior.
 * Conservador ante dato faltante (columna renombrada o borrada): no inflamos
 * el número feo.
 */
function wasRevertedByHuman(
  agent: ActivityRow,
  successor: ActivityRow | undefined,
  columnOrderByName: Map<string, number>
): boolean {
  if (!successor || successor.actorType !== "user") return false;
  if (successor.fromValue !== agent.toValue) return false;

  if (agent.action === "assigned") return successor.toValue !== agent.toValue;

  const agentOrder = agent.toValue == null ? undefined : columnOrderByName.get(agent.toValue);
  const successorOrder = successor.toValue == null ? undefined : columnOrderByName.get(successor.toValue);
  if (agentOrder === undefined || successorOrder === undefined) return false;
  return successorOrder < agentOrder;
}

/** Indicador de confiabilidad de agentes del proyecto (viewer+). */
export async function getAgentReliability(
  userId: string,
  projectId: string,
  opts: AgentReliabilityOptions = {}
): Promise<AgentReliabilityReport> {
  await projectWithAccess(userId, projectId);
  return opAgentReliability(projectId, opts);
}

/**
 * Operación (ya autorizada): recorre las cadenas moved/assigned de cada
 * tarjeta y cuenta cuántas acciones de agente un humano deshizo.
 */
export async function opAgentReliability(
  projectId: string,
  opts: AgentReliabilityOptions = {}
): Promise<AgentReliabilityReport> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const settleHours = opts.settleHours ?? DEFAULT_SETTLE_HOURS;
  const now = Date.now();
  const windowStart = new Date(now - windowDays * MS_PER_DAY);
  const settleCutoff = new Date(now - settleHours * MS_PER_HOUR);

  const board = await prisma.board.findFirst({ where: { projectId }, select: { id: true } });
  if (!board) return emptyReport(windowDays, settleHours);

  const columns = await prisma.column.findMany({
    where: { boardId: board.id },
    select: { name: true, order: true },
  });
  const columnOrderByName = new Map(columns.map((column) => [column.name, column.order]));

  const activities = await prisma.cardActivity.findMany({
    where: {
      card: { board: { projectId } },
      action: { in: [...TRACKED_ACTIONS] },
      createdAt: { gte: windowStart },
    },
    orderBy: [{ cardId: "asc" }, { createdAt: "asc" }],
    select: { cardId: true, actorType: true, action: true, fromValue: true, toValue: true, createdAt: true },
  });

  const chains = new Map<string, ActivityRow[]>();
  for (const activity of activities) {
    if (!isTrackedAction(activity.action)) continue;
    if (activity.createdAt.getTime() < windowStart.getTime()) continue;
    const key = chainKey(activity.cardId, activity.action);
    const chain = chains.get(key) ?? [];
    chain.push(activity);
    chains.set(key, chain);
  }

  const byAction = emptyByAction();

  for (const chain of chains.values()) {
    for (let i = 0; i < chain.length; i++) {
      const activity = chain[i]!;
      if (activity.actorType !== ("agent" satisfies ActorType)) continue;
      if (activity.createdAt.getTime() > settleCutoff.getTime()) continue;
      if (!isTrackedAction(activity.action)) continue;

      byAction[activity.action].actions += 1;
      if (wasRevertedByHuman(activity, chain[i + 1], columnOrderByName)) {
        byAction[activity.action].reverted += 1;
      }
    }
  }

  const agentActions = byAction.moved.actions + byAction.assigned.actions;
  const revertedActions = byAction.moved.reverted + byAction.assigned.reverted;

  return {
    windowDays,
    settleHours,
    agentActions,
    revertedActions,
    survivalRate: agentActions === 0 ? null : (agentActions - revertedActions) / agentActions,
    byAction,
  };
}
