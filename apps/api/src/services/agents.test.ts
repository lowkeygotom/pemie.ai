import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import { ServiceError } from "./errors.js";
import * as agents from "./agents.js";

function stub(t: TestContext, model: string, value: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>; const original = client[model];
  Object.defineProperty(client, model, { value, configurable: true, writable: true });
  t.after(() => Object.defineProperty(client, model, { value: original, configurable: true, writable: true }));
}

const row = (overrides: Record<string, unknown> = {}) => ({ id: "key-1", workspaceId: null, projectId: null, agentId: null, scopeLevel: "user", ownerUserId: "u1", name: "Mi agente", hashedKey: "hash", prefix: "pemie_sk_abc123", scopes: ["commits:read"], locale: "es", lastUsedAt: null, expiresAt: null, createdAt: new Date(), ...overrides });
const isCode = (code: string) => (err: unknown) => err instanceof ServiceError && err.code === code;

test("una persona sin membresías puede crear su key personal", async (t) => {
  let created: Record<string, unknown> | undefined;
  stub(t, "user", { findUnique: async () => ({ locale: "es" }) });
  stub(t, "apiKey", { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; return row(data); } });
  stub(t, "auditLog", { create: async () => ({}) });
  const result = await agents.createPersonalApiKey("u1", { name: "Mi agente", scopes: ["commits:read"] });
  assert.equal(created?.workspaceId, null); assert.equal(result.apiKey.ownerUserId, "u1"); assert.match(result.key, /^pemie_sk_/);
});

test("solo el dueño administra su key personal", async (t) => {
  let deleted = false; let locale = "es"; const key = row();
  stub(t, "apiKey", { findUnique: async () => key, delete: async () => { deleted = true; }, update: async () => row({ locale }) });
  stub(t, "auditLog", { create: async () => ({}) });
  await agents.updateApiKeyLocale("u1", "key-1", "en");
  await agents.revokeApiKey("u1", "key-1");
  assert.equal(deleted, true);
  await assert.rejects(() => agents.revokeApiKey("u2", "key-1"), isCode("not_personal_key_owner"));
});

test("la lista de workspace no mezcla keys personales", async (t) => {
  let where: unknown;
  stub(t, "membership", { findUnique: async () => ({ role: "admin" }) });
  stub(t, "apiKey", { findMany: async ({ where: input }: { where: unknown }) => { where = input; return [row({ workspaceId: "ws-1", scopeLevel: "workspace" })]; } });
  await agents.listApiKeys("u1", "ws-1");
  assert.deepEqual(where, { workspaceId: "ws-1" });
});

test("createApiKey rechaza scopeLevel user", async (t) => {
  stub(t, "membership", { findUnique: async () => ({ role: "admin" }) });
  await assert.rejects(() => agents.createApiKey("u1", "ws-1", { name: "Personal", scopeLevel: "user", scopes: ["commits:read"] }), isCode("user_key_not_workspace_scoped"));
});
