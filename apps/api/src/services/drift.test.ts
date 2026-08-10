// PEM-50: detección de drift. Se ejercita el servicio real contra dobles de
// Prisma (mismo patrón que story-card-sync.test.ts): lo que se afirma es qué
// alertas produce cada combinación de tablero + evidencia de commits, no si
// Prisma en sí funciona.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import * as drift from "./drift.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const daysAgo = (n: number) => new Date(Date.now() - n * MS_PER_DAY);

// Columnas por defecto (DEFAULT_COLUMNS en board.ts): las mismas que el
// mapeo estático STATUS_COLUMN_ORDER, así que este servicio nunca hardcodea
// "Hecho" — lo resuelve leyendo estas filas.
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

interface JoinRow {
  storyId: string;
  key: string;
  title: string;
  status: string;
  committedAt: Date | null;
}
interface Activity {
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  card: { userStoryId: string | null };
}

/**
 * Doble del proyecto: la fila (o filas) que devolvería el `$queryRaw` de
 * historia+commits, más las columnas del tablero y el historial de
 * movimientos que consulta `opDetectDrift`.
 */
function stubDrift(
  t: TestContext,
  seed: { rows: JoinRow[]; columns?: typeof COLUMNS; activities?: Activity[] }
) {
  stubClientMember(t, "$queryRaw", async () => seed.rows);
  stubClientMember(t, "board", { findFirst: async () => ({ id: "board-1" }) });
  stubClientMember(t, "column", { findMany: async () => seed.columns ?? COLUMNS });
  stubClientMember(t, "cardActivity", { findMany: async () => seed.activities ?? [] });
}

// ─── Un caso por tipo de alerta ─────────────────────────────────────────

test("HU done sin ningún commit NO alerta: cerrar sin código es legítimo", async (t) => {
  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-1", title: "Spike de investigación", status: "done", committedAt: null },
      // "Ancla" que prueba que el proyecto sí correlaciona commits con keys
      // (guard de correlationAvailable): sin esta fila, cero commits en todo
      // el proyecto haría el reporte vacío por regla, no por evidencia real.
      { storyId: "s2", key: "PEM-9", title: "Otra HU con evidencia", status: "done", committedAt: daysAgo(1) },
    ],
    activities: [
      { fromValue: "Revisión", toValue: "Hecho", createdAt: daysAgo(3), card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.correlationAvailable, true);
  assert.deepEqual(
    report.alerts,
    [],
    "una HU de investigación/spike/decisión se cierra sin commits; alertarla sería ruido que alguien tendría que descartar a mano"
  );
  assert.deepEqual(report.countsByType, { unreported_work: 0, stalled_wip: 0 });
});

test("HU en backlog con commits -> unreported_work", async (t) => {
  const lastCommit = daysAgo(1);
  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-2", title: "Login con GitHub", status: "backlog", committedAt: daysAgo(5) },
      { storyId: "s1", key: "PEM-2", title: "Login con GitHub", status: "backlog", committedAt: lastCommit },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.alerts.length, 1);
  const [alert] = report.alerts;
  assert.equal(alert!.evidence.type, "unreported_work");
  const evidence = alert!.evidence as { commitCount: number; lastCommitAt: Date };
  assert.equal(evidence.commitCount, 2);
  assert.equal(evidence.lastCommitAt.getTime(), lastCommit.getTime());
});

