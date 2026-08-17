// Sincronización HU <-> tarjeta Kanban: el estado de la HU y la columna de su
// tarjeta son la misma información contada dos veces, así que los tres caminos
// que escriben (crear HU, editar su estado, mover la tarjeta) tienen que dejar
// las dos caras iguales. Se ejercitan los servicios reales contra dobles de
// Prisma: lo que se verifica es qué escritura sale de cada camino, no Prisma.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import * as board from "./board.js";
import * as stories from "./stories.js";
import { ingestPushEvent } from "./ingest.js";

const USER: board.CardActor = { actorType: "user", actorId: "user-1" };
const AGENT: board.CardActor = { actorType: "agent", actorId: null };

// Las cinco columnas por defecto (DEFAULT_COLUMNS) más una fuera de la escala,
// que solo usa el caso "columna sin estado equivalente".
const COLUMNS = [
  { id: "col-0", boardId: "board-1", name: "Backlog", order: 0 },
  { id: "col-1", boardId: "board-1", name: "Por hacer", order: 1 },
  { id: "col-2", boardId: "board-1", name: "En progreso", order: 2 },
  { id: "col-3", boardId: "board-1", name: "Revisión", order: 3 },
  { id: "col-4", boardId: "board-1", name: "Hecho", order: 4 },
  { id: "col-x", boardId: "board-1", name: "Archivo", order: 9 },
];

/**
 * Reemplaza un delegate de Prisma por un doble y lo restaura al terminar.
 *
 * Se sustituye el delegate entero en vez de un método suelto porque los
 * delegates son proxies: `mock.method` no encuentra sus métodos.
 */
function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, model, { value: original, configurable: true, writable: true });
  });
}

type Row = Record<string, unknown>;
interface Args {
  where?: Row;
  data?: Row;
}

interface Seed {
  story?: Row;
  /** null = la HU no tiene tarjeta vinculada. */
  card?: Row | null;
  /** Actor del último "moved" de la tarjeta, para wasLastMovedByUser. */
  lastMovedBy?: "user" | "agent";
}

/**
 * Doble en memoria del tablero y su HU: una columna por estado, una tarjeta y
 * una HU. Devuelve las escrituras observadas, que es lo que afirman los tests
 * (cuántas y con qué datos, para detectar tanto la falta de sincronía como una
 * reentrada entre los dos lados).
 */
function stubKanban(t: TestContext, seed: Seed = {}) {
  const story: Row = {
    id: "story-1",
    projectId: "project-1",
    key: "PEM-7",
    title: "Buscador global",
    status: "backlog",
    ...seed.story,
  };
  const card: Row | null =
    seed.card === null
      ? null
      : { id: "card-1", boardId: "board-1", columnId: "col-0", userStoryId: story.id, order: 1, ...seed.card };

  const writes = {
    cardUpdates: [] as Row[],
    cardCreates: [] as Row[],
    storyUpdates: [] as Row[],
    activities: [] as Row[],
  };

  stubDelegate(t, "board", { findFirst: async () => ({ id: "board-1", projectId: "project-1" }) });
  stubDelegate(t, "column", {
    findMany: async () => COLUMNS,
    findFirst: async ({ where }: Args) => COLUMNS.find((c) => c.order === where?.order) ?? null,
    findUnique: async ({ where }: Args) => COLUMNS.find((c) => c.id === where?.id) ?? null,
  });
  stubDelegate(t, "card", {
    findUnique: async ({ where }: Args) =>
      card && (where?.userStoryId === undefined || where.userStoryId === card.userStoryId)
        ? card
        : null,
    findFirst: async () => null,
    create: async ({ data }: Args) => {
      writes.cardCreates.push(data!);
      return { id: "card-new", ...data };
    },
    update: async ({ data }: Args) => {
      writes.cardUpdates.push(data!);
      if (card) Object.assign(card, data);
      return { ...card, ...data };
    },
  });
  stubDelegate(t, "cardActivity", {
    create: async ({ data }: Args) => {
      writes.activities.push(data!);
      return data;
    },
    findFirst: async () => (seed.lastMovedBy ? { actorType: seed.lastMovedBy } : null),
  });
  stubDelegate(t, "userStory", {
    findUnique: async () => story,
    create: async ({ data }: Args) => Object.assign(story, data),
    update: async ({ data }: Args) => {
      writes.storyUpdates.push(data!);
      return Object.assign(story, data);
    },
  });
  stubDelegate(t, "project", {
    findUnique: async () => ({ id: "project-1", key: "PEM" }),
    update: async () => ({ storySeq: 7 }),
  });

  return { story, card, writes };
}

