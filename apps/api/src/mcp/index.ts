// Interfaz MCP (F4) — consumida por agentes. Es una capa delgada de JSON-RPC
// 2.0 sobre HTTP (el protocolo MCP) encima de la MISMA capa de servicios que
// usa el REST. No contiene lógica de negocio: autentica la API key (Bearer),
// exige el scope de cada tool, resuelve el proyecto (project/workspace/user
// keys), delega en las operaciones `opXxx` y registra cada llamada en el AuditLog.

import { Hono } from "hono";
import type { ApiKey } from "@prisma/client";
import {
  MCP_TOOLS,
  SEARCHABLE_TYPES,
  describeToolAccess,
  isToolAvailable,
  type ApiScope,
  type McpToolName,
  type SearchableType,
} from "@pemie/shared";
import type { AppEnv } from "../rest/http.js";
import { ServiceError, badRequest, forbidden } from "../services/errors.js";
import * as agents from "../services/agents.js";
import * as ingest from "../services/ingest.js";
import * as stats from "../services/stats.js";
import * as reports from "../services/reports.js";
import * as stories from "../services/stories.js";
import * as board from "../services/board.js";
import * as search from "../services/search.js";
import * as leaderboard from "../services/leaderboard.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "pemie.ai", version: "0.1.0" };

interface McpContext {
  key: ApiKey;
  /** Proyecto fijado en la key (solo scopeLevel=project). */
  projectId: string | null;
  /**
   * Workspace que resolvió `requireProject` en esta llamada, para que el
   * AuditLog no repita la resolución. Mutable y por llamada: ver `tools/call`.
   */
  resolvedWorkspaceId: string | null;
}

/**
 * projectId opcional en schema; obligatorio en runtime si la key es amplia.
 * La descripción se repite en casi todas las tools y viaja en cada prompt, así
 * que dice solo lo que el agente necesita para decidir si mandarlo o no.
 */
const PROJECT_ID_PROP = {
  projectId: {
    type: "string",
    description: "ID del proyecto. Obligatorio con keys de workspace o usuario.",
  },
};

function withProjectId(
  properties: Record<string, unknown> = {},
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...PROJECT_ID_PROP, ...properties },
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/**
 * Resuelve el projectId efectivo y autoriza el scope ∩ rol del dueño.
 */
async function requireProject(ctx: McpContext, args: Record<string, unknown>, scope: ApiScope): Promise<string> {
  const fromArgs = typeof args.projectId === "string" ? args.projectId : null;
  const { project, workspaceId } = await agents.resolveProjectForKey(ctx.key, fromArgs);
  await agents.authorizeKeyForProject(ctx.key, scope, workspaceId);
  ctx.resolvedWorkspaceId = workspaceId;
  return project.id;
}

// ─── Registro de tools ─────────────────────────────────────────────────────

