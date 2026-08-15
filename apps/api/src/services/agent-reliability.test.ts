// PEM-48: confiabilidad de agentes. Se ejercita el servicio real contra dobles
// de Prisma (mismo patrón que drift.test.ts): lo que se afirma es qué cuenta
// como reversión humana de un moved/assigned de agente, no si Prisma funciona.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import * as agentReliability from "./agent-reliability.js";

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const hoursAgo = (n: number) => new Date(Date.now() - n * MS_PER_HOUR);
const daysAgo = (n: number) => new Date(Date.now() - n * MS_PER_DAY);

const COLUMNS = [
  { name: "Backlog", order: 0 },
  { name: "Por hacer", order: 1 },
  { name: "En progreso", order: 2 },
  { name: "Revisión", order: 3 },
  { name: "Hecho", order: 4 },
];

/** Reemplaza un miembro cualquiera del cliente Prisma (delegate o método propio). */
function stubClientMember(t: TestContext, member: string, value: unknown) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[member];
  Object.defineProperty(client, member, { value, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, member, { value: original, configurable: true, writable: true });
  });
}

interface Activity {
  cardId: string;
  actorType: "user" | "agent";
  action: "moved" | "assigned";
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

function stubReliability(
  t: TestContext,
  seed: { columns?: typeof COLUMNS; activities?: Activity[]; board?: { id: string } | null }
) {
  stubClientMember(t, "board", {
    findFirst: async () => (seed.board === undefined ? { id: "board-1" } : seed.board),
  });
  stubClientMember(t, "column", { findMany: async () => seed.columns ?? COLUMNS });
  stubClientMember(t, "cardActivity", { findMany: async () => seed.activities ?? [] });
}

function moved(
  cardId: string,
  actorType: Activity["actorType"],
  fromValue: string | null,
  toValue: string,
  createdAt: Date
): Activity {
  return { cardId, actorType, action: "moved", fromValue, toValue, createdAt };
}

function assigned(
  cardId: string,
  actorType: Activity["actorType"],
  fromValue: string | null,
  toValue: string | null,
  createdAt: Date
): Activity {
  return { cardId, actorType, action: "assigned", fromValue, toValue, createdAt };
}

// ─── Un caso por criterio de aceptación ─────────────────────────────────

test("AC1: humano mueve desde la columna del agente hacia una anterior → revertida", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Por hacer", "En progreso", hoursAgo(10)),
      moved("c1", "user", "En progreso", "Por hacer", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 1);
  assert.equal(report.revertedActions, 1);
  assert.equal(report.survivalRate, 0);
  assert.deepEqual(report.byAction.moved, { actions: 1, reverted: 1 });
});

test("AC1: humano toca la tarjeta pero no deshace el movimiento concreto → sobrevive", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Por hacer", "En progreso", hoursAgo(10)),
      // Sale de otra columna: no es el undo del moved del agente.
      moved("c1", "user", "Revisión", "Por hacer", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.revertedActions, 0);
  assert.equal(report.survivalRate, 1);
});

test("AC2: humano mueve hacia una columna posterior del flujo → no es reversión", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Por hacer", "En progreso", hoursAgo(10)),
      moved("c1", "user", "En progreso", "Revisión", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 1);
  assert.equal(report.revertedActions, 0);
  assert.equal(report.survivalRate, 1);
});

test("AC3: humano reasigna a otra persona la tarjeta que el agente acababa de asignar → revertida", async (t) => {
  stubReliability(t, {
    activities: [
      assigned("c1", "agent", null, "person-a", hoursAgo(10)),
      assigned("c1", "user", "person-a", "person-b", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 1);
  assert.equal(report.revertedActions, 1);
  assert.equal(report.survivalRate, 0);
  assert.deepEqual(report.byAction.assigned, { actions: 1, reverted: 1 });
});

test("AC4: actividad solo humana no entra al cálculo → survivalRate null", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "user", "Backlog", "En progreso", hoursAgo(10)),
      assigned("c1", "user", null, "person-a", hoursAgo(9)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 0);
  assert.equal(report.revertedActions, 0);
  assert.equal(report.survivalRate, null);
});

test("AC5: windowDays y settleHours viajan en la respuesta y son configurables", async (t) => {
  stubReliability(t, {
    activities: [moved("c1", "agent", "Backlog", "Por hacer", hoursAgo(10))],
  });

  const report = await agentReliability.opAgentReliability("project-1", {
    windowDays: 7,
    settleHours: 1,
  });

  assert.equal(report.windowDays, 7);
  assert.equal(report.settleHours, 1);
  assert.equal(report.agentActions, 1);
});

// ─── Bordes ─────────────────────────────────────────────────────────────

test("agente superado por otro agente no cuenta como reversión", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Backlog", "En progreso", hoursAgo(10)),
      moved("c1", "agent", "En progreso", "Revisión", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 2);
  assert.equal(report.revertedActions, 0);
  assert.equal(report.survivalRate, 1);
});

test("nombre de columna desconocido no cuenta como revertida", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Por hacer", "Columna fantasma", hoursAgo(10)),
      moved("c1", "user", "Columna fantasma", "Backlog", hoursAgo(8)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 1);
  assert.equal(report.revertedActions, 0, "sin order conocido no se afirma una reversión");
  assert.equal(report.survivalRate, 1);
});

test("ventana vacía → survivalRate null", async (t) => {
  stubReliability(t, { activities: [] });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 0);
  assert.equal(report.survivalRate, null);
  assert.equal(report.windowDays, 30);
  assert.equal(report.settleHours, 2);
});

test("acción dentro del período de asentamiento queda fuera del denominador", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Backlog", "En progreso", hoursAgo(1)),
      moved("c1", "user", "En progreso", "Backlog", hoursAgo(0.5)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 0, "demasiado reciente: nadie tuvo chance real de revertir");
  assert.equal(report.survivalRate, null);
});

test("cadenas moved y assigned son independientes en la misma tarjeta", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Por hacer", "En progreso", hoursAgo(12)),
      assigned("c1", "agent", null, "person-a", hoursAgo(11)),
      assigned("c1", "user", "person-a", "person-b", hoursAgo(10)),
      moved("c1", "user", "En progreso", "Revisión", hoursAgo(9)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1");

  assert.equal(report.agentActions, 2);
  assert.equal(report.revertedActions, 1);
  assert.deepEqual(report.byAction.moved, { actions: 1, reverted: 0 });
  assert.deepEqual(report.byAction.assigned, { actions: 1, reverted: 1 });
  assert.equal(report.survivalRate, 0.5);
});

test("windowDays recorta acciones de agente anteriores a la ventana", async (t) => {
  stubReliability(t, {
    activities: [
      moved("c1", "agent", "Backlog", "En progreso", daysAgo(10)),
      moved("c2", "agent", "Backlog", "En progreso", daysAgo(2)),
    ],
  });

  const report = await agentReliability.opAgentReliability("project-1", { windowDays: 3 });

  assert.equal(report.windowDays, 3);
  assert.equal(report.agentActions, 1);
  assert.equal(report.survivalRate, 1);
});