// ─── Crear HU -> columna inicial ───────────────────────────────────────────

test("una HU creada en review nace en la columna Revisión, no en Backlog", async (t) => {
  const { writes } = stubKanban(t, { card: null }); // la HU se está creando: aún no tiene tarjeta

  await stories.opCreateStory(
    "project-1",
    { title: "Buscador global", status: "review" },
    { createdById: "user-1" }
  );

  assert.equal(writes.cardCreates.length, 1);
  assert.equal(writes.cardCreates[0]!.columnId, "col-3");
});

test("una HU sin estado explícito sigue naciendo en Backlog", async (t) => {
  const { writes } = stubKanban(t, { card: null });

  await stories.opCreateStory("project-1", { title: "Buscador global" }, { createdById: "user-1" });

  assert.equal(writes.cardCreates[0]!.columnId, "col-0");
});

// ─── Editar el estado de la HU -> mueve la tarjeta ─────────────────────────

test("pasar la HU a done mueve su tarjeta a Hecho sin reentrar en la HU", async (t) => {
  const { writes } = stubKanban(t);

  await stories.opUpdateStory(
    { id: "story-1", projectId: "project-1", status: "backlog" },
    { status: "done" },
    USER
  );

  assert.deepEqual(
    writes.cardUpdates.map((w) => w.columnId),
    ["col-4"]
  );
  assert.equal(
    writes.storyUpdates.length,
    1,
    "el movimiento no puede devolverle otra escritura a la HU: sería el ciclo"
  );
  assert.equal(writes.activities[0]!.actorType, "user", "mover desde la HU conserva al actor");
});

test("guardar la HU con el estado que ya tenía no mueve la tarjeta", async (t) => {
  const { writes } = stubKanban(t);

  await stories.opUpdateStory(
    { id: "story-1", projectId: "project-1", status: "backlog" },
    { status: "backlog", title: "Buscador global v2" },
    USER
  );

  assert.deepEqual(writes.cardUpdates, []);
  assert.deepEqual(writes.activities, []);
});

test("un asignado de otro proyecto rechaza todo el patch antes de escribir", async (t) => {
  const { story, writes } = stubKanban(t);
  stubDelegate(t, "contributor", {
    findUnique: async () => ({ id: "contributor-foreign", projectId: "other-project" }),
  });

  await assert.rejects(
    () =>
      stories.opUpdateStory(
        { id: "story-1", projectId: "project-1", status: "backlog" },
        { title: "Título que no debe guardarse", assigneeId: "contributor-foreign" },
        USER
      ),
    { code: "assignee_mismatch" }
  );

  assert.equal(story.title, "Buscador global");
  assert.deepEqual(writes.storyUpdates, []);
  assert.deepEqual(writes.cardUpdates, []);
});

test("reasignar al mismo contributor es idempotente y no escribe la tarjeta", async (t) => {
  const { story, writes } = stubKanban(t, { story: { assigneeId: "contributor-1" } });
  stubDelegate(t, "contributor", {
    findUnique: async () => ({ id: "contributor-1", projectId: "project-1" }),
  });

  await stories.opAssignStory(story.id as string, "contributor-1", USER);

  assert.deepEqual(writes.storyUpdates, []);
  assert.deepEqual(writes.cardUpdates, []);
});

// ─── Mover la tarjeta -> cambia el estado de la HU ─────────────────────────

test("mover la tarjeta a En progreso deja la HU en in_progress", async (t) => {
  const { card, writes } = stubKanban(t);

  await board.opMoveCard(card as never, { columnId: "col-2" }, AGENT);

  assert.deepEqual(
    writes.storyUpdates.map((w) => w.status),
    ["in_progress"]
  );
  assert.equal(writes.cardUpdates.length, 1, "la tarjeta se escribe una sola vez: no hay ciclo");
  assert.deepEqual(writes.cardCreates, []);
});

