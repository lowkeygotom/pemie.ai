// PEM-56: se doblan los delegates del singleton para probar las reglas que
// Prisma no puede expresar: coalescing, vencimiento y prefijos de paths.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import * as activityService from "./agent-activity.js";

/** Reemplaza un miembro cualquiera del cliente Prisma (delegate o método propio). */
function stubClientMember(t: TestContext, member: string, value: unknown) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[member];
  Object.defineProperty(client, member, { value, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, member, { value: original, configurable: true, writable: true });
  });
}

type Row = {
  id: string; projectId: string; apiKeyId: string; agentId: string | null; ownerUserId: string | null;
  summary: string; state: "working" | "blocked" | "done"; userStoryId: string | null; cardId: string | null;
  paths: string[]; intervalSeconds: number; model: string | null; startedAt: Date; lastSeenAt: Date; beats: number;
  owner?: { id: string; name: string | null; avatarUrl: string | null } | null;
  agent?: { id: string; name: string } | null;
  userStory?: { id: string; key: string; title: string } | null;
};

type ContributorRow = {
  id: string; githubLogin: string; name: string | null; avatarUrl: string | null; userId: string | null;
};

function row(overrides: Partial<Row> = {}): Row {
  const now = new Date();
  return { id: "activity-1", projectId: "project-1", apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1", summary: "Implementa PEM-56", state: "working", userStoryId: null, cardId: null, paths: [], intervalSeconds: 60, model: null, startedAt: now, lastSeenAt: now, beats: 1, ...overrides };
}

function stubActivity(
  t: TestContext,
  rows: Row[],
  options: {
    agentOwnerId?: string | null;
    findContributors?: (args: { where: { projectId: string; userId: { in: string[] } } }) => Promise<ContributorRow[]>;
  } = {}
) {
  stubClientMember(t, "agentActivity", {
    findFirst: async ({ where }: { where: { apiKeyId: string } }) =>
      [...rows].filter((item) => item.apiKeyId === where.apiKeyId).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0] ?? null,
    findMany: async () => rows,
    create: async ({ data }: { data: Omit<Row, "id" | "startedAt" | "lastSeenAt" | "beats"> }) => {
      const created = row({ ...data, id: `activity-${rows.length + 1}` });
      rows.push(created);
      return created;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<{ lastSeenAt: Date; beats: { increment: number }; paths: string[]; ownerUserId: string; state: Row["state"] }> }) => {
      const current = rows.find((item) => item.id === where.id)!;
      if (data.lastSeenAt) current.lastSeenAt = data.lastSeenAt;
      if (data.beats) current.beats += data.beats.increment;
      if (data.paths) current.paths = data.paths;
      if (data.ownerUserId) current.ownerUserId = data.ownerUserId;
      if (data.state) current.state = data.state;
      return current;
    },
  });
  stubClientMember(t, "agent", {
    findUnique: async () => options.agentOwnerId === undefined ? null : { ownerId: options.agentOwnerId },
  });
  stubClientMember(t, "contributor", {
    findMany: options.findContributors ?? (async () => []),
  });
}

test("coalescing: un path nuevo amplía el tramo y acumula paths sin crear una fila", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows);
  const actor = { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" };
  await activityService.opReportActivity("project-1", { summary: "Implementa PEM-56", paths: ["apps/api/src/a.ts"] }, actor);
  const second = await activityService.opReportActivity("project-1", { summary: "Implementa PEM-56", paths: ["apps/api/src/b.ts", "apps/api/src/a.ts"] }, actor);

  assert.equal(rows.length, 1);
  assert.ok(second.activity);
  assert.equal(second.activity.beats, 2);
  assert.equal(second.activity.intervalSeconds, 300);
  assert.deepEqual(second.activity.paths, ["apps/api/src/a.ts", "apps/api/src/b.ts"]);
});

