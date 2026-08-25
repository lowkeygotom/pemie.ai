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
};

function row(overrides: Partial<Row> = {}): Row {
  const now = new Date();
  return { id: "activity-1", projectId: "project-1", apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1", summary: "Implementa PEM-56", state: "working", userStoryId: null, cardId: null, paths: [], intervalSeconds: 60, model: null, startedAt: now, lastSeenAt: now, beats: 1, ...overrides };
}

function stubActivity(t: TestContext, rows: Row[]) {
  stubClientMember(t, "agentActivity", {
    findFirst: async ({ where }: { where: { apiKeyId: string } }) =>
      [...rows].filter((item) => item.apiKeyId === where.apiKeyId).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0] ?? null,
    findMany: async () => rows,
    create: async ({ data }: { data: Omit<Row, "id" | "startedAt" | "lastSeenAt" | "beats"> }) => {
      const created = row({ ...data, id: `activity-${rows.length + 1}` });
      rows.push(created);
      return created;
    },
    update: async ({ where, data }: { where: { id: string }; data: { lastSeenAt: Date; beats: { increment: number } } }) => {
      const current = rows.find((item) => item.id === where.id)!;
      current.lastSeenAt = data.lastSeenAt;
      current.beats += data.beats.increment;
      return current;
    },
  });
}

test("coalescing: dos latidos idénticos quedan en un tramo con beats 2", async (t) => {
  const rows: Row[] = [];
  stubActivity(t, rows);
  const actor = { apiKeyId: "key-1", agentId: "agent-1", ownerUserId: "user-1" };
  const input = { summary: "Implementa PEM-56", paths: ["apps/api/src/"] };

  await activityService.opReportActivity("project-1", input, actor);
  const second = await activityService.opReportActivity("project-1", input, actor);

  assert.equal(rows.length, 1);
  assert.equal(second.activity.beats, 2);
});

test("expiración: un tramo fuera de su TTL desaparece de live pero sigue en history", async (t) => {
  const rows = [row({ lastSeenAt: new Date(Date.now() - 181_000), intervalSeconds: 60 })];
  stubActivity(t, rows);

  const result = await activityService.opListActivity("project-1");

  assert.equal(result.live.length, 0);
  assert.equal(result.history.length, 1);
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
