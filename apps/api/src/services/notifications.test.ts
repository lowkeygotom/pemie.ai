import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  notifyStoryAssigned,
  resolveContributorRecipient,
  resolveContributorRecipients,
  storyAssignmentUrl,
} from "./notifications.js";
import * as stories from "./stories.js";

function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => Object.defineProperty(client, model, { value: original, configurable: true, writable: true }));
}

test("el enlace de asignación respeta el contrato del deep link de HU", () => {
  assert.equal(
    storyAssignmentUrl("acme", "pemie-ai", "PEM-38"),
    `${env.WEB_ORIGIN}/w/acme/p/pemie-ai?tab=stories&story=PEM-38`
  );
});

test("un githubLogin de otro workspace no resuelve ni vincula al contributor", async (t) => {
  let userWhere: Record<string, unknown> | undefined;
  stubDelegate(t, "contributor", {
    findUnique: async () => ({
      id: "contributor-1",
      githubLogin: "octocat",
      userId: null,
      project: { workspaceId: "workspace-1" },
    }),
  });
  stubDelegate(t, "user", {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      if ("memberships" in where) userWhere = where;
      return "memberships" in where ? null : { id: "user-externo" };
    },
  });

  assert.deepEqual(await resolveContributorRecipient("contributor-1"), {
    recipient: null,
    reason: "no_matching_member",
  });
  assert.deepEqual(userWhere?.memberships, { some: { workspaceId: "workspace-1" } });
});

test("el correo explícito gana y marca si su cuenta es miembro", async (t) => {
  stubDelegate(t, "contributor", {
    findUnique: async () => ({
      id: "contributor-1", githubLogin: "autor-inferido", userId: null, email: "persona@example.com",
      project: { workspaceId: "workspace-1" },
    }),
  });
  stubDelegate(t, "user", { findUnique: async () => ({ id: "user-1" }) });
  stubDelegate(t, "membership", { findUnique: async () => ({ id: "membership-1" }) });

  assert.deepEqual(await resolveContributorRecipient("contributor-1"), {
    recipient: { id: "user-1", email: "persona@example.com", isMember: true },
  });
});

test("una autoasignación no envía correo", async (t) => {
  stubDelegate(t, "contributor", {
    findUnique: async () => ({
      id: "contributor-1",
      githubLogin: "octocat",
      userId: "user-1",
      project: { workspaceId: "workspace-1" },
    }),
  });
  stubDelegate(t, "user", {
    findFirst: async () => ({ id: "user-1", email: "dev@example.com" }),
  });
  stubDelegate(t, "userStory", {
    findUnique: async () => ({
      key: "PEM-38",
      title: "Notificar asignación",
      project: { name: "pemie", slug: "pemie", workspace: { slug: "acme" } },
    }),
  });

  assert.deepEqual(
    await notifyStoryAssigned({
      storyId: "story-1",
      assigneeId: "contributor-1",
      actor: { actorType: "user", actorId: "user-1" },
    }),
    { notified: false, reason: "self_assignment" }
  );
});

test("una desasignación no consulta ni envía", async () => {
  assert.deepEqual(
    await notifyStoryAssigned({
      storyId: "story-1",
      assigneeId: null,
      actor: { actorType: "user", actorId: "user-1" },
    }),
    { notified: false, reason: "unassigned" }
  );
});

// ─── resolveContributorRecipients (PEM-42): lectura batched, sin escrituras ──

