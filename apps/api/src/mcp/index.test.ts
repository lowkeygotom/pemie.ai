import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AgentPresence, ApiKey } from "@prisma/client";
import {
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  buildAgentPrompt,
  isToolAvailable,
  type ApiScope,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { ServiceError } from "../services/errors.js";
import * as agents from "../services/agents.js";
import { invokeMcpTool, listMcpResourceDefs, listMcpToolDefs } from "./index.js";

function key(scopes: ApiScope[], scopeLevel: "project" | "workspace" | "user" = "project"): ApiKey {
  return { id: "key-1", scopes, scopeLevel, projectId: "project-1", expiresAt: null } as ApiKey;
}

test("el mapa compartido es total y search exige uno de sus cuatro scopes", () => {
  assert.deepEqual(Object.keys(MCP_TOOLS).sort(), [...MCP_TOOL_NAMES].sort());
  assert.equal(isToolAvailable(MCP_TOOLS.search.access, ["reports:read"]), false);
  assert.equal(isToolAvailable(MCP_TOOLS.search.access, ["stories:read"]), true);
});

test("prompt y catálogo MCP comparten exactamente el filtro de scopes", () => {
  const scopes: ApiScope[] = ["reports:read", "stories:read"];
  const prompt = buildAgentPrompt({
    workspaceSlug: "acme",
    target: { scopeLevel: "project", project: { slug: "web", id: "project-1" } },
    scopes,
    keyRef: { kind: "prefix", prefix: "pemie_sk_abc123" },
    mcpUrl: "https://example.test/mcp",
  });
  assert.deepEqual(prompt.included, listMcpToolDefs(key(scopes)).map((tool) => tool.name));
});

test("una key solo reports no recibe ni puede invocar search", async () => {
  const reportsOnly = key(["reports:read"]);
  assert.equal(listMcpToolDefs(reportsOnly).some((tool) => tool.name === "search"), false);
  await assert.rejects(
    () => invokeMcpTool(reportsOnly, "search", { query: "hola" }),
    /uno de: stories:read, commits:read, notes:read, board:read/
  );
});

test("el catálogo de resources también respeta los scopes de la key", () => {
  const reportsOnly = key(["reports:read"]);
  const resources = listMcpResourceDefs(reportsOnly);
  assert.deepEqual(resources.map((resource) => resource.uri), ["pemie://project/reports"]);
  for (const resource of resources)
    assert.doesNotThrow(() => agents.requireScope(reportsOnly, resource.scope));
});

test("el renderer describe de forma distinta los dos alcances", () => {
  const scoped: ApiScope[] = ["commits:read"];
  const project = buildAgentPrompt({
    workspaceSlug: "acme",
    target: { scopeLevel: "project", project: { slug: "web", id: "project-1" } },
    scopes: scoped,
    keyRef: { kind: "prefix", prefix: "pemie_sk_abc123" },
    mcpUrl: "https://example.test/mcp",
  });
  const workspace = buildAgentPrompt({
    workspaceSlug: "acme",
    target: { scopeLevel: "workspace" },
    scopes: scoped,
    keyRef: { kind: "prefix", prefix: "pemie_sk_abc123" },
    mcpUrl: "https://example.test/mcp",
  });
  assert.match(project.text, /no tienen el parámetro projectId/);
  assert.match(workspace.text, /pasa projectId en CADA tool/);
});

if (false) {
  // @ts-expect-error el renderer no permite alcance proyecto sin proyecto.
  buildAgentPrompt({ workspaceSlug: "acme", target: { scopeLevel: "project" }, scopes: [], keyRef: { kind: "prefix", prefix: "x" }, mcpUrl: "https://example.test/mcp" });
}

// ─── Admisión por presencia ────────────────────────────────────────────────
//
// `admitAgentToWorkspace` corre dentro de `resolveProjectForKey`, o sea en el
// único punto por el que una tool call llega a un proyecto. Se ejercita desde
// `invokeMcpTool` —el camino del canal Telegram— para comprobar que la puerta
// está en el servicio y no en el transporte.

interface PresenceUpsertArgs {
  where: { apiKeyId_workspaceId: { apiKeyId: string; workspaceId: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Reemplaza un delegate de Prisma por un doble y lo restaura al terminar.
 *
 * Se sustituye el delegate entero en vez de un método suelto porque los
 * delegates son proxies: `mock.method` no encuentra sus métodos.
 */
function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, model, { value: original, configurable: true, writable: true });
  });
}

