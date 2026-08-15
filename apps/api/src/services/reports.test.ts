// PEM-47: el informe del día incluye commits + actividad de tablero
// (movimientos genéricos y cambios de estado de HU), no solo commits.
//
// Se sustituye el delegate entero en vez de un método suelto porque los
// delegates de Prisma son proxies: `t.mock.method` no encuentra sus métodos.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { STATUS_COLUMN_ORDER } from "@pemie/shared";
import { prisma } from "../db.js";
import * as board from "./board.js";
import { computeDayMetrics, opPublishReport } from "./reports.js";

/** Reemplaza un delegate de Prisma por un doble y lo restaura al terminar. */
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
  select?: Row;
}

const DAY = "2026-08-13";
const PROJECT = "project-1";

const COLUMNS = [
  { id: "col-0", boardId: "board-1", name: "Backlog", order: STATUS_COLUMN_ORDER.backlog },
  { id: "col-1", boardId: "board-1", name: "Ready", order: STATUS_COLUMN_ORDER.ready },
  { id: "col-2", boardId: "board-1", name: "In Progress", order: STATUS_COLUMN_ORDER.in_progress },
  { id: "col-3", boardId: "board-1", name: "Review", order: STATUS_COLUMN_ORDER.review },
  { id: "col-4", boardId: "board-1", name: "Done", order: STATUS_COLUMN_ORDER.done },
];

/** Dobles mínimos para computeDayMetrics / opPublishReport. */
function stubDayData(
  t: TestContext,
  seed: {
    commits?: Array<{ domain: string; contributorId: string }>;
    moves?: Array<{ userStoryId: string | null }>;
  } = {}
) {
  const upserts: Row[] = [];
  stubDelegate(t, "commit", {
    findMany: async () => seed.commits ?? [],
  });
  stubDelegate(t, "cardActivity", {
    findMany: async () =>
      (seed.moves ?? []).map((m, i) => ({
        id: `act-${i}`,
        card: { userStoryId: m.userStoryId },
      })),
  });
  stubDelegate(t, "report", {
    upsert: async ({ create, update }: { create: Row; update: Row }) => {
      const row = { id: "report-1", ...create, ...update };
      upserts.push(row);
      return row;
    },
  });
  return { upserts };
}

test("día con commits: metrics refleja total, contribuidores y byDomain", async (t) => {
  stubDayData(t, {
    commits: [
      { domain: "api", contributorId: "c1" },
      { domain: "api", contributorId: "c2" },
      { domain: "web", contributorId: "c1" },
    ],
  });

  const metrics = await computeDayMetrics(PROJECT, DAY);

  assert.deepEqual(metrics, {
    commits: 3,
    contributors: 2,
    byDomain: { api: 2, web: 1 },
    cardMoves: 0,
    storyStatusChanges: 0,
  });
});

test("día con movimientos de tablero sin commits: cardMoves > 0", async (t) => {
  stubDayData(t, {
    moves: [{ userStoryId: null }, { userStoryId: null }],
  });

  const metrics = await computeDayMetrics(PROJECT, DAY);

  assert.equal(metrics?.commits, 0);
  assert.equal(metrics?.cardMoves, 2);
  assert.equal(metrics?.storyStatusChanges, 0);
});

test("cambio de estado de HU via opMoveCardToStatus cuenta como storyStatusChanges", async (t) => {
  // Tablero en memoria: mover la card con userStoryId deja un "moved" que
  // computeDayMetrics debe clasificar como cambio de estado de HU.
  const activities: Array<{ cardId: string; action: string; card: { userStoryId: string | null } }> =
    [];
  const card = {
    id: "card-1",
    boardId: "board-1",
    columnId: "col-0",
    userStoryId: "story-1",
    order: 1,
  };
  const story = { id: "story-1", status: "backlog" };

  stubDelegate(t, "column", {
    findFirst: async ({ where }: Args) => COLUMNS.find((c) => c.order === where?.order) ?? null,
    findUnique: async ({ where }: Args) => COLUMNS.find((c) => c.id === where?.id) ?? null,
  });
  stubDelegate(t, "card", {
    findFirst: async () => null,
    update: async ({ data }: Args) => {
      Object.assign(card, data);
      return { ...card };
    },
  });
  stubDelegate(t, "cardActivity", {
    create: async ({ data }: Args) => {
      activities.push({
        cardId: data!.cardId as string,
        action: data!.action as string,
        card: { userStoryId: card.userStoryId },
      });
      return data;
    },
    findMany: async () =>
      activities
        .filter((a) => a.action === "moved")
        .map((a) => ({ card: { userStoryId: a.card.userStoryId } })),
  });
  stubDelegate(t, "userStory", {
    findUnique: async () => story,
    update: async ({ data }: Args) => Object.assign(story, data),
  });
  stubDelegate(t, "commit", { findMany: async () => [] });

  await board.opMoveCardToStatus(card, "in_progress", { actorType: "user", actorId: "user-1" });

  assert.equal(activities.length, 1, "opMoveCardToStatus debe registrar un moved");
  assert.equal(activities[0]!.action, "moved");

  const metrics = await computeDayMetrics(PROJECT, DAY);

  assert.equal(metrics?.storyStatusChanges, 1);
  assert.equal(metrics?.cardMoves, 0);
  assert.equal(metrics?.commits, 0);
});

test("día vacío: metrics en cero, nunca null cuando scope=day", async (t) => {
  const { upserts } = stubDayData(t);

  const metrics = await computeDayMetrics(PROJECT, DAY);
  assert.deepEqual(metrics, {
    commits: 0,
    contributors: 0,
    byDomain: {},
    cardMoves: 0,
    storyStatusChanges: 0,
  });

  await opPublishReport(PROJECT, { date: DAY, scope: "day", comment: "sin actividad" });

  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0]!.metrics, {
    commits: 0,
    contributors: 0,
    byDomain: {},
    cardMoves: 0,
    storyStatusChanges: 0,
  });
});

test("fecha inválida: computeDayMetrics devuelve null", async () => {
  assert.equal(await computeDayMetrics(PROJECT, "no-es-fecha"), null);
});
