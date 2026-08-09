// Servicio F6: Kanban. Cada proyecto tiene un tablero con columnas por defecto;
// las tarjetas se mueven entre columnas y cada movimiento/cambio se registra en
// CardActivity. Las tarjetas pueden colgar de una HU (F5). Consumible por REST
// (usuarios) y por MCP (agentes: list_board / create_card / move_card).

import { Prisma } from "@prisma/client";
import {
  STATUS_COLUMN_ORDER,
  statusForColumnOrder,
  type ActorType,
  type CardType,
  type UserStoryStatus,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";
import { resolveActorNames } from "./actor.js";

const CARD_TYPES: CardType[] = ["story", "task", "bug"];
// Los `order` son el otro extremo de STATUS_COLUMN_ORDER (@pemie/shared): esta
// tabla y la de estados de HU describen la misma escalera y se mueven juntas.
const DEFAULT_COLUMNS = [
  { name: "Backlog", order: 0 },
  { name: "Por hacer", order: 1 },
  { name: "En progreso", order: 2 },
  { name: "Revisión", order: 3 },
  { name: "Hecho", order: 4 },
];

const asJson = (v: unknown) => (v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/** Actor de una acción sobre una tarjeta (usuario o agente). */
export interface CardActor {
  actorType: ActorType;
  actorId?: string | null;
}

/** Devuelve el tablero del proyecto, creándolo con columnas por defecto si no existe. */
async function ensureBoard(projectId: string) {
  const existing = await prisma.board.findFirst({ where: { projectId } });
  if (existing) return existing;
  return prisma.board.create({
    data: { projectId, name: "Board", columns: { create: DEFAULT_COLUMNS } },
  });
}

/** Columna del tablero que corresponde a un estado de HU, si existe. */
function columnForStatus<T extends { order: number }>(
  columns: T[],
  status: UserStoryStatus | undefined
): T | undefined {
  if (!status) return undefined;
  return columns.find((col) => col.order === STATUS_COLUMN_ORDER[status]);
}

function recordActivity(
  cardId: string,
  actor: CardActor,
  action: string,
  fromValue: string | null,
  toValue: string | null
) {
  return prisma.cardActivity.create({
    data: {
      cardId,
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      action,
      fromValue,
      toValue,
    },
  });
}

// ─── Lectura del tablero ───────────────────────────────────────────────────

/** Tablero del proyecto con columnas y tarjetas ordenadas (viewer+). */
export async function getBoard(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListBoard(projectId);
}

/** Operación (ya autorizada): tablero con columnas y sus tarjetas. */
export async function opListBoard(projectId: string) {
  const board = await ensureBoard(projectId);
  return prisma.board.findUnique({
    where: { id: board.id },
    include: {
      columns: {
        orderBy: { order: "asc" },
        include: {
          cards: {
            orderBy: { order: "asc" },
            include: {
              userStory: { select: { id: true, key: true, title: true, status: true, narrative: true } },
              assignee: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  });
}

// ─── Tarjetas ──────────────────────────────────────────────────────────────

export interface CreateCardInput {
  title: string;
  type?: string;
  description?: string;
  columnId?: string;
  userStoryId?: string;
  assigneeId?: string;
  labels?: unknown;
  /**
   * Estado de la HU que origina la tarjeta: decide la columna inicial cuando no
   * se pasa `columnId`. Quien crea la HU no necesita conocer las columnas —
   * resolverlas sigue siendo responsabilidad de este servicio.
   */
  storyStatus?: UserStoryStatus;
}

/** Carga una tarjeta con el proyecto de su tablero (para validar acceso). */
async function cardWithProject(cardId: string) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: { board: { select: { projectId: true } } },
  });
  if (!card) throw notFound("Tarjeta no encontrada");
  return card;
}

/** Crea una tarjeta en el tablero (member+). */
export async function createCard(userId: string, projectId: string, input: CreateCardInput) {
  await projectWithAccess(userId, projectId, "member");
  return opCreateCard(projectId, input, { actorType: "user", actorId: userId });
}

/** Operación (ya autorizada): crea la tarjeta al final de su columna. */
export async function opCreateCard(projectId: string, input: CreateCardInput, actor: CardActor) {
  const board = await ensureBoard(projectId);
  const title = input.title.trim();
  if (title.length < 1) throw badRequest("El título de la tarjeta está vacío", "empty_title");

  const type = input.type ?? "task";
  if (!CARD_TYPES.includes(type as CardType)) throw badRequest(`Tipo inválido: ${type}`, "invalid_type");

  const columns = await prisma.column.findMany({ where: { boardId: board.id }, orderBy: { order: "asc" } });
  // Sin `columnId` explícito manda el estado de la HU (una HU creada en "review"
  // nace en Revisión, no en Backlog). El fallback a la primera columna cubre un
  // tablero sin la columna esperada: perder la ubicación exacta es preferible a
  // no crear la tarjeta.
  const column = input.columnId
    ? columns.find((col) => col.id === input.columnId)
    : columnForStatus(columns, input.storyStatus) ?? columns[0];
  if (!column) throw badRequest("Columna inválida para este tablero", "invalid_column");

  if (input.userStoryId) {
    const story = await prisma.userStory.findUnique({ where: { id: input.userStoryId } });
    if (!story || story.projectId !== projectId)
      throw badRequest("La HU no pertenece al proyecto", "story_mismatch");
    const existing = await prisma.card.findUnique({ where: { userStoryId: input.userStoryId } });
    if (existing) throw badRequest("Esa HU ya tiene una tarjeta", "story_has_card");
  }

  const last = await prisma.card.findFirst({
    where: { columnId: column.id },
    orderBy: { order: "desc" },
  });
  const order = (last?.order ?? 0) + 1;

  const card = await prisma.card.create({
    data: {
      boardId: board.id,
      columnId: column.id,
      order,
      type,
      title,
      description: input.description?.trim() || null,
      userStoryId: input.userStoryId ?? null,
      assigneeId: input.assigneeId ?? null,
      labels: asJson(input.labels),
    },
  });
  await recordActivity(card.id, actor, "created", null, column.name);
  return card;
}

/** Mueve una tarjeta a otra columna/posición (member+). */
export async function moveCard(
  userId: string,
  cardId: string,
  target: { columnId: string; order?: number }
) {
  const card = await cardWithProject(cardId);
  await projectWithAccess(userId, card.board.projectId, "member");
  return opMoveCard(card, target, { actorType: "user", actorId: userId });
}

/**
 * Operación (ya autorizada): mueve la tarjeta, registra la actividad y espeja
 * la columna destino en el estado de la HU vinculada — la columna es la cara
 * visible del estado, así que arrastrar una tarjeta *es* cambiar el estado.
 */
export async function opMoveCard(
  card: { id: string; boardId: string; columnId: string; userStoryId?: string | null },
  target: { columnId: string; order?: number },
  actor: CardActor
) {
  const [fromColumn, toColumn] = await Promise.all([
    prisma.column.findUnique({ where: { id: card.columnId } }),
    prisma.column.findUnique({ where: { id: target.columnId } }),
  ]);
  if (!toColumn || toColumn.boardId !== card.boardId)
    throw badRequest("La columna destino no pertenece al tablero", "invalid_column");

  let order = target.order;
  if (order === undefined) {
    const last = await prisma.card.findFirst({
      where: { columnId: toColumn.id },
      orderBy: { order: "desc" },
    });
    order = (last?.order ?? 0) + 1;
  }

  const updated = await prisma.card.update({
    where: { id: card.id },
    data: { columnId: toColumn.id, order },
  });
  await recordActivity(card.id, actor, "moved", fromColumn?.name ?? null, toColumn.name);
  await syncStoryStatusToColumn(card.userStoryId ?? null, toColumn.order);
  return updated;
}

/**
 * Escribe en la HU el estado que implica la columna donde quedó su tarjeta.
 *
 * Va directo a Prisma en vez de pasar por `stories.opUpdateStory` por dos
 * motivos: `stories.ts` ya importa este módulo (llamarlo cerraría el ciclo de
 * imports) y `opUpdateStory` mueve la tarjeta al cambiar el estado — es decir,
 * reentraría en el movimiento que se acaba de hacer.
 */
async function syncStoryStatusToColumn(userStoryId: string | null, columnOrder: number) {
  if (!userStoryId) return;
  // Una columna fuera de las cinco por defecto no dice nada del estado de la HU:
  // mejor dejarla como está que inventarle uno.
  const status = statusForColumnOrder(columnOrder);
  if (!status) return;

  const story = await prisma.userStory.findUnique({
    where: { id: userStoryId },
    select: { status: true },
  });
  if (!story || story.status === status) return;
  await prisma.userStory.update({ where: { id: userStoryId }, data: { status } });
}

/**
 * Operación (ya autorizada): lleva la tarjeta a la columna que corresponde al
 * estado de su HU. Usada al editar el estado desde la HU (ver
 * stories.opUpdateStory).
 *
 * Devuelve null cuando no hay nada que mover: sin columna equivalente, o ya
 * estando en ella. Ese corte evita un "moved" vacío en CardActivity, que además
 * le mentiría a `wasLastMovedByUser`.
 */
export async function opMoveCardToStatus(
  card: { id: string; boardId: string; columnId: string; userStoryId?: string | null },
  status: UserStoryStatus,
  actor: CardActor
) {
  const column = await prisma.column.findFirst({
    where: { boardId: card.boardId, order: STATUS_COLUMN_ORDER[status] },
  });
  if (!column || column.id === card.columnId) return null;
  return opMoveCard(card, { columnId: column.id }, actor);
}

/**
 * ¿La última vez que esta tarjeta cambió de columna la movió una persona?
 * Los automatismos (auto-move desde commits) lo consultan para no pisar una
 * decisión manual: quien mueve la tarjeta a mano manda hasta que la vuelva a mover.
 */
export async function wasLastMovedByUser(cardId: string): Promise<boolean> {
  const lastMove = await prisma.cardActivity.findFirst({
    where: { cardId, action: "moved" },
    orderBy: { createdAt: "desc" },
    select: { actorType: true },
  });
  return lastMove?.actorType === "user";
}

/**
 * Operación (ya autorizada): reasigna una tarjeta y registra la actividad. Usada
 * al sincronizar el assignee de la HU vinculada (ver stories.opAssignStory).
 */
export async function opAssignCard(
  card: { id: string; assigneeId: string | null },
  assigneeId: string | null,
  actor: CardActor
) {
  const updated = await prisma.card.update({ where: { id: card.id }, data: { assigneeId } });
  await recordActivity(card.id, actor, "assigned", card.assigneeId, assigneeId);
  return updated;
}

/**
 * Operación (ya autorizada): vincula una tarjeta existente a una HU sin tarjeta.
 * Falla si la HU ya tiene otra tarjeta vinculada.
 */
export async function opLinkStoryToCard(
  card: { id: string },
  story: { id: string },
  actor: CardActor
) {
  const existing = await prisma.card.findUnique({ where: { userStoryId: story.id } });
  if (existing && existing.id !== card.id)
    throw badRequest("Esa HU ya tiene una tarjeta", "story_has_card");

  const updated = await prisma.card.update({ where: { id: card.id }, data: { userStoryId: story.id } });
  await recordActivity(card.id, actor, "linked_story", null, story.id);
  return updated;
}

const CARD_INCLUDE = {
  userStory: { select: { id: true, key: true, title: true, status: true } },
  assignee: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
} as const;

async function validateCardAssignee(projectId: string, assigneeId: string) {
  const contributor = await prisma.contributor.findUnique({ where: { id: assigneeId } });
  if (!contributor || contributor.projectId !== projectId)
    throw badRequest("El asignado no pertenece al proyecto", "assignee_mismatch");
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  type?: string;
  assigneeId?: string | null;
  userStoryId?: string | null;
  labels?: unknown;
}

/** Actualiza campos de una tarjeta (member+) y registra actividad relevante. */
export async function updateCard(userId: string, cardId: string, patch: UpdateCardInput) {
  const card = await cardWithProject(cardId);
  await projectWithAccess(userId, card.board.projectId, "member");
  return opUpdateCard(card, patch, { actorType: "user", actorId: userId });
}

/**
 * Operación (ya autorizada): aplica el patch a una tarjeta ya cargada y deja
 * en CardActivity un evento por cada campo que realmente cambió.
 */
export async function opUpdateCard(
  card: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    assigneeId: string | null;
    userStoryId: string | null;
    board: { projectId: string };
  },
  patch: UpdateCardInput,
  actor: CardActor
) {
  const projectId = card.board.projectId;

  const data: Prisma.CardUpdateInput = {};
  const activities: Array<{ action: string; from: string | null; to: string | null }> = [];

  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 1) throw badRequest("El título está vacío", "empty_title");
    if (t !== card.title) {
      data.title = t;
      activities.push({ action: "updated", from: card.title, to: t });
    }
  }
  if (patch.description !== undefined) {
    const next = patch.description?.trim() || null;
    if (next !== card.description) data.description = next;
  }
  if (patch.type !== undefined) {
    if (!CARD_TYPES.includes(patch.type as CardType))
      throw badRequest(`Tipo inválido: ${patch.type}`, "invalid_type");
    if (patch.type !== card.type) {
      data.type = patch.type;
      activities.push({ action: "updated", from: card.type, to: patch.type });
    }
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId) await validateCardAssignee(projectId, patch.assigneeId);
    if (patch.assigneeId !== card.assigneeId) {
      data.assignee = patch.assigneeId
        ? { connect: { id: patch.assigneeId } }
        : { disconnect: true };
      activities.push({
        action: "assigned",
        from: card.assigneeId,
        to: patch.assigneeId,
      });
    }
  }
  if (patch.labels !== undefined) data.labels = asJson(patch.labels);

  if (patch.userStoryId !== undefined && patch.userStoryId !== card.userStoryId) {
    if (patch.userStoryId) {
      const story = await prisma.userStory.findUnique({ where: { id: patch.userStoryId } });
      if (!story || story.projectId !== projectId)
        throw badRequest("La HU no pertenece al proyecto", "story_mismatch");
      const existing = await prisma.card.findUnique({ where: { userStoryId: patch.userStoryId } });
      if (existing && existing.id !== card.id)
        throw badRequest("Esa HU ya tiene una tarjeta", "story_has_card");
      data.userStory = { connect: { id: patch.userStoryId } };
      activities.push({ action: "linked_story", from: card.userStoryId, to: patch.userStoryId });
    } else {
      data.userStory = { disconnect: true };
      activities.push({ action: "unlinked_story", from: card.userStoryId, to: null });
    }
  }

  if (Object.keys(data).length === 0) {
    return prisma.card.findUniqueOrThrow({
      where: { id: card.id },
      include: CARD_INCLUDE,
    });
  }

  const updated = await prisma.card.update({
    where: { id: card.id },
    data,
    include: CARD_INCLUDE,
  });

  for (const a of activities) {
    await recordActivity(card.id, actor, a.action, a.from, a.to);
  }

  return updated;
}

