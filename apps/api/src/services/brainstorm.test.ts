import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import * as brainstorm from "./brainstorm.js";

function stubClientMember(t: TestContext, member: string, value: unknown) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[member];
  Object.defineProperty(client, member, { value, configurable: true, writable: true });
  t.after(() => Object.defineProperty(client, member, { value: original, configurable: true, writable: true }));
}

test("appendSegments es idempotente por sessionId y seq y conserva la marca de agua", async (t) => {
  const token = "recorder-token";
  const session = {
    id: "session-1",
    status: "recording",
    recorderTokenHash: createHash("sha256").update(token).digest("hex"),
    segmentSeq: 0,
    lastRecorderBeatAt: new Date(0),
  };
  const stored = new Map<number, { seq: number; text: string }>();
  const tx = {
    brainstormSession: {
      findUnique: async () => session,
      update: async ({ data }: { data: { segmentSeq: number; lastRecorderBeatAt: Date } }) => {
        session.segmentSeq = data.segmentSeq;
        session.lastRecorderBeatAt = data.lastRecorderBeatAt;
        return session;
      },
    },
    brainstormSegment: {
      createMany: async ({ data }: { data: Array<{ seq: number; text: string }> }) => {
        let count = 0;
        for (const row of data) {
          if (!stored.has(row.seq)) { stored.set(row.seq, row); count += 1; }
        }
        return { count };
      },
    },
  };
  stubClientMember(t, "$transaction", async (operation: (client: typeof tx) => unknown) => operation(tx));
  const segments = [
    { seq: 4, speakerTag: 1, text: "Primera idea", startMs: 0, endMs: 900 },
    { seq: 7, speakerTag: 2, text: "Segunda idea", startMs: 901, endMs: 1800 },
  ];

  assert.deepEqual(await brainstorm.opAppendSegments("session-1", token, segments), { inserted: 2 });
  assert.deepEqual(await brainstorm.opAppendSegments("session-1", token, segments), { inserted: 0 });
  assert.equal(stored.size, 2);
  assert.equal(session.segmentSeq, 7);
});

test("reapAbandonedSessions abandona solo grabaciones sin latido por más de diez minutos", async (t) => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  let received: unknown;
  stubClientMember(t, "brainstormSession", {
    updateMany: async (args: unknown) => { received = args; return { count: 2 }; },
  });

  const result = await brainstorm.reapAbandonedSessions("project-1", now);

  assert.deepEqual(result, { count: 2 });
  assert.deepEqual(received, {
    where: {
      projectId: "project-1",
      status: "recording",
      lastRecorderBeatAt: { lt: new Date("2026-08-31T14:50:00.000Z") },
    },
    data: { status: "abandoned", closedAt: now, extractLockId: null, extractLockUntil: null },
  });
});