/**
 * Doble en memoria de `agentPresence` con la semántica de la unique
 * `[apiKeyId, workspaceId]`, más el resto del camino de `get_objective`.
 * Sustituye a la base para poder afirmar qué escribe la admisión sin montar
 * Postgres: lo que se verifica es el contrato que `admitAgentToWorkspace` le
 * pide, no la implementación de Prisma.
 */
function stubPresence(t: TestContext, seed?: Partial<AgentPresence>) {
  const calls: PresenceUpsertArgs[] = [];
  const rows = new Map<string, AgentPresence>();
  const now = new Date("2026-08-04T10:00:00.000Z");

  stubDelegate(t, "agentPresence", {
    upsert: async (args: PresenceUpsertArgs) => {
      calls.push(args);
      const { apiKeyId, workspaceId } = args.where.apiKeyId_workspaceId;
      const id = `${apiKeyId}:${workspaceId}`;
      const existing = rows.get(id);
      const row = existing
        ? { ...existing, ...args.update }
        : {
            id,
            blockedAt: null,
            blockedById: null,
            firstSeenAt: now,
            lastSeenAt: now,
            lastProjectId: null,
            ...args.create,
            ...seed,
          };
      rows.set(id, row as AgentPresence);
      return row as AgentPresence;
    },
  });

  stubDelegate(t, "project", {
    findUnique: async () => ({ id: "project-1", workspaceId: "workspace-1" }),
  });
  stubDelegate(t, "objective", { findUnique: async () => null });
  stubDelegate(t, "auditLog", { create: async () => ({}) });

  return { calls, rows };
}

test("la primera tool call deja la presencia del agente en el workspace", async (t) => {
  const presence = stubPresence(t);
  await invokeMcpTool(key(["objective:read"]), "get_objective", {});

  assert.equal(presence.calls.length, 1);
  assert.deepEqual(presence.calls[0]!.where.apiKeyId_workspaceId, {
    apiKeyId: "key-1",
    workspaceId: "workspace-1",
  });
  assert.equal(presence.calls[0]!.create.lastProjectId, "project-1");
  assert.equal(presence.rows.size, 1);
});

test("la segunda tool call reusa la presencia y solo mueve lastSeenAt/lastProjectId", async (t) => {
  const presence = stubPresence(t);
  const agentKey = key(["objective:read"]);
  await invokeMcpTool(agentKey, "get_objective", {});
  const firstSeenAt = [...presence.rows.values()][0]!.firstSeenAt;

  await invokeMcpTool(agentKey, "get_objective", {});

  assert.equal(presence.calls.length, 2);
  assert.equal(presence.rows.size, 1, "la unique evita una segunda fila");
  assert.deepEqual(
    Object.keys(presence.calls[1]!.update).sort(),
    ["lastProjectId", "lastSeenAt"],
    "el update no puede tocar blockedAt: usar la key no levanta su propio bloqueo"
  );
  assert.deepEqual([...presence.rows.values()][0]!.firstSeenAt, firstSeenAt);
});

test("una presencia bloqueada corta la tool call con 403 y deja rastro del intento", async (t) => {
  const presence = stubPresence(t, { blockedAt: new Date("2026-08-03T00:00:00.000Z") });

  const err = await invokeMcpTool(key(["objective:read"]), "get_objective", {}).then(
    () => null,
    (e: unknown) => e
  );

  assert.ok(err instanceof ServiceError);
  assert.equal(err.status, 403);
  assert.equal(presence.calls.length, 1, "el upsert corre antes del check, no después");
});
