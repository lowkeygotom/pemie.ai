// resolveAssigneeId: resuelve un Contributor.id real tal cual, y un id virtual
// "member:<userId>" a un Contributor sintético (upsert), validando membership
// contra el workspace del proyecto antes de crearlo.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import { resolveAssigneeId } from "./assignees.js";

/** Mismo patrón que story-card-sync.test.ts: sustituye el delegate entero. */
function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, model, { value: original, configurable: true, writable: true });
  });
}

test("un Contributor.id real se valida y se devuelve tal cual", async (t) => {
  stubDelegate(t, "contributor", {
    findUnique: async () => ({ id: "contributor-1", projectId: "project-1" }),
  });

  const resolved = await resolveAssigneeId("project-1", "contributor-1");

  assert.equal(resolved, "contributor-1");
});

test("un Contributor.id de otro proyecto se rechaza", async (t) => {
  stubDelegate(t, "contributor", {
    findUnique: async () => ({ id: "contributor-1", projectId: "other-project" }),
  });

  await assert.rejects(
    () => resolveAssigneeId("project-1", "contributor-1"),
    { code: "assignee_mismatch" }
  );
});

test("un member:<userId> con membership válida hace upsert del Contributor sintético", async (t) => {
  const upserts: Record<string, unknown>[] = [];
  stubDelegate(t, "project", { findUnique: async () => ({ workspaceId: "workspace-1" }) });
  stubDelegate(t, "membership", {
    findUnique: async () => ({ id: "membership-1", userId: "user-1", workspaceId: "workspace-1" }),
  });
  stubDelegate(t, "user", {
    findUnique: async () => ({ name: "Ada Lovelace", avatarUrl: "https://x/ada.png", email: "ada@acme.com" }),
  });
  stubDelegate(t, "contributor", {
    upsert: async (args: Record<string, unknown>) => {
      upserts.push(args);
      return { id: "contributor-synthetic-1" };
    },
  });

  const resolved = await resolveAssigneeId("project-1", "member:user-1");

  assert.equal(resolved, "contributor-synthetic-1");
  assert.equal(upserts.length, 1);
  const args = upserts[0] as { where: { projectId_githubLogin: { projectId: string; githubLogin: string } }; create: Record<string, unknown> };
  assert.deepEqual(args.where.projectId_githubLogin, { projectId: "project-1", githubLogin: "member:user-1" });
  assert.equal(args.create.userId, "user-1");
  assert.equal(args.create.name, "Ada Lovelace");
  assert.equal(args.create.email, null, "el email sintético queda null: los avisos resuelven por userId");
});

test("un member:<userId> sin nombre cae al local-part del email", async (t) => {
  stubDelegate(t, "project", { findUnique: async () => ({ workspaceId: "workspace-1" }) });
  stubDelegate(t, "membership", {
    findUnique: async () => ({ id: "membership-1", userId: "user-1", workspaceId: "workspace-1" }),
  });
  stubDelegate(t, "user", {
    findUnique: async () => ({ name: null, avatarUrl: null, email: "sin.nombre@acme.com" }),
  });
  let created: Record<string, unknown> | undefined;
  stubDelegate(t, "contributor", {
    upsert: async ({ create }: { create: Record<string, unknown> }) => {
      created = create;
      return { id: "contributor-synthetic-2" };
    },
  });

  await resolveAssigneeId("project-1", "member:user-1");

  assert.equal(created?.name, "sin.nombre");
});

test("un member:<userId> sin membership en el workspace del proyecto se rechaza", async (t) => {
  stubDelegate(t, "project", { findUnique: async () => ({ workspaceId: "workspace-1" }) });
  stubDelegate(t, "membership", { findUnique: async () => null });

  await assert.rejects(
    () => resolveAssigneeId("project-1", "member:user-1"),
    { code: "assignee_mismatch" }
  );
});

test("reasignar dos veces al mismo miembro upsertea con la misma clave (no duplica fila)", async (t) => {
  const wheres: unknown[] = [];
  stubDelegate(t, "project", { findUnique: async () => ({ workspaceId: "workspace-1" }) });
  stubDelegate(t, "membership", {
    findUnique: async () => ({ id: "membership-1", userId: "user-1", workspaceId: "workspace-1" }),
  });
  stubDelegate(t, "user", { findUnique: async () => ({ name: "Ada", avatarUrl: null, email: "ada@acme.com" }) });
  stubDelegate(t, "contributor", {
    upsert: async ({ where }: { where: unknown }) => {
      wheres.push(where);
      return { id: "contributor-synthetic-1" };
    },
  });

  const first = await resolveAssigneeId("project-1", "member:user-1");
  const second = await resolveAssigneeId("project-1", "member:user-1");

  assert.equal(first, second);
  assert.equal(wheres.length, 2);
  assert.deepEqual(wheres[0], wheres[1], "misma clave projectId_githubLogin en ambos intentos");
});