test("HU in_progress sin commits recientes -> stalled_wip", async (t) => {
  const enteredInFlight = daysAgo(30);
  const lastCommit = daysAgo(20); // más viejo que el umbral default (14 días)
  stubDrift(t, {
    rows: [{ storyId: "s1", key: "PEM-3", title: "Reportes semanales", status: "in_progress", committedAt: lastCommit }],
    activities: [
      { fromValue: "Backlog", toValue: "En progreso", createdAt: enteredInFlight, card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.alerts.length, 1);
  const [alert] = report.alerts;
  assert.equal(alert!.evidence.type, "stalled_wip");
  const evidence = alert!.evidence as { lastCommitAt: Date | null; inFlightSince: Date | null; daysSince: number };
  assert.equal(evidence.lastCommitAt?.getTime(), lastCommit.getTime());
  assert.equal(evidence.daysSince, 20);
});

// ─── Sin correlación ────────────────────────────────────────────────────

test("proyecto sin ningún commit referenciando una key -> sin correlación, cero alertas", async (t) => {
  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-4", title: "Feature sin commits", status: "in_progress", committedAt: null },
      { storyId: "s2", key: "PEM-5", title: "Otra feature", status: "done", committedAt: null },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.correlationAvailable, false);
  assert.deepEqual(report.alerts, []);
  assert.deepEqual(report.countsByType, { unreported_work: 0, stalled_wip: 0 });
});

// ─── El umbral aplica también cuando NO hay ningún commit ────────────────

test("HU recién movida a en curso, sin commits todavía, NO alerta", async (t) => {
  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-11", title: "Recién arrancada", status: "in_progress", committedAt: null },
      // Ancla de correlación (ver comentario equivalente arriba).
      { storyId: "s2", key: "PEM-12", title: "Otra HU con evidencia", status: "done", committedAt: daysAgo(1) },
    ],
    activities: [
      { fromValue: "Backlog", toValue: "En progreso", createdAt: daysAgo(1), card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.deepEqual(
    report.alerts,
    [],
    "mover una tarjeta a 'En progreso' no puede generar una alerta en el acto: el umbral rige tanto para el último commit como para la entrada al grupo"
  );
});

test("HU en curso sin commits y sin historial de movimientos NO alerta", async (t) => {
  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-13", title: "Tarjeta creada ya en curso", status: "in_progress", committedAt: null },
      { storyId: "s2", key: "PEM-14", title: "Otra HU con evidencia", status: "done", committedAt: daysAgo(1) },
    ],
    activities: [],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.deepEqual(
    report.alerts,
    [],
    "sin último commit ni fecha de entrada no hay forma de saber cuánto lleva estancada: afirmar '0 días' sería inventar la evidencia"
  );
});

test("commits anteriores a la entrada al grupo no cuentan como avance del ciclo actual", async (t) => {
  const enteredInFlight = daysAgo(20);
  stubDrift(t, {
    rows: [
      // El commit es de un ciclo anterior: 40 días atrás, mucho antes de que la
      // HU volviera a entrar en curso hace 20.
      { storyId: "s1", key: "PEM-15", title: "Retomada sin avance", status: "in_progress", committedAt: daysAgo(40) },
    ],
    activities: [
      { fromValue: "Backlog", toValue: "En progreso", createdAt: enteredInFlight, card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.alerts.length, 1);
  const evidence = report.alerts[0]!.evidence as { lastCommitAt: Date | null; daysSince: number };
  assert.equal(evidence.lastCommitAt, null, "el commit viejo no pertenece a este ciclo de trabajo");
  assert.equal(evidence.daysSince, 20, "el reloj corre desde la entrada al grupo, no desde un commit de otro ciclo");
});

// ─── in_progress -> review -> in_progress: la frontera del grupo, no el último moved ──

test("in_progress -> review -> in_progress: daysSince cuenta desde la entrada al grupo, no desde el último movimiento interno", async (t) => {
  const enteredInFlight = daysAgo(20); // Backlog -> En progreso: el cruce real de frontera
  const wentToReview = daysAgo(15); // En progreso -> Revisión: interno, no debe resetear
  const backToProgress = daysAgo(10); // Revisión -> En progreso: también interno

  stubDrift(t, {
    rows: [
      { storyId: "s1", key: "PEM-6", title: "Vaivén de revisión", status: "in_progress", committedAt: null },
      // Ancla de correlación (ver comentario equivalente arriba).
      { storyId: "s2", key: "PEM-10", title: "Otra HU con evidencia", status: "done", committedAt: daysAgo(1) },
    ],
    activities: [
      { fromValue: "Backlog", toValue: "En progreso", createdAt: enteredInFlight, card: { userStoryId: "s1" } },
      { fromValue: "En progreso", toValue: "Revisión", createdAt: wentToReview, card: { userStoryId: "s1" } },
      { fromValue: "Revisión", toValue: "En progreso", createdAt: backToProgress, card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.alerts.length, 1);
  const evidence = report.alerts[0]!.evidence as { inFlightSince: Date | null; daysSince: number };
  assert.equal(evidence.inFlightSince?.getTime(), enteredInFlight.getTime());
  assert.equal(evidence.daysSince, 20, "debe contar desde la entrada al grupo, no desde el último 'moved'");
});

// ─── Orden: unreported_work primero, sin importar la fecha ───────────────

test("el orden agrupa por tipo (unreported_work primero) antes que por fecha", async (t) => {
  stubDrift(t, {
    rows: [
      // La estancada arrastra una fecha mucho más vieja...
      { storyId: "s1", key: "PEM-7", title: "Estancada hace rato", status: "in_progress", committedAt: daysAgo(60) },
      // ...que este trabajo no reportado, de ayer.
      { storyId: "s2", key: "PEM-8", title: "Con trabajo reciente", status: "backlog", committedAt: daysAgo(1) },
    ],
    activities: [
      { fromValue: "Backlog", toValue: "En progreso", createdAt: daysAgo(90), card: { userStoryId: "s1" } },
    ],
  });

  const report = await drift.opDetectDrift("project-1");

  assert.equal(report.alerts.length, 2);
  assert.deepEqual(
    report.alerts.map((a) => a.evidence.type),
    ["unreported_work", "stalled_wip"],
    "unreported_work va primero: el tablero está objetivamente mal y se arregla con un clic"
  );
});
