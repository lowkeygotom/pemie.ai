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
  SKILL_DESTINATIONS,
  SKILL_TARGETS,
  describeToolAccess,
  isToolAvailable,
  type ApiScope,
  type McpToolName,
  type SearchableType,
  type SkillDestination,
  type SkillTarget,
} from "@pemie/shared";
import type { AppEnv } from "../rest/http.js";
import { ServiceError, badRequest, forbidden, notFound, renderServiceError } from "../services/errors.js";
import { parseAcceptLanguage } from "../lib/accept-language.js";
import { translate } from "../i18n/index.js";
import { es as mcpEs, type McpDescParams } from "../i18n/mcp/es.js";
import { en as mcpEn } from "../i18n/mcp/en.js";
import { env } from "../env.js";
import * as agents from "../services/agents.js";
import * as ingest from "../services/ingest.js";
import * as reports from "../services/reports.js";
import * as stories from "../services/stories.js";
import * as board from "../services/board.js";
import * as assignees from "../services/assignees.js";
import * as search from "../services/search.js";
import * as leaderboard from "../services/leaderboard.js";
import * as drift from "../services/drift.js";
import * as agentReliability from "../services/agent-reliability.js";
import * as overview from "../services/overview.js";
import * as skills from "../services/skills.js";
import * as agentActivity from "../services/agent-activity.js";
import * as brainstorm from "../services/brainstorm.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "pemie.ai", version: "0.1.0" };

const mcpCatalogs = { es: mcpEs, en: mcpEn };

/** Traduce una clave de `i18n/mcp` al locale pedido (fallback a "es", nunca lanza). */
function mcpText(locale: string, key: keyof typeof mcpEs, params?: McpDescParams): string {
  return translate(mcpCatalogs, locale, key, params);
}

/**
 * Recorre un JSON Schema y traduce cada `description` presente: el valor
 * estático guardado en `TOOLS`/`RESOURCES` es una clave de `i18n/mcp`, no el
 * texto final. Solo toca el keyword `description` con valor string — las
 * propiedades de dominio que se llaman igual (`description` de una tarjeta)
 * tienen un objeto `{ type: ... }` como valor y quedan intactas.
 */
function localizeSchema(node: unknown, locale: string): unknown {
  if (Array.isArray(node)) return node.map((item) => localizeSchema(item, locale));
  if (node && typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>).map(([key, value]) => {
      if (key === "description" && typeof value === "string") {
        return [key, mcpText(locale, value as keyof typeof mcpEs)];
      }
      return [key, localizeSchema(value, locale)];
    });
    return Object.fromEntries(entries);
  }
  return node;
}

interface McpContext {
  key: ApiKey;
  /** Proyecto fijado en la key (solo scopeLevel=project). */
  projectId: string | null;
  /**
   * Workspace que resolvió `requireProject`/`requireWorkspace` en esta llamada,
   * para que el AuditLog no repita la resolución. Mutable y por llamada.
   */
  resolvedWorkspaceId: string | null;
  /** Resuelto una vez por request tras autenticar la key (`resolveApiKeyLocale`). */
  locale: string;
}

/**
 * projectId opcional en schema; obligatorio en runtime si la key es amplia.
 * La descripción se repite en casi todas las tools y viaja en cada prompt, así
 * que dice solo lo que el agente necesita para decidir si mandarlo o no.
 */
const PROJECT_ID_PROP = {
  projectId: {
    type: "string",
    description: "project_id_prop",
  },
};