/** Elimina una tarjeta del tablero (member+). */
export async function deleteCard(userId: string, cardId: string) {
  const card = await cardWithProject(cardId);
  await projectWithAccess(userId, card.board.projectId, "member");
  return opDeleteCard(card.id);
}

/**
 * Operación (ya autorizada): elimina la tarjeta.
 *
 * La HU vinculada NO se toca: borrar la tarjeta es limpiar el tablero, no
 * renunciar al trabajo que la HU describe. En sentido inverso sí hay cascada
 * (`opDeleteStory`), porque desde PEM-13 la tarjeta nace como efecto de la HU.
 * `CardActivity` cae por `onDelete: Cascade`: su historial habla de una tarjeta
 * que ya no existe, y conservarlo dejaría actividad imposible de abrir.
 */
export async function opDeleteCard(cardId: string) {
  try {
    await prisma.card.delete({ where: { id: cardId } });
  } catch (err) {
    // Carrera con otro borrado entre la carga y el delete: 404, no 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      throw notFound("Tarjeta no encontrada");
    throw err;
  }
  return { ok: true };
}

/** Actividad reciente de una tarjeta (viewer+). */
export async function listCardActivities(userId: string, cardId: string, limit = 50) {
  const card = await cardWithProject(cardId);
  await projectWithAccess(userId, card.board.projectId);
  return opListCardActivities(cardId, limit);
}

/** Operación (ya autorizada): actividad reciente de una tarjeta, con nombres de actor. */
export async function opListCardActivities(cardId: string, limit = 50) {
  const take = Math.min(Math.max(limit, 1), 100);
  const activities = await prisma.cardActivity.findMany({
    where: { cardId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return resolveActorNames(activities);
}

/** Carga una tarjeta cruda por id (para que el transporte valide su proyecto). */
export function getCardWithProject(cardId: string) {
  return prisma.card.findUnique({
    where: { id: cardId },
    include: { board: { select: { projectId: true } } },
  });
}