interface McpTool {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "list_workspaces",
    description:
      "Lista workspaces accesibles con esta API key. Útil con keys workspace/user antes de list_projects.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (ctx) => agents.listWorkspacesForKey(ctx.key),
  },
  {
    name: "list_projects",
    description:
      "Lista proyectos accesibles con esta API key. Con keys amplias, pasa el projectId resultante a las demás tools.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Filtrar por workspace (opcional)" },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      agents.listProjectsForKey(
        ctx.key,
        typeof args.workspaceId === "string" ? args.workspaceId : undefined
      ),
  },
  {
    name: "get_project_context",
    description: "Objetivo actual, stats de commits y último informe del proyecto.",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "commits:read");
      const [objective, projectStats, latest] = await Promise.all([
        reports.opGetObjective(projectId),
        stats.opProjectStats(projectId),
        reports.opListReports(projectId, { limit: 1 }),
      ]);
      return { projectId, objective, stats: projectStats, latestReport: latest[0] ?? null };
    },
  },
  {
    name: "get_project_leaderboard",
    description: "Ranking de HUs cerradas por actor (persona o agente) en el proyecto.",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      return { projectId, leaderboard: await leaderboard.opProjectLeaderboard(projectId) };
    },
  },
  {
    name: "list_commits",
    description:
      "Lista commits del proyecto (filtrable por dominio, contribuidor y rango de fecha).",
    inputSchema: withProjectId({
      limit: { type: "number" },
      domain: { type: "string" },
      contributorId: { type: "string" },
      since: { type: "string", description: "ISO 8601 — commits desde esta fecha (inclusive)." },
      until: {
        type: "string",
        description:
          "ISO 8601 — commits antes de esta fecha (exclusive). Para 'hasta el día X inclusive', pasa la medianoche UTC del día siguiente a X.",
      },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "commits:read");
      return ingest.opListCommits(projectId, ingest.parseCommitFilters(args));
    },
  },
  {
    name: "get_evaluation",
    description: "Últimos informes de avance del proyecto.",
    inputSchema: withProjectId({ limit: { type: "number" } }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "reports:read");
      return reports.opListReports(projectId, {
        limit: typeof args.limit === "number" ? args.limit : 10,
      });
    },
  },
  {
    name: "publish_report",
    description: "Publica (o actualiza) un informe de avance. Idempotente por fecha+slot.",
    inputSchema: withProjectId({
      date: { type: "string", description: "YYYY-MM-DD para scope 'day'" },
      slot: { type: "string" },
      scope: { type: "string", enum: ["day", "general"] },
      comment: { type: "string" },
      verdict: { type: "string" },
      score: { type: "number" },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "reports:write");
      return reports.opPublishReport(projectId, {
        date: args.date as string | undefined,
        slot: args.slot as string | undefined,
        scope: args.scope as "day" | "general" | undefined,
        comment: args.comment as string | undefined,
        verdict: args.verdict as string | undefined,
        score: typeof args.score === "number" ? args.score : undefined,
        agentId: ctx.key.agentId ?? undefined,
      });
    },
  },
  {
    name: "list_notes",
    description: "Lista notas/feedback del proyecto (filtrable por estado).",
    inputSchema: withProjectId({
      status: { type: "string", enum: ["pending", "processed"] },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "notes:read");
      return reports.opListNotes(projectId, {
        status: args.status === "pending" || args.status === "processed" ? args.status : undefined,
      });
    },
  },
  {
    name: "answer_note",
    description: "Responde una nota y opcionalmente la asocia a un informe.",
    inputSchema: withProjectId(
      {
        noteId: { type: "string" },
        response: { type: "string" },
        reportId: { type: "string" },
      },
      ["noteId", "response"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "notes:write");
      const note = await reports.getNoteById(String(args.noteId));
      if (!note || note.projectId !== projectId) throw forbidden("La nota no pertenece a este proyecto");
      return reports.opAnswerNote(note, String(args.response), args.reportId as string | undefined);
    },
  },
  {
    name: "get_objective",
    description: "Objetivo actual del proyecto.",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => reports.opGetObjective(await requireProject(ctx, args, "objective:read")),
  },
  {
    name: "update_objective",
    description: "Fija o actualiza el objetivo del proyecto (guarda historial).",
    inputSchema: withProjectId({ description: { type: "string" } }, ["description"]),
    handler: async (ctx, args) =>
      reports.opSetObjective(
        await requireProject(ctx, args, "objective:write"),
        String(args.description),
        null
      ),
  },
  {
    name: "list_user_stories",
    description: "Lista las Historias de Usuario del proyecto (filtrable por estado/épica).",
    inputSchema: withProjectId({
      status: { type: "string" },
      epicId: { type: "string" },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      return stories.opListStories(projectId, {
        status: args.status as string | undefined,
        epicId: args.epicId as string | undefined,
      });
    },
  },
  {
    name: "create_user_story",
    description: "Crea una Historia de Usuario (narrativa role/want/benefit + criterios).",
    inputSchema: withProjectId(
      {
        title: { type: "string" },
        narrative: {
          type: "object",
          properties: { role: { type: "string" }, want: { type: "string" }, benefit: { type: "string" } },
        },
        acceptanceCriteria: {
          type: "array",
          items: {
            type: "object",
            properties: { given: { type: "string" }, when: { type: "string" }, then: { type: "string" } },
          },
        },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        storyPoints: { type: "number" },
        epicId: { type: "string" },
        status: { type: "string" },
      },
      ["title"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      return stories.opCreateStory(
        projectId,
        {
          title: String(args.title),
          narrative: args.narrative as never,
          acceptanceCriteria: args.acceptanceCriteria as never,
          priority: args.priority as string | undefined,
          storyPoints: typeof args.storyPoints === "number" ? args.storyPoints : undefined,
          epicId: args.epicId as string | undefined,
          status: args.status as string | undefined,
        },
        { createdByAgentId: ctx.key.agentId ?? undefined }
      );
    },
  },
  {
    name: "update_user_story",
    description: "Actualiza una Historia de Usuario (título, estado, prioridad, narrativa…).",
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_ID_PROP,
        storyId: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        storyPoints: { type: "number" },
        narrative: {
          type: "object",
          properties: { role: { type: "string" }, want: { type: "string" }, benefit: { type: "string" } },
        },
        acceptanceCriteria: {
          type: "array",
          items: {
            type: "object",
            properties: { given: { type: "string" }, when: { type: "string" }, then: { type: "string" } },
          },
        },
        epicId: { type: ["string", "null"] },
      },
      required: ["storyId"],
      additionalProperties: true,
    },
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      return stories.opUpdateStory(story, {
        title: args.title as string | undefined,
        status: args.status as string | undefined,
        priority: args.priority as string | undefined,
        storyPoints: typeof args.storyPoints === "number" ? args.storyPoints : undefined,
        narrative: args.narrative as never,
        acceptanceCriteria: args.acceptanceCriteria as never,
        epicId: args.epicId as string | null | undefined,
      }, { actorType: "agent", actorId: ctx.key.agentId ?? ctx.key.id });
    },
  },
  {
    name: "assign_user_story",
    description:
      "Asigna (o desasigna, con assigneeId null) una HU a un contributor del proyecto; sincroniza la Card vinculada.",
    inputSchema: withProjectId(
      {
        storyId: { type: "string" },
        assigneeId: { type: ["string", "null"] },
      },
      ["storyId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      const assigneeId = args.assigneeId == null ? null : String(args.assigneeId);
      return stories.opAssignStory(story.id, assigneeId, {
        actorType: "agent",
        actorId: ctx.key.agentId ?? ctx.key.id,
      });
    },
  },
  {
    name: "list_contributors",
    description: "Lista los contribuidores del proyecto (candidatos a asignar HUs/tarjetas).",
    inputSchema: withProjectId(),
    handler: async (ctx, args) =>
      stories.opListContributors(await requireProject(ctx, args, "stories:read")),
  },
  {
    name: "list_board",
    description: "Devuelve el tablero Kanban con columnas y tarjetas.",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => board.opListBoard(await requireProject(ctx, args, "board:read")),
  },
  {
    name: "create_card",
    description: "Crea una tarjeta en el tablero (opcionalmente ligada a una HU).",
    inputSchema: withProjectId(
      {
        title: { type: "string" },
        type: { type: "string", enum: ["story", "task", "bug"] },
        description: { type: "string" },
        columnId: { type: "string" },
        userStoryId: { type: "string" },
      },
      ["title"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      return board.opCreateCard(
        projectId,
        {
          title: String(args.title),
          type: args.type as string | undefined,
          description: args.description as string | undefined,
          columnId: args.columnId as string | undefined,
          userStoryId: args.userStoryId as string | undefined,
        },
        { actorType: "agent", actorId: ctx.key.agentId ?? ctx.key.id }
      );
    },
  },
  {
    name: "move_card",
    description: "Mueve una tarjeta a otra columna del tablero.",
    inputSchema: withProjectId(
      {
        cardId: { type: "string" },
        columnId: { type: "string" },
        order: { type: "number" },
      },
      ["cardId", "columnId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("La tarjeta no pertenece a este proyecto");
      return board.opMoveCard(
        card,
        { columnId: String(args.columnId), order: typeof args.order === "number" ? args.order : undefined },
        { actorType: "agent", actorId: ctx.key.agentId ?? ctx.key.id }
      );
    },
  },
  {
    name: "link_story_to_card",
    description: "Vincula una tarjeta existente del tablero a una Historia de Usuario sin tarjeta.",
    inputSchema: withProjectId(
      {
        cardId: { type: "string" },
        storyId: { type: "string" },
      },
      ["cardId", "storyId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId) throw forbidden("La tarjeta no pertenece a este proyecto");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      return board.opLinkStoryToCard(card, story, {
        actorType: "agent",
        actorId: ctx.key.agentId ?? ctx.key.id,
      });
    },
  },
  {
    name: "get_story_commit_progress",
    description:
      "Cuenta y lista los commits del proyecto cuyo mensaje referencia la key de una HU (ej. PRJ-123).",
    inputSchema: withProjectId({ storyId: { type: "string" } }, ["storyId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      return stories.opGetStoryCommitProgress(story);
    },
  },
  {
    name: "search",
    description:
      "Busca un texto en las HUs, commits, notas y tarjetas del proyecto. Devuelve el tipo y el id de cada resultado para poder operarlo después.",
    // Sin scope estático: cada tipo exige el suyo dentro del handler, así una
    // key parcial busca en lo que sí puede leer en vez de recibir un 403 por todo.
    inputSchema: withProjectId(
      {
        query: { type: "string", description: "Texto a buscar (mínimo 2 caracteres)." },
        types: {
          type: "array",
          items: { type: "string", enum: [...SEARCHABLE_TYPES] },
          description: "Limita la búsqueda a estos tipos; por defecto, todos los permitidos.",
        },
        limit: { type: "number", description: "Máximo de resultados (20 por defecto, tope 50)." },
      },
      ["query"]
    ),
    handler: async (ctx, args) => {
      const allowed = search.searchableTypesForKey(ctx.key);
      const [first] = allowed;
      if (!first) throw forbidden("La API key no tiene ningún scope de lectura para buscar");
      // El proyecto se autoriza con un scope que la key sí tiene: así corre la
      // comprobación de membresía y rol sin exigir uno que no hace falta.
      const projectId = await requireProject(ctx, args, search.scopeForType(first));
      return search.opSearch(
        projectId,
        {
          query: String(args.query ?? ""),
          types: Array.isArray(args.types) ? (args.types as SearchableType[]) : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        },
        allowed
      );
    },
  },
  {
    name: "create_note",
    description: "Deja una nota o pregunta en el proyecto.",
    inputSchema: withProjectId({ message: { type: "string" } }, ["message"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "notes:write");
      // `authorId` referencia a un User: una nota de agente no tiene autor humano.
      return reports.opCreateNote(projectId, String(args.message ?? ""), null);
    },
  },
  {
    name: "get_user_story",
    description: "Detalle de una sola HU por id, sin listar todas las del proyecto.",
    inputSchema: withProjectId({ storyId: { type: "string" } }, ["storyId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      return story;
    },
  },
  {
    name: "delete_user_story",
    description:
      "Elimina una HU y su tarjeta del Kanban. Con keepCard=true la tarjeta se conserva desvinculada, con su actividad intacta.",
    inputSchema: withProjectId(
      { storyId: { type: "string" }, keepCard: { type: "boolean" } },
      ["storyId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("La HU no pertenece a este proyecto");
      // Del otro lado del MCP no hay nadie mirando un diálogo de confirmación:
      // el default borra la tarjeta para que el agente no deje huérfanas sin
      // enterarse. Quien quiera conservarla lo pide explícitamente.
      return stories.opDeleteStory(story, { deleteCard: args.keepCard !== true });
    },
  },
  {
    name: "update_card",
    description:
      "Actualiza título, descripción, tipo, asignado o HU vinculada de una tarjeta. Omitir un campo lo deja igual; enviarlo en null lo desvincula.",
    inputSchema: withProjectId(
      {
        cardId: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        type: { type: "string", enum: ["story", "task", "bug"] },
        assigneeId: { type: ["string", "null"] },
        userStoryId: { type: ["string", "null"] },
      },
      ["cardId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("La tarjeta no pertenece a este proyecto");

      // `undefined` (campo ausente) y `null` (desvincular) significan cosas
      // distintas: solo se copia lo que el agente mandó explícitamente.
      const patch: board.UpdateCardInput = {};
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.type === "string") patch.type = args.type;
      if (args.description !== undefined)
        patch.description = args.description === null ? null : String(args.description);
      if (args.assigneeId !== undefined)
        patch.assigneeId = args.assigneeId === null ? null : String(args.assigneeId);
      if (args.userStoryId !== undefined)
        patch.userStoryId = args.userStoryId === null ? null : String(args.userStoryId);

      return board.opUpdateCard(card, patch, {
        actorType: "agent",
        actorId: ctx.key.agentId ?? ctx.key.id,
      });
    },
  },
  {
    name: "delete_card",
    description:
      "Elimina una tarjeta del tablero junto con su actividad. La HU vinculada no se borra: para eso está delete_user_story.",
    inputSchema: withProjectId({ cardId: { type: "string" } }, ["cardId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("La tarjeta no pertenece a este proyecto");
      return board.opDeleteCard(card.id);
    },
  },
  {
    name: "list_card_activities",
    description: "Actividad de una tarjeta (creación, movimientos, asignaciones) con el nombre del actor.",
    inputSchema: withProjectId(
      { cardId: { type: "string" }, limit: { type: "number" } },
      ["cardId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("La tarjeta no pertenece a este proyecto");
      return board.opListCardActivities(
        card.id,
        typeof args.limit === "number" ? args.limit : undefined
      );
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Invoca una tool MCP en-proceso (p. ej. bot Telegram) sin HTTP. */
export async function invokeMcpTool(
  key: ApiKey,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name as McpToolName);
  if (!tool) throw badRequest(`Tool desconocida: ${name}`, "unknown_tool");
  agents.assertKeyUsable(key);
  if (!isToolAvailable(MCP_TOOLS[tool.name].access, key.scopes as ApiScope[]))
    throw forbidden(`La API key no tiene el permiso requerido: ${describeToolAccess(MCP_TOOLS[tool.name].access)}`);
  const ctx: McpContext = { key, projectId: key.projectId, resolvedWorkspaceId: null };
  const result = await tool.handler(ctx, args);
  await auditToolCall(ctx, name, args, typeof args.projectId === "string" ? args.projectId : key.projectId);
  return result;
}

/** Copia del schema sin `projectId` (una key de proyecto ya lo tiene fijado). */
function withoutProjectId(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties || !("projectId" in properties)) return schema;
  const { projectId: _pinned, ...rest } = properties;
  const next: Record<string, unknown> = { ...schema, properties: rest };
  const required = (schema.required as string[] | undefined)?.filter((r) => r !== "projectId");
  if (required) {
    if (required.length) next.required = required;
    else delete next.required;
  }
  return next;
}

/**
 * Definiciones de tools para un cliente LLM. Con `key`, devuelve solo lo que esa
 * key puede ejecutar de verdad:
 *
 * - Oculta las tools cuyo scope no tiene. Mandárselas solo gasta prompt en cada
 *   ronda e invita al modelo a llamadas que terminan en 403.
 * - Omite `projectId` si la key es de proyecto: ahí el proyecto ya está fijado y
 *   mandar uno distinto es un 403 (ver agents.resolveProjectForKey).
 *
 * Esto es una optimización del catálogo, NO un control de acceso: `tools/call`
 * sigue exigiendo el scope aunque alguien invoque una tool que no vio listada.
 */
export function listMcpToolDefs(key?: ApiKey) {
  const scopes = key ? (key.scopes as ApiScope[]) : null;
  const projectPinned = key ? key.scopeLevel === "project" : false;
  return TOOLS.filter((t) => scopes === null || isToolAvailable(MCP_TOOLS[t.name].access, scopes)).map(
    (t) => ({
      name: t.name,
      description: t.description,
      inputSchema: projectPinned ? withoutProjectId(t.inputSchema) : t.inputSchema,
      access: MCP_TOOLS[t.name].access,
    })
  );
}

// ─── Registro de resources ─────────────────────────────────────────────────

interface McpResource {
  uri: string;
  name: string;
  description: string;
  scope: ApiScope;
  read: (ctx: McpContext) => Promise<unknown>;
}

const RESOURCES: McpResource[] = [
  {
    uri: "pemie://project/context",
    name: "project_context",
    description: "Objetivo, stats y último informe.",
    scope: "commits:read",
    read: (ctx) => TOOL_BY_NAME.get("get_project_context")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/commits",
    name: "commits",
    description: "Commits del proyecto.",
    scope: "commits:read",
    read: (ctx) => TOOL_BY_NAME.get("list_commits")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/reports",
    name: "reports",
    description: "Informes de avance.",
    scope: "reports:read",
    read: (ctx) => TOOL_BY_NAME.get("get_evaluation")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/notes",
    name: "notes",
    description: "Notas/feedback.",
    scope: "notes:read",
    read: (ctx) => TOOL_BY_NAME.get("list_notes")!.handler(ctx, {}),
  },
];

const RESOURCE_BY_URI = new Map(RESOURCES.map((r) => [r.uri, r]));

/** Recursos visibles para una key. A diferencia de las tools, todos requieren un scope. */
export function listMcpResourceDefs(key?: ApiKey) {
  const scopes = key ? (key.scopes as ApiScope[]) : null;
  return RESOURCES.filter((resource) => scopes === null || scopes.includes(resource.scope)).map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: "application/json",
    scope: resource.scope,
  }));
}

// ─── JSON-RPC ────────────────────────────────────────────────────────────

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function asText(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

interface RpcRequest {
  jsonrpc: string;
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

/** Procesa una petición JSON-RPC. Devuelve undefined para notificaciones. */
async function handleRpc(ctx: McpContext, req: RpcRequest): Promise<object | undefined> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  switch (req.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return undefined;

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: listMcpToolDefs(ctx.key).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const tool = TOOL_BY_NAME.get(name as McpToolName);
      if (!tool) return rpcError(id, -32602, `Tool desconocida: ${name}`);
      if (!isToolAvailable(MCP_TOOLS[tool.name].access, ctx.key.scopes as ApiScope[]))
        return rpcError(id, -32000, `La API key no tiene el permiso requerido: ${describeToolAccess(MCP_TOOLS[tool.name].access)}`);
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      // Copia por llamada: un batch JSON-RPC corre sus tools en paralelo sobre
      // el mismo ctx, y el workspace que resuelve una no puede terminar en el
      // AuditLog de otra.
      const callCtx: McpContext = { ...ctx, resolvedWorkspaceId: null };
      try {
        const result = await tool.handler(callCtx, args);
        const resolvedPid =
          typeof args.projectId === "string" ? args.projectId : callCtx.projectId;
        await auditToolCall(callCtx, name, args, resolvedPid);
        return rpcResult(id, asText(result));
      } catch (err) {
        if (err instanceof ServiceError)
          return rpcResult(id, { ...asText({ error: err.message, code: err.code }), isError: true });
        throw err;
      }
    }

    case "resources/list":
      return rpcResult(id, {
        resources: listMcpResourceDefs(ctx.key).map(({ uri, name, description, mimeType }) => ({
          uri,
          name,
          description,
          mimeType,
        })),
      });

    case "resources/read": {
      const uri = String(req.params?.uri ?? "");
      const resource = RESOURCE_BY_URI.get(uri);
      if (!resource) return rpcError(id, -32602, `Resource desconocido: ${uri}`);
      agents.requireScope(ctx.key, resource.scope);
      const data = await resource.read(ctx);
      return rpcResult(id, {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      });
    }

    default:
      return isNotification ? undefined : rpcError(id, -32601, `Método no soportado: ${req.method}`);
  }
}

async function safeHandle(ctx: McpContext, req: RpcRequest): Promise<object | undefined> {
  try {
    return await handleRpc(ctx, req);
  } catch (err) {
    if (err instanceof ServiceError) return rpcError(req.id ?? null, -32000, err.message);
    throw err;
  }
}

async function auditToolCall(
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>,
  projectId: string | null
) {
  // `requireProject` ya resolvió el workspace en esta misma llamada: reusarlo
  // ahorra una consulta por tool call (antes se resolvía el proyecto dos veces,
  // la segunda solo para este log). Sin resolución previa —tools que no tocan
  // proyecto, o que fallaron antes de llegar— cae al workspace de la key.
  const workspaceId = ctx.resolvedWorkspaceId ?? ctx.key.workspaceId;
  return agents.audit({
    workspaceId,
    actorType: "agent",
    actorId: ctx.key.agentId ?? ctx.key.id,
    action: `mcp.${name}`,
    entity: "Project",
    entityId: projectId ?? undefined,
    meta: { args, scopeLevel: ctx.key.scopeLevel },
  });
}

/**
 * Router de la interfaz MCP. `GET /` es un descriptor público; `POST /` es el
 * endpoint JSON-RPC autenticado por API key (`Authorization: Bearer <key>`).
 */
export function mcpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    if (c.req.header("accept")?.includes("text/event-stream")) {
      return c.json({ error: "Este servidor MCP no ofrece SSE; usa POST" }, 405);
    }
    return c.json({
      name: SERVER_INFO.name,
      protocol: "mcp/json-rpc",
      protocolVersion: PROTOCOL_VERSION,
      transport: "POST /mcp (Authorization: Bearer <api-key>)",
      tools: TOOLS.map((t) => ({ name: t.name, access: MCP_TOOLS[t.name].access })),
      resources: RESOURCES.map((r) => ({ uri: r.uri, scope: r.scope })),
    });
  });

  app.post("/", async (c) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    let key: ApiKey;
    try {
      key = await agents.authenticateApiKey(bearer);
    } catch (err) {
      const msg = err instanceof ServiceError ? err.message : "No autorizado";
      return c.json(rpcError(null, -32001, msg), 401);
    }

    const body = (await c.req.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
    if (!body) return c.json(rpcError(null, -32700, "Parse error"), 400);
    const ctx: McpContext = { key, projectId: key.projectId, resolvedWorkspaceId: null };

    if (Array.isArray(body)) {
      const results = await Promise.all(body.map((r) => safeHandle(ctx, r)));
      return c.json(results.filter((r): r is object => r !== undefined));
    }
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string")
      return c.json(rpcError(body.id ?? null, -32600, "Invalid Request"), 400);

    const res = await safeHandle(ctx, body);
    if (res === undefined) return c.body(null, 204);
    return c.json(res);
  });

  return app;
}