const WORKSPACE_ID_PROP = {
  workspaceId: {
    type: "string",
    description: "workspace_id_prop",
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

function withWorkspaceId(
  properties: Record<string, unknown> = {},
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...WORKSPACE_ID_PROP, ...properties },
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

/** Resuelve el workspace efectivo para tools del catálogo de skills. */
async function requireWorkspace(ctx: McpContext, args: Record<string, unknown>, scope: ApiScope): Promise<string> {
  const fromArgs = typeof args.workspaceId === "string" ? args.workspaceId : null;
  const workspaceId = await agents.resolveWorkspaceForKey(ctx.key, fromArgs);
  await agents.authorizeKeyForWorkspace(ctx.key, scope, workspaceId);
  ctx.resolvedWorkspaceId = workspaceId;
  return workspaceId;
}

// ─── Registro de tools ─────────────────────────────────────────────────────

interface McpTool {
  name: McpToolName;
  descriptionKey: keyof typeof mcpEs;
  inputSchema: Record<string, unknown>;
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "list_workspaces",
    descriptionKey: "tool_list_workspaces",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (ctx) => agents.listWorkspacesForKey(ctx.key),
  },
  {
    name: "list_projects",
    descriptionKey: "tool_list_projects",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "tool_list_projects_workspace_id" },
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
    descriptionKey: "tool_get_project_context",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "commits:read");
      return overview.opProjectOverview(projectId);
    },
  },
  {
    name: "get_project_drift",
    descriptionKey: "tool_get_project_drift",
    inputSchema: withProjectId({
      staleDays: {
        type: "number",
        description: "tool_get_project_drift_stale_days",
      },
      coverageThreshold: {
        type: "number",
        description: "tool_get_project_drift_coverage_threshold",
      },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      // get_project_drift también exige commits:read: la alerta compara el
      // tablero contra commits, así que sin ese scope estaría leyendo datos
      // que la key no tiene permiso de ver aunque el resultado no los liste tal cual.
      await agents.authorizeKeyForProject(ctx.key, "commits:read", ctx.resolvedWorkspaceId!);
      return drift.opDetectDrift(projectId, {
        staleDays: typeof args.staleDays === "number" ? args.staleDays : undefined,
        coverageThreshold: typeof args.coverageThreshold === "number" ? args.coverageThreshold : undefined,
      });
    },
  },
  {
    name: "get_project_leaderboard",
    descriptionKey: "tool_get_project_leaderboard",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      return { projectId, leaderboard: await leaderboard.opProjectLeaderboard(projectId) };
    },
  },
  {
    name: "get_agent_reliability",
    descriptionKey: "tool_get_agent_reliability",
    inputSchema: withProjectId({
      windowDays: {
        type: "number",
        description: "tool_get_agent_reliability_window_days",
      },
      settleHours: {
        type: "number",
        description: "tool_get_agent_reliability_settle_hours",
      },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      return agentReliability.opAgentReliability(projectId, {
        windowDays: typeof args.windowDays === "number" ? args.windowDays : undefined,
        settleHours: typeof args.settleHours === "number" ? args.settleHours : undefined,
      });
    },
  },
  // Reusamos board:* deliberadamente: los scopes son una foto de la key al
  // crearla y un activity:* nuevo dejaría fuera todas las credenciales vigentes.
  // get_agent_reliability y get_project_leaderboard ya siguen este precedente.
  {
    name: "report_activity",
    descriptionKey: "tool_report_activity",
    inputSchema: withProjectId(
      {
        summary: { type: "string", description: "tool_report_activity_summary" },
        state: { type: "string", enum: ["working", "blocked", "done"], description: "tool_report_activity_state" },
        storyId: { type: "string", description: "tool_report_activity_story_id" },
        cardId: { type: "string", description: "tool_report_activity_card_id" },
        paths: { type: "array", items: { type: "string" }, description: "tool_report_activity_paths" },
        intervalSeconds: { type: "number", description: "tool_report_activity_interval_seconds" },
        model: { type: "string", description: "tool_report_activity_model" },
      }
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      if (typeof args.storyId === "string") {
        const story = await stories.getStoryById(args.storyId);
        if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      }
      if (typeof args.cardId === "string") {
        const card = await board.getCardWithProject(args.cardId);
        if (!card || card.board.projectId !== projectId) throw forbidden("card_not_in_project");
      }
      return agentActivity.opReportActivity(projectId, {
        summary: typeof args.summary === "string" ? args.summary : undefined,
        state: args.state as agentActivity.ReportActivityInput["state"],
        userStoryId: typeof args.storyId === "string" ? args.storyId : undefined,
        cardId: typeof args.cardId === "string" ? args.cardId : undefined,
        paths: Array.isArray(args.paths) ? args.paths.filter((path): path is string => typeof path === "string") : undefined,
        intervalSeconds: typeof args.intervalSeconds === "number" ? args.intervalSeconds : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
      }, {
        apiKeyId: ctx.key.id,
        agentId: ctx.key.agentId,
        ownerUserId: ctx.key.ownerUserId,
      });
    },
  },
  {
    name: "list_agent_activity",
    descriptionKey: "tool_list_agent_activity",
    inputSchema: withProjectId({
      agentId: { type: "string", description: "tool_list_agent_activity_agent_id" },
      storyId: { type: "string", description: "tool_list_agent_activity_story_id" },
      from: { type: "string", description: "tool_list_agent_activity_from" },
      to: { type: "string", description: "tool_list_agent_activity_to" },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      const parseDate = (value: unknown) => {
        if (typeof value !== "string") return undefined;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
      };
      return agentActivity.opListActivity(projectId, {
        agentId: typeof args.agentId === "string" ? args.agentId : undefined,
        userStoryId: typeof args.storyId === "string" ? args.storyId : undefined,
        from: parseDate(args.from),
        to: parseDate(args.to),
      });
    },
  },
  {
    name: "list_commits",
    descriptionKey: "tool_list_commits",
    inputSchema: withProjectId({
      limit: { type: "number" },
      domain: { type: "string" },
      contributorId: { type: "string" },
      since: { type: "string", description: "tool_list_commits_since" },
      until: {
        type: "string",
        description: "tool_list_commits_until",
      },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "commits:read");
      return ingest.opListCommits(projectId, ingest.parseCommitFilters(args));
    },
  },
  {
    name: "get_evaluation",
    descriptionKey: "tool_get_evaluation",
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
    descriptionKey: "tool_publish_report",
    inputSchema: withProjectId({
      date: { type: "string", description: "tool_publish_report_date" },
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
    descriptionKey: "tool_list_notes",
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
    descriptionKey: "tool_answer_note",
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
      if (!note || note.projectId !== projectId) throw forbidden("note_not_in_project");
      return reports.opAnswerNote(note, String(args.response), args.reportId as string | undefined);
    },
  },
  {
    name: "get_objective",
    descriptionKey: "tool_get_objective",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => reports.opGetObjective(await requireProject(ctx, args, "objective:read")),
  },
  {
    name: "update_objective",
    descriptionKey: "tool_update_objective",
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
    descriptionKey: "tool_list_user_stories",
    inputSchema: withProjectId({
      status: { type: "string" },
      epicId: { type: "string" },
      type: { type: "string", enum: ["story", "epic"], description: "tool_list_user_stories_type" },
    }),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      const type = args.type as string | undefined;
      return stories.opListStories(projectId, {
        status: args.status as string | undefined,
        epicId: args.epicId as string | undefined,
        isEpic: type === "epic" ? true : type === "story" ? false : undefined,
      });
    },
  },
  {
    name: "create_user_story",
    descriptionKey: "tool_create_user_story",
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
        isEpic: { type: "boolean", description: "tool_create_user_story_is_epic" },
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
          isEpic: typeof args.isEpic === "boolean" ? args.isEpic : undefined,
        },
        { createdByAgentId: ctx.key.agentId ?? undefined }
      );
    },
  },
  {
    name: "update_user_story",
    descriptionKey: "tool_update_user_story",
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
        isEpic: { type: "boolean", description: "tool_update_user_story_is_epic" },
      },
      required: ["storyId"],
      additionalProperties: true,
    },
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      return stories.opUpdateStory(
        story,
        {
          title: args.title as string | undefined,
          status: args.status as string | undefined,
          priority: args.priority as string | undefined,
          storyPoints: typeof args.storyPoints === "number" ? args.storyPoints : undefined,
          narrative: args.narrative as never,
          acceptanceCriteria: args.acceptanceCriteria as never,
          epicId: args.epicId as string | null | undefined,
          isEpic: typeof args.isEpic === "boolean" ? args.isEpic : undefined,
        },
        { actorType: "agent", actorId: ctx.key.agentId ?? ctx.key.id }
      );
    },
  },
  {
    name: "assign_user_story",
    descriptionKey: "tool_assign_user_story",
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
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      const assigneeId = args.assigneeId == null ? null : String(args.assigneeId);
      return stories.opAssignStory(story.id, assigneeId, {
        actorType: "agent",
        actorId: ctx.key.agentId ?? ctx.key.id,
      });
    },
  },
  {
    name: "list_contributors",
    descriptionKey: "tool_list_contributors",
    inputSchema: withProjectId(),
    handler: async (ctx, args) =>
      stories.opListContributors(await requireProject(ctx, args, "stories:read")),
  },
  {
    name: "list_assignees",
    descriptionKey: "tool_list_assignees",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      return assignees.opListAssignableCandidates(projectId, ctx.resolvedWorkspaceId!);
    },
  },
  {
    name: "list_board",
    descriptionKey: "tool_list_board",
    inputSchema: withProjectId(),
    handler: async (ctx, args) => board.opListBoard(await requireProject(ctx, args, "board:read")),
  },
  {
    name: "create_card",
    descriptionKey: "tool_create_card",
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
    descriptionKey: "tool_move_card",
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
        throw forbidden("card_not_in_project");
      return board.opMoveCard(
        card,
        { columnId: String(args.columnId), order: typeof args.order === "number" ? args.order : undefined },
        { actorType: "agent", actorId: ctx.key.agentId ?? ctx.key.id }
      );
    },
  },
  {
    name: "link_story_to_card",
    descriptionKey: "tool_link_story_to_card",
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
      if (!card || card.board.projectId !== projectId) throw forbidden("card_not_in_project");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      return board.opLinkStoryToCard(card, story, {
        actorType: "agent",
        actorId: ctx.key.agentId ?? ctx.key.id,
      });
    },
  },
  {
    name: "get_story_commit_progress",
    descriptionKey: "tool_get_story_commit_progress",
    inputSchema: withProjectId({ storyId: { type: "string" } }, ["storyId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      return stories.opGetStoryCommitProgress(story);
    },
  },
  {
    name: "search",
    descriptionKey: "tool_search",
    // Sin scope estático: cada tipo exige el suyo dentro del handler, así una
    // key parcial busca en lo que sí puede leer en vez de recibir un 403 por todo.
    inputSchema: withProjectId(
      {
        query: { type: "string", description: "tool_search_query" },
        types: {
          type: "array",
          items: { type: "string", enum: [...SEARCHABLE_TYPES] },
          description: "tool_search_types",
        },
        limit: { type: "number", description: "tool_search_limit" },
      },
      ["query"]
    ),
    handler: async (ctx, args) => {
      const allowed = search.searchableTypesForKey(ctx.key);
      const [first] = allowed;
      if (!first) throw forbidden("no_read_scope_for_search");
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
    descriptionKey: "tool_create_note",
    inputSchema: withProjectId({ message: { type: "string" } }, ["message"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "notes:write");
      // `authorId` referencia a un User: una nota de agente no tiene autor humano.
      return reports.opCreateNote(projectId, String(args.message ?? ""), null);
    },
  },
  {
    name: "get_user_story",
    descriptionKey: "tool_get_user_story",
    inputSchema: withProjectId({ storyId: { type: "string" } }, ["storyId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:read");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      return stories.opGetStoryDetail(story);
    },
  },
  {
    name: "list_brainstorms",
    descriptionKey: "tool_list_brainstorms",
    inputSchema: withProjectId({
      status: {
        type: "string",
        enum: ["recording", "closing", "closed", "abandoned"],
        description: "tool_list_brainstorms_status",
      },
    }),
    handler: async (ctx, args) =>
      brainstorm.opListSessions(await requireProject(ctx, args, "brainstorm:read"), {
        status: typeof args.status === "string" ? args.status as brainstorm.ListSessionFilters["status"] : undefined,
      }),
  },
  {
    name: "get_brainstorm",
    descriptionKey: "tool_get_brainstorm",
    inputSchema: withProjectId(
      { sessionId: { type: "string", description: "tool_get_brainstorm_session_id" } },
      ["sessionId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "brainstorm:read");
      const session = await brainstorm.opGetSession(String(args.sessionId));
      if (session.projectId !== projectId) throw notFound("brainstorm_session_not_found");
      return session;
    },
  },
  {
    name: "delete_user_story",
    descriptionKey: "tool_delete_user_story",
    inputSchema: withProjectId(
      { storyId: { type: "string" }, keepCard: { type: "boolean" } },
      ["storyId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "stories:write");
      const story = await stories.getStoryById(String(args.storyId));
      if (!story || story.projectId !== projectId) throw forbidden("story_not_in_project");
      // Del otro lado del MCP no hay nadie mirando un diálogo de confirmación:
      // el default borra la tarjeta para que el agente no deje huérfanas sin
      // enterarse. Quien quiera conservarla lo pide explícitamente.
      return stories.opDeleteStory(story, { deleteCard: args.keepCard !== true });
    },
  },
  {
    name: "update_card",
    descriptionKey: "tool_update_card",
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
        throw forbidden("card_not_in_project");

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
    descriptionKey: "tool_delete_card",
    inputSchema: withProjectId({ cardId: { type: "string" } }, ["cardId"]),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:write");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("card_not_in_project");
      return board.opDeleteCard(card.id);
    },
  },
  {
    name: "list_card_activities",
    descriptionKey: "tool_list_card_activities",
    inputSchema: withProjectId(
      { cardId: { type: "string" }, limit: { type: "number" } },
      ["cardId"]
    ),
    handler: async (ctx, args) => {
      const projectId = await requireProject(ctx, args, "board:read");
      const card = await board.getCardWithProject(String(args.cardId));
      if (!card || card.board.projectId !== projectId)
        throw forbidden("card_not_in_project");
      return board.opListCardActivities(
        card.id,
        typeof args.limit === "number" ? args.limit : undefined
      );
    },
  },
  {
    name: "list_skills",
    descriptionKey: "tool_list_skills",
    inputSchema: withWorkspaceId(),
    handler: async (ctx, args) => {
      const workspaceId = await requireWorkspace(ctx, args, "skills:read");
      return { skills: await skills.opListSkills(workspaceId) };
    },
  },
  {
    name: "get_skill",
    descriptionKey: "tool_get_skill",
    inputSchema: withWorkspaceId(
      {
        slug: { type: "string" },
        target: { type: "string", enum: [...SKILL_TARGETS] },
        destination: { type: "string", enum: [...SKILL_DESTINATIONS] },
      },
      ["slug", "target", "destination"]
    ),
    handler: async (ctx, args) => {
      const workspaceId = await requireWorkspace(ctx, args, "skills:read");
      const apiBaseUrl = env.PUBLIC_API_URL?.replace(/\/+$/, "") || env.WEB_ORIGIN;
      return skills.opGetSkill(workspaceId, String(args.slug), {
        target: args.target as SkillTarget,
        destination: args.destination as SkillDestination,
        apiBaseUrl,
      });
    },
  },
  {
    name: "publish_skill",
    descriptionKey: "tool_publish_skill",
    inputSchema: withWorkspaceId(
      {
        slug: { type: "string", description: "tool_publish_skill_slug" },
        name: { type: "string" },
        description: { type: "string" },
      },
      ["slug", "name", "description"]
    ),
    handler: async (ctx, args) => {
      const workspaceId = await requireWorkspace(ctx, args, "skills:write");
      const apiBaseUrl = env.PUBLIC_API_URL?.replace(/\/+$/, "") || env.WEB_ORIGIN;
      return skills.opStartSkillUpload(
        workspaceId,
        {
          slug: String(args.slug),
          name: String(args.name),
          description: String(args.description),
        },
        { type: "agent", id: ctx.key.agentId ?? ctx.key.id },
        apiBaseUrl
      );
    },
  },
  {
    name: "delete_skill",
    descriptionKey: "tool_delete_skill",
    inputSchema: withWorkspaceId({ slug: { type: "string" } }, ["slug"]),
    handler: async (ctx, args) => {
      const workspaceId = await requireWorkspace(ctx, args, "skills:write");
      return skills.opDeleteSkill(workspaceId, String(args.slug));
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
  if (!tool) throw badRequest("unknown_tool", { name });
  agents.assertKeyUsable(key);
  const locale = agents.resolveApiKeyLocale(key);
  if (!isToolAvailable(MCP_TOOLS[tool.name].access, key.scopes as ApiScope[]))
    throw forbidden("api_key_missing_permission", { permission: describeToolAccess(MCP_TOOLS[tool.name].access, locale) });
  const ctx: McpContext = {
    key,
    projectId: key.projectId,
    resolvedWorkspaceId: null,
    locale,
  };
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

/** Omite workspaceId cuando la key ya fija proyecto o workspace. */
function withoutWorkspaceId(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties || !("workspaceId" in properties)) return schema;
  const { workspaceId: _pinned, ...rest } = properties;
  const next: Record<string, unknown> = { ...schema, properties: rest };
  const required = (schema.required as string[] | undefined)?.filter((r) => r !== "workspaceId");
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
 * - Omite `workspaceId` si la key fija proyecto o workspace.
 *
 * Esto es una optimización del catálogo, NO un control de acceso: `tools/call`
 * sigue exigiendo el scope aunque alguien invoque una tool que no vio listada.
 */
export function listMcpToolDefs(key?: ApiKey) {
  const scopes = key ? (key.scopes as ApiScope[]) : null;
  const projectPinned = key ? key.scopeLevel === "project" : false;
  const workspacePinned = key ? key.scopeLevel === "project" || key.scopeLevel === "workspace" : false;
  const locale = key ? agents.resolveApiKeyLocale(key) : "es";
  return TOOLS.filter((t) => scopes === null || isToolAvailable(MCP_TOOLS[t.name].access, scopes)).map(
    (t) => {
      let inputSchema = localizeSchema(t.inputSchema, locale) as Record<string, unknown>;
      if (projectPinned) inputSchema = withoutProjectId(inputSchema);
      if (workspacePinned) inputSchema = withoutWorkspaceId(inputSchema);
      return {
        name: t.name,
        description: mcpText(locale, t.descriptionKey),
        inputSchema,
        access: MCP_TOOLS[t.name].access,
      };
    }
  );
}

// ─── Registro de resources ─────────────────────────────────────────────────

interface McpResource {
  uri: string;
  name: string;
  descriptionKey: keyof typeof mcpEs;
  scope: ApiScope;
  read: (ctx: McpContext) => Promise<unknown>;
}

const RESOURCES: McpResource[] = [
  {
    uri: "pemie://project/context",
    name: "project_context",
    descriptionKey: "resource_project_context",
    scope: "commits:read",
    read: (ctx) => TOOL_BY_NAME.get("get_project_context")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/commits",
    name: "commits",
    descriptionKey: "resource_commits",
    scope: "commits:read",
    read: (ctx) => TOOL_BY_NAME.get("list_commits")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/reports",
    name: "reports",
    descriptionKey: "resource_reports",
    scope: "reports:read",
    read: (ctx) => TOOL_BY_NAME.get("get_evaluation")!.handler(ctx, {}),
  },
  {
    uri: "pemie://project/notes",
    name: "notes",
    descriptionKey: "resource_notes",
    scope: "notes:read",
    read: (ctx) => TOOL_BY_NAME.get("list_notes")!.handler(ctx, {}),
  },
];

const RESOURCE_BY_URI = new Map(RESOURCES.map((r) => [r.uri, r]));

/** Recursos visibles para una key. A diferencia de las tools, todos requieren un scope. */
export function listMcpResourceDefs(key?: ApiKey) {
  const scopes = key ? (key.scopes as ApiScope[]) : null;
  const locale = key ? agents.resolveApiKeyLocale(key) : "es";
  return RESOURCES.filter((resource) => scopes === null || scopes.includes(resource.scope)).map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: mcpText(locale, resource.descriptionKey),
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
      if (!tool) return rpcError(id, -32602, mcpText(ctx.locale, "rpc_unknown_tool", { name }));
      if (!isToolAvailable(MCP_TOOLS[tool.name].access, ctx.key.scopes as ApiScope[]))
        return rpcError(
          id,
          -32000,
          mcpText(ctx.locale, "rpc_missing_permission", {
            permission: describeToolAccess(MCP_TOOLS[tool.name].access, ctx.locale),
          })
        );
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
          return rpcResult(id, {
            ...asText({ error: renderServiceError(err, callCtx.locale), code: err.code }),
            isError: true,
          });
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
      if (!resource) return rpcError(id, -32602, mcpText(ctx.locale, "rpc_unknown_resource", { uri }));
      agents.requireScope(ctx.key, resource.scope);
      const data = await resource.read(ctx);
      return rpcResult(id, {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      });
    }

    default:
      return isNotification
        ? undefined
        : rpcError(id, -32601, mcpText(ctx.locale, "rpc_unsupported_method", { method: req.method }));
  }
}

async function safeHandle(ctx: McpContext, req: RpcRequest): Promise<object | undefined> {
  try {
    return await handleRpc(ctx, req);
  } catch (err) {
    if (err instanceof ServiceError) return rpcError(req.id ?? null, -32000, renderServiceError(err, ctx.locale));
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
      const locale = parseAcceptLanguage(c.req.header("accept-language")) ?? "es";
      return c.json({ error: mcpText(locale, "rpc_sse_not_supported") }, 405);
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
    // Sin key todavía: el único locale disponible es Accept-Language.
    const preAuthLocale = parseAcceptLanguage(c.req.header("accept-language")) ?? "es";
    let key: ApiKey & { owner?: { locale: string } | null };
    try {
      key = await agents.authenticateApiKey(bearer);
    } catch (err) {
      const msg =
        err instanceof ServiceError
          ? renderServiceError(err, preAuthLocale)
          : mcpText(preAuthLocale, "rpc_unauthorized");
      return c.json(rpcError(null, -32001, msg), 401);
    }

    const body = (await c.req.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
    if (!body) return c.json(rpcError(null, -32700, "Parse error"), 400);
    const ctx: McpContext = {
      key,
      projectId: key.projectId,
      resolvedWorkspaceId: null,
      locale: agents.resolveApiKeyLocale(key),
    };
    // Las rutas MCP no pasan por sessionMiddleware (solo se monta en /api/*):
    // sin esto, un throw no-ServiceError llegaría a onError con c.get("locale")
    // === undefined y caería al "es" default aunque la key sea inglesa.
    c.set("locale", ctx.locale);

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
