import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { notifyStoryAssigned, resolveContributorRecipient, storyAssignmentUrl } from "./notifications.js";

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

test("un githubLogin coincidente sin Membership no resuelve destinatario", async (t) => {
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
      userWhere = where;
      return null;
    },
  });

  assert.deepEqual(await resolveContributorRecipient("contributor-1"), {
    recipient: null,
    reason: "no_matching_member",
  });
  assert.deepEqual(userWhere?.memberships, { some: { workspaceId: "workspace-1" } });
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