test("coalescing: cambiar el resumen abre un tramo nuevo y cierra el anterior", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows);
  const actor = { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" };

  await activityService.opReportActivity("project-1", { summary: "Implementa servicio", paths: ["a.ts"] }, actor);
  const second = await activityService.opReportActivity("project-1", { summary: "Ajusta interfaz", paths: ["b.ts"] }, actor);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.state, "done");
  assert.equal(rows[1]!.state, "working");
  assert.equal(second.activity?.summary, "Ajusta interfaz");
});

test("coalescing: cambiar el resumen no toca un tramo ya cerrado", async (t) => {
  const rows = [row({ state: "done", lastSeenAt: new Date(Date.now() - 10_000) })];
  stubActivity(t, rows);
  const actor = { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" };

  await activityService.opReportActivity("project-1", { summary: "Ajusta interfaz", paths: ["b.ts"] }, actor);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.summary, "Implementa PEM-56");
  assert.equal(rows[0]!.state, "done");
});

test("hook: sin summary extiende el tramo abierto y acumula paths", async (t) => {
  const rows = [row({ paths: ["apps/api/src/a.ts"] })];
  stubActivity(t, rows);

  const result = await activityService.opReportActivity(
    "project-1",
    { paths: ["apps/api/src/b.ts"] },
    { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" }
  );

  assert.equal(rows.length, 1);
  assert.equal(result.activity?.summary, "Implementa PEM-56");
  assert.equal(result.activity?.beats, 2);
  assert.deepEqual(result.activity?.paths, ["apps/api/src/a.ts", "apps/api/src/b.ts"]);
});

test("hook: sin summary ni tramo abierto crea un fallback honesto", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows);

  const result = await activityService.opReportActivity(
    "project-1",
    { paths: ["apps/api/src/a.ts"] },
    { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" }
  );

  assert.equal(rows.length, 1);
  assert.equal(result.activity?.summary, "Edición de archivos sin tarea declarada");
  assert.deepEqual(result.activity?.paths, ["apps/api/src/a.ts"]);
});

test("hook: sin summary ni paths no escribe actividad", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows);

  const result = await activityService.opReportActivity(
    "project-1",
    {},
    { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" }
  );

  assert.equal(rows.length, 0);
  assert.equal(result.activity, null);
  assert.deepEqual(result.conflicts, []);
});

test("vigencia: resuelve active, idle y closed según estado y antigüedad", async (t) => {
  const now = Date.now();
  const rows = [
    row({ id: "active", lastSeenAt: new Date(now - 10_000), intervalSeconds: 60 }),
    row({ id: "idle", apiKeyId: "key-2", lastSeenAt: new Date(now - 181_000), intervalSeconds: 60 }),
    row({ id: "closed-done", apiKeyId: "key-3", state: "done", lastSeenAt: new Date(now - 10_000) }),
    row({ id: "closed-old", apiKeyId: "key-4", lastSeenAt: new Date(now - 8 * 60 * 60_000 - 1) }),
  ];
  stubActivity(t, rows);

  const result = await activityService.opListActivity("project-1");

  assert.deepEqual(result.history.map((activity) => activity.status), ["active", "idle", "closed", "closed"]);
  assert.deepEqual(result.live.map((activity) => activity.id), ["active", "idle"]);
});

test("solape: un prefijo de directorio choca con un archivo bajo ese directorio", async (t) => {
  const other = row({ id: "activity-other", apiKeyId: "key-2", agentId: "agent-2", paths: ["apps/api/src/mcp/index.ts"] });
  const rows = [other];
  stubActivity(t, rows);

  const result = await activityService.opReportActivity(
    "project-1",
    { summary: "Edita servicios", paths: ["apps/api/src/"] },
    { apiKeyId: "key-1", agentId: "agent-1" }
  );

  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0]!.reasons, ["path"]);
  assert.deepEqual(result.conflicts[0]!.overlappingPaths, ["apps/api/src"]);
});