test("resolveContributorRecipients nunca llama contributor.update y usa 3 queries fijas", async (t) => {
  stubDelegate(t, "contributor", {
    update: async () => {
      throw new Error("resolveContributorRecipients no debe escribir");
    },
  });
  let emailCalls = 0;
  let idOrLoginCalls = 0;
  let membershipCalls = 0;
  stubDelegate(t, "user", {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      if ("email" in where) {
        emailCalls++;
        return [{ id: "user-member", email: "member@example.com" }];
      }
      idOrLoginCalls++;
      return [{ id: "user-legacy-match", email: "legacy@example.com", githubLogin: "octocat" }];
    },
  });
  stubDelegate(t, "membership", {
    findMany: async () => {
      membershipCalls++;
      return [{ userId: "user-member" }, { userId: "user-legacy-match" }];
    },
  });

  const contributors = [
    { id: "c1", email: "member@example.com", userId: null, githubLogin: "member-login" },
    { id: "c2", email: null, userId: "user-stale", githubLogin: "octocat" },
    { id: "c3", email: "ghost@users.noreply.github.com", userId: null, githubLogin: "ghost" },
  ];

  const result = await resolveContributorRecipients("workspace-1", contributors);

  assert.equal(emailCalls, 1);
  assert.equal(idOrLoginCalls, 1);
  assert.equal(membershipCalls, 1);
  assert.deepEqual(result.get("c1"), { recipient: { id: "user-member", email: "member@example.com", isMember: true } });
  assert.deepEqual(result.get("c2"), {
    recipient: { id: "user-legacy-match", email: "legacy@example.com", isMember: true },
  });
  assert.deepEqual(result.get("c3"), { recipient: null }, "email placeholder: sin consultar nada");
});

test("resolveContributorRecipients resuelve member/external/none/placeholder/userId obsoleto", async (t) => {
  stubDelegate(t, "user", {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      if ("email" in where) {
        return [
          { id: "user-member", email: "member@example.com" },
          { id: "user-external", email: "external@example.com" },
        ];
      }
      return [{ id: "user-by-login", email: "porlogin@example.com", githubLogin: "por-login" }];
    },
  });
  stubDelegate(t, "membership", {
    findMany: async () => [{ userId: "user-member" }, { userId: "user-by-login" }],
  });

  const contributors = [
    { id: "c-member", email: "member@example.com", userId: null, githubLogin: "irrelevante" },
    { id: "c-external", email: "external@example.com", userId: null, githubLogin: "irrelevante" },
    { id: "c-placeholder", email: "bot@users.noreply.github.com", userId: null, githubLogin: "bot" },
    { id: "c-none", email: null, userId: null, githubLogin: "sin-match" },
    // userId obsoleto (ya no es miembro): tiene que caer al match por githubLogin.
    { id: "c-stale-userid", email: null, userId: "user-eliminado", githubLogin: "por-login" },
  ];

  const result = await resolveContributorRecipients("workspace-1", contributors);

  assert.deepEqual(result.get("c-member"), {
    recipient: { id: "user-member", email: "member@example.com", isMember: true },
  });
  assert.deepEqual(result.get("c-external"), {
    recipient: { id: "user-external", email: "external@example.com", isMember: false },
  });
  assert.deepEqual(result.get("c-placeholder"), { recipient: null });
  assert.deepEqual(result.get("c-none"), { recipient: null });
  assert.deepEqual(result.get("c-stale-userid"), {
    recipient: { id: "user-by-login", email: "porlogin@example.com", isMember: true },
  });
});

test("opListContributors con varios contributors dispara un número fijo de queries, no una por fila", async (t) => {
  const contributors = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`,
    githubLogin: `login${i}`,
    name: null,
    avatarUrl: null,
    email: null,
    userId: null,
  }));

  stubDelegate(t, "project", { findUnique: async () => ({ workspaceId: "workspace-1" }) });

  let contributorFindManyCalls = 0;
  stubDelegate(t, "contributor", {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      contributorFindManyCalls++;
      // Distingue el findMany principal (por projectId) del batch de sugeridos
      // (por githubLogin, sin projectId): cada uno debe ser una sola llamada.
      return "projectId" in where ? contributors : [];
    },
  });

  let userFindManyCalls = 0;
  stubDelegate(t, "user", {
    findMany: async () => {
      userFindManyCalls++;
      return [];
    },
  });

  let membershipFindManyCalls = 0;
  stubDelegate(t, "membership", {
    findMany: async () => {
      membershipFindManyCalls++;
      return [];
    },
  });

  const result = await stories.opListContributors("project-1", true);

  assert.equal(result.length, 6);
  assert.equal(contributorFindManyCalls, 2, "1 para la lista + 1 batch de sugeridos, no 1 por fila");
  assert.equal(userFindManyCalls, 1, "sin contributors con email, solo corre la query por id/login");
  assert.equal(membershipFindManyCalls, 0, "sin candidatos de usuario no hay membership que resolver");
});