test("mover una tarjeta sin HU vinculada no escribe ninguna HU", async (t) => {
  const { card, writes } = stubKanban(t, { card: { userStoryId: null } });

  await board.opMoveCard(card as never, { columnId: "col-2" }, AGENT);

  assert.deepEqual(writes.storyUpdates, []);
});

test("una columna fuera de los cinco estados deja la HU como está", async (t) => {
  const { card, writes } = stubKanban(t);

  await board.opMoveCard(card as never, { columnId: "col-x" }, AGENT);

  assert.equal(writes.cardUpdates.length, 1);
  assert.deepEqual(writes.storyUpdates, [], "sin estado equivalente no se le inventa uno a la HU");
});

test("llevar la tarjeta al estado en el que ya está no escribe nada", async (t) => {
  const { card, writes } = stubKanban(t);

  const moved = await board.opMoveCardToStatus(card as never, "backlog", USER);

  assert.equal(moved, null);
  assert.deepEqual(writes.cardUpdates, []);
  assert.deepEqual(writes.activities, [], "un 'moved' vacío le mentiría a wasLastMovedByUser");
});

// ─── Reasignar la tarjeta -> reasigna la HU ────────────────────────────────

/** Construye el card que espera opUpdateCard (más campos que el que usa opMoveCard). */
function cardForUpdate(card: Row | null, extra: Row = {}): never {
  if (!card) throw new Error("test setup: la HU de este caso necesita una tarjeta vinculada");
  return {
    id: card.id,
    title: "Buscador global",
    description: null,
    type: "task",
    assigneeId: card.assigneeId ?? null,
    userStoryId: card.userStoryId,
    board: { projectId: "project-1" },
    ...extra,
  } as never;
}

test("reasignar la tarjeta escribe la HU vinculada con el mismo assigneeId", async (t) => {
  const { card, writes } = stubKanban(t, {
    card: { assigneeId: "contributor-old" },
    story: { assigneeId: "contributor-old" },
  });
  stubDelegate(t, "contributor", {
    // Sirve a validateCardAssignee (projectId) y a resolveContributorRecipient,
    // que dispara notifyStoryAssigned al reasignar (necesita project.workspaceId).
    findUnique: async () => ({
      id: "contributor-new",
      projectId: "project-1",
      email: null,
      userId: null,
      githubLogin: "contributor-new",
      project: { workspaceId: "workspace-1" },
    }),
  });
  // Sin destinatario resoluble: notifyStoryAssigned no debe pegarle a la DB real.
  stubDelegate(t, "user", { findFirst: async () => null });

  await board.opUpdateCard(cardForUpdate(card), { assigneeId: "contributor-new" }, USER);

  assert.deepEqual(writes.storyUpdates.map((w) => w.assigneeId), ["contributor-new"]);
});

test("reasignar al contributor que ya tiene la HU no escribe la HU (idempotencia)", async (t) => {
  const { card, writes } = stubKanban(t, {
    card: { assigneeId: "contributor-old" },
    story: { assigneeId: "contributor-new" },
  });
  stubDelegate(t, "contributor", {
    findUnique: async () => ({
      id: "contributor-new",
      projectId: "project-1",
      email: null,
      userId: null,
      githubLogin: "contributor-new",
      project: { workspaceId: "workspace-1" },
    }),
  });
  // La tarjeta igual cambia de assignee (assigneeChanged): notifyStoryAssigned
  // se dispara aunque la HU no tenga nada que sincronizar.
  stubDelegate(t, "user", { findFirst: async () => null });

  await board.opUpdateCard(cardForUpdate(card), { assigneeId: "contributor-new" }, USER);

  assert.equal(writes.cardUpdates.length, 1, "la tarjeta sí cambió de assignee");
  assert.deepEqual(writes.storyUpdates, [], "la HU ya tenía ese assignee: no hay nada que sincronizar");
});

test("desasignar la tarjeta desasigna también la HU vinculada", async (t) => {
  const { card, writes } = stubKanban(t, {
    card: { assigneeId: "contributor-1" },
    story: { assigneeId: "contributor-1" },
  });

  await board.opUpdateCard(cardForUpdate(card), { assigneeId: null }, USER);

  assert.deepEqual(writes.storyUpdates.map((w) => w.assigneeId), [null]);
});