test("conflictos: excluye tramos de la misma key pero conserva los de otra key", async (t) => {
  const rows = [
    row({ id: "same-actor", paths: ["apps/api/src/shared.ts"] }),
    row({ id: "other-actor", apiKeyId: "key-2", agentId: "agent-2", paths: ["apps/api/src/shared.ts"] }),
  ];
  stubActivity(t, rows);

  const result = await activityService.opReportActivity(
    "project-1",
    { summary: "Nuevo tramo", paths: ["apps/api/src/shared.ts"] },
    { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" }
  );

  assert.deepEqual(result.conflicts.map((conflict) => conflict.activity.apiKeyId), ["key-2"]);
});

test("conflictos: un tramo idle sigue avisando e incluye vigencia, antigüedad e identidad", async (t) => {
  const seenAt = new Date(Date.now() - 20 * 60_000);
  const other = row({
    id: "activity-other",
    apiKeyId: "key-2",
    agentId: "agent-2",
    ownerUserId: "user-2",
    paths: ["apps/api/src/mcp/index.ts"],
    intervalSeconds: 300,
    lastSeenAt: seenAt,
    owner: { id: "user-2", name: "Julián", avatarUrl: null },
  });
  const rows = [other];
  stubActivity(t, rows, {
    findContributors: async () => [{ id: "contributor-2", githubLogin: "julian", name: "Julián", avatarUrl: "avatar-2", userId: "user-2" }],
  });

  const result = await activityService.opReportActivity(
    "project-1",
    { summary: "Edita servicios", paths: ["apps/api/src/"] },
    { apiKeyId: "key-1", agentId: "agent-1" }
  );

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]!.status, "idle");
  assert.ok(result.conflicts[0]!.ageSeconds >= 20 * 60);
  assert.equal(result.conflicts[0]!.activity.contributor?.githubLogin, "julian");
});

test("escritura: una key de proyecto hereda la persona dueña del Agent", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows, { agentOwnerId: "user-owner" });

  const result = await activityService.opReportActivity(
    "project-1",
    { summary: "Implementa identidad visual" },
    { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: null }
  );

  assert.ok(result.activity);
  assert.equal(result.activity.ownerUserId, "user-owner");
  assert.equal(rows[0]!.ownerUserId, "user-owner");
});

test("identidad: la foto sale del Contributor vinculado cuando existe", async (t) => {
  const rows = [row({ owner: { id: "user-1", name: "Bryan", avatarUrl: null } })];
  stubActivity(t, rows, {
    findContributors: async () => [{ id: "contributor-1", githubLogin: "bryan", name: "Bryan Riano", avatarUrl: "https://avatars.example/bryan", userId: "user-1" }],
  });

  const result = await activityService.opListActivity("project-1");

  assert.equal(result.history[0]!.contributor?.avatarUrl, "https://avatars.example/bryan");
  assert.equal(result.history[0]!.contributor?.githubLogin, "bryan");
});

test("identidad: conserva owner como fallback cuando no existe Contributor", async (t) => {
  const owner = { id: "user-1", name: "Bryan", avatarUrl: null };
  const rows = [row({ owner })];
  stubActivity(t, rows);

  const result = await activityService.opListActivity("project-1");

  assert.equal(result.history[0]!.contributor, null);
  assert.deepEqual(result.history[0]!.owner, owner);
});

test("identidad: resuelve todos los Contributors de la página en una sola consulta", async (t) => {
  const rows = [
    row({ id: "activity-1", ownerUserId: "user-1" }),
    row({ id: "activity-2", apiKeyId: "key-2", ownerUserId: "user-2" }),
  ];
  let calls = 0;
  let requestedUserIds: string[] = [];
  stubActivity(t, rows, {
    findContributors: async ({ where }) => {
      calls += 1;
      requestedUserIds = where.userId.in;
      return [
        { id: "contributor-1", githubLogin: "bryan", name: "Bryan", avatarUrl: "avatar-1", userId: "user-1" },
        { id: "contributor-2", githubLogin: "julian", name: "Julián", avatarUrl: "avatar-2", userId: "user-2" },
      ];
    },
  });

  const result = await activityService.opListActivity("project-1");

  assert.equal(calls, 1);
  assert.deepEqual(requestedUserIds, ["user-1", "user-2"]);
  assert.deepEqual(result.history.map((activity) => activity.contributor?.id), ["contributor-1", "contributor-2"]);
});