test("reasignar una tarjeta sin HU vinculada no escribe ninguna HU", async (t) => {
  const { card, writes } = stubKanban(t, { card: { userStoryId: null, assigneeId: "contributor-old" } });
  stubDelegate(t, "contributor", {
    findUnique: async () => ({ id: "contributor-new", projectId: "project-1" }),
  });

  await board.opUpdateCard(cardForUpdate(card), { assigneeId: "contributor-new" }, USER);

  assert.deepEqual(writes.storyUpdates, []);
});

test("reasignar una tarjeta con HU vinculada devuelve assignmentNotification en el resultado de opUpdateCard", async (t) => {
  const { card } = stubKanban(t, {
    card: { assigneeId: "contributor-old" },
    story: { assigneeId: "contributor-old" },
  });
  stubDelegate(t, "contributor", {
    // Un solo objeto sirve para las dos llamadas que hace opUpdateCard:
    // validateCardAssignee (solo lee projectId) y resolveContributorRecipient
    // (real, no mockeado — lee email/userId/githubLogin/project.workspaceId).
    // Sin email y sin userId, cae a buscar por githubLogin y no encuentra
    // match — reason "no_email". Ejercita el flujo completo (board.ts ->
    // notifications.ts) sin llegar al mailer real.
    findUnique: async () => ({
      id: "contributor-new",
      projectId: "project-1",
      githubLogin: "sin-match",
      userId: null,
      email: null,
      project: { workspaceId: "workspace-1" },
    }),
  });
  stubDelegate(t, "user", { findFirst: async () => null });

  const result = await board.opUpdateCard(cardForUpdate(card), { assigneeId: "contributor-new" }, USER);

  // `opUpdateCard` solo agrega `assignmentNotification` al objeto cuando hubo
  // intento de notificar (ver board.ts): el tipo de retorno es una unión entre
  // "con" y "sin" esa propiedad, así que se angosta con `in` antes de leerla.
  assert.ok("assignmentNotification" in result, "debe incluir assignmentNotification en el resultado");
  assert.deepEqual(result.assignmentNotification, { notified: false, reason: "no_email" });
});

test("editar la tarjeta sin tocar el assignee no escribe la HU", async (t) => {
  const { card, writes } = stubKanban(t, { card: { assigneeId: "contributor-1" }, story: { assigneeId: "contributor-1" } });

  await board.opUpdateCard(cardForUpdate(card), { title: "Buscador global v2" }, USER);

  assert.equal(writes.cardUpdates.length, 1, "el título sí cambió");
  assert.deepEqual(writes.storyUpdates, []);
});

// ─── Auto-move desde commits -> arrastra también el estado ─────────────────
//
// El auto-move ya movía la tarjeta; el estado de la HU lo sincroniza opMoveCard,
// así que este camino no tiene código propio — pero sí es el que más lo usa.

/** Dobles del resto del camino de ingesta (repo, contribuidores, commits). */
function stubIngest(t: TestContext) {
  stubDelegate(t, "repo", {
    findMany: async () => [
      { id: "repo-1", projectId: "project-1", owner: "acme", name: "web", installationId: null },
    ],
    update: async () => ({}),
  });
  stubDelegate(t, "contributor", { upsert: async () => ({ id: "contributor-1" }) });
  stubDelegate(t, "commit", { findMany: async () => [], createMany: async () => ({ count: 1 }) });
}

const pushEvent = (message: string) => ({
  repository: { name: "web", owner: { login: "acme" } },
  commits: [{ id: "sha-1", message, timestamp: "2026-08-04T10:00:00.000Z" }],
});

test("un commit 'fix' lleva la tarjeta a Revisión y la HU a review", async (t) => {
  const { writes } = stubKanban(t);
  stubIngest(t);

  await ingestPushEvent(pushEvent("PEM-7 fix: cerrar el buscador"));

  assert.deepEqual(
    writes.cardUpdates.map((w) => w.columnId),
    ["col-3"]
  );
  assert.deepEqual(
    writes.storyUpdates.map((w) => w.status),
    ["review"]
  );
});

test("una tarjeta colocada a mano no la mueve —ni le cambia el estado— un commit", async (t) => {
  const { writes } = stubKanban(t, { lastMovedBy: "user" });
  stubIngest(t);

  await ingestPushEvent(pushEvent("PEM-7 fix: cerrar el buscador"));

  assert.deepEqual(writes.cardUpdates, []);
  assert.deepEqual(writes.storyUpdates, []);
});
