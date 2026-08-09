// Rutas REST de workspaces, membresías, invitaciones y proyectos.
// Delegan en src/services/tenancy. Todas requieren usuario autenticado.

import { Hono } from "hono";
import { z } from "zod";
import * as tenancy from "../services/tenancy.js";
import * as ingest from "../services/ingest.js";
import * as stats from "../services/stats.js";
import * as reports from "../services/reports.js";
import * as agentsSvc from "../services/agents.js";
import * as stories from "../services/stories.js";
import * as board from "../services/board.js";
import * as leaderboard from "../services/leaderboard.js";
import * as searchSvc from "../services/search.js";
import { badRequest } from "../services/errors.js";
import { listInstallationRepos } from "../lib/github-app.js";
import { type AppContext, type AppEnv, requireUser } from "./http.js";
import { SEARCHABLE_TYPES } from "@pemie/shared";

const createWorkspaceSchema = z.object({ name: z.string().min(2) });
const updateWorkspaceSchema = z.object({ name: z.string().min(2) });
const createProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  key: z.string().optional(),
});
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).optional(),
});
const updateMemberRoleSchema = z.object({ role: z.enum(["admin", "member", "viewer"]) });
const linkRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().optional(),
  externalId: z.string().optional(),
  installationId: z.string().optional(),
});
const objectiveSchema = z.object({ description: z.string().min(3) });
const publishReportSchema = z.object({
  date: z.string().optional(),
  slot: z.string().optional(),
  scope: z.enum(["day", "general"]).optional(),
  comment: z.string().optional(),
  verdict: z.string().optional(),
  score: z.number().min(0).max(100).optional(),
  metrics: z.unknown().optional(),
});
const createNoteSchema = z.object({ message: z.string().min(1) });
const answerNoteSchema = z.object({
  response: z.string().min(1),
  reportId: z.string().optional(),
});
const createAgentSchema = z.object({
  name: z.string().min(2),
  kind: z.string().optional(),
});
const createApiKeySchema = z.object({
  name: z.string().min(2),
  scopeLevel: z.enum(["project", "workspace", "user"]).optional(),
  projectId: z.string().optional(),
  agentId: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.coerce.date().optional(),
});
const createEpicSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
});
const narrativeSchema = z.object({
  role: z.string(),
  want: z.string(),
  benefit: z.string(),
});
const acceptanceCriterionSchema = z.object({
  given: z.string(),
  when: z.string(),
  then: z.string(),
});
const createStorySchema = z.object({
  title: z.string().min(2),
  narrative: narrativeSchema.optional(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  storyPoints: z.number().int().optional(),
  epicId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.string().optional(),
});
const updateStorySchema = z.object({
  title: z.string().min(2).optional(),
  narrative: narrativeSchema.nullable().optional(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  storyPoints: z.number().int().nullable().optional(),
  status: z.string().optional(),
  epicId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});
const createCardSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["story", "task", "bug"]).optional(),
  description: z.string().optional(),
  columnId: z.string().optional(),
  userStoryId: z.string().optional(),
  assigneeId: z.string().optional(),
  labels: z.unknown().optional(),
});
const updateCardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(["story", "task", "bug"]).optional(),
  assigneeId: z.string().nullable().optional(),
  userStoryId: z.string().nullable().optional(),
  labels: z.unknown().optional(),
});
const moveCardSchema = z.object({
  columnId: z.string().min(1),
  order: z.number().optional(),
});
/** Valores aceptados en `?keepCard=`; cualquier otro es un 400, no un borrado. */
const KEEP_CARD_VALUES = new Set(["1", "true", "0", "false"]);
const domainCategorySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  emoji: z.string().optional(),
  matchers: z.array(z.string()).optional(),
  primary: z.boolean().optional(),
});
const domainConfigSchema = z
  .object({
    categories: z.array(domainCategorySchema).min(1),
    fallback: z.string().min(1),
  })
  .refine(
    (c) => new Set(c.categories.map((x) => x.key)).size === c.categories.length,
    { message: "duplicate_keys", path: ["categories"] }
  );

export function workspaceRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = requireUser(c);
    return c.json({ workspaces: await tenancy.listWorkspaces(user.id) });
  });

  app.post("/", async (c) => {
    const user = requireUser(c);
    const body = createWorkspaceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Nombre inválido", "invalid_body");
    const ws = await tenancy.createWorkspace(user.id, body.data.name);
    return c.json({ workspace: ws }, 201);
  });

  app.get("/:slug", async (c) => {
    const user = requireUser(c);
    return c.json({ workspace: await tenancy.getWorkspace(user.id, c.req.param("slug")) });
  });

  app.patch("/:slug", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = updateWorkspaceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Nombre inválido", "invalid_body");
    return c.json({ workspace: await tenancy.updateWorkspace(user.id, ws.id, body.data) });
  });

  app.delete("/:slug", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json(await tenancy.deleteWorkspace(user.id, ws.id));
  });

  app.get("/:slug/members", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ members: await tenancy.listMembers(user.id, ws.id) });
  });

  app.patch("/:slug/members/:membershipId", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = updateMemberRoleSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Rol inválido", "invalid_body");
    const member = await tenancy.updateMemberRole(
      user.id,
      ws.id,
      c.req.param("membershipId"),
      body.data.role
    );
    return c.json({ member });
  });

  app.delete("/:slug/members/:membershipId", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json(await tenancy.removeMember(user.id, ws.id, c.req.param("membershipId")));
  });

  // ─── Invitaciones (owner/admin) ────────────────────────────────────
  app.get("/:slug/invitations", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ invitations: await tenancy.listInvitations(user.id, ws.id) });
  });

  app.post("/:slug/invitations", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = inviteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de invitación inválidos", "invalid_body");
    const invite = await tenancy.createInvitation(
      user.id,
      ws.id,
      body.data.email,
      body.data.role ?? "member"
    );
    return c.json({ invitation: invite }, 201);
  });

  app.delete("/:slug/invitations/:id", async (c) => {
    const user = requireUser(c);
    await tenancy.revokeInvitation(user.id, c.req.param("id"));
    return c.json({ ok: true });
  });

  // ─── Proyectos ─────────────────────────────────────────────────────
  app.get("/:slug/projects", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ projects: await tenancy.listProjects(user.id, ws.id) });
  });

  app.post("/:slug/projects", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = createProjectSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de proyecto inválidos", "invalid_body");
    const project = await tenancy.createProject(user.id, ws.id, body.data);
    return c.json({ project }, 201);
  });

  app.get("/:slug/projects/:projectSlug", async (c) => {
    const user = requireUser(c);
    const project = await tenancy.getProject(
      user.id,
      c.req.param("slug"),
      c.req.param("projectSlug")
    );
    return c.json({ project });
  });

  // ─── F2: Ingesta (repos / commits / stats) ─────────────────────────
  // `resolveProject` valida membresía (viewer) y que el proyecto pertenezca al
  // workspace; los servicios de ingesta re-verifican el rol requerido.
  const resolveProject = (c: AppContext) =>
    tenancy.getProject(requireUser(c).id, c.req.param("slug")!, c.req.param("projectSlug")!);

  app.get("/:slug/projects/:projectSlug/repos", async (c) => {
    const project = await resolveProject(c);
    return c.json({ repos: await ingest.opListRepos(project.id) });
  });

  app.post("/:slug/projects/:projectSlug/repos", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = linkRepoSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos del repo inválidos", "invalid_body");
    const { repo, ingested, syncError } = await ingest.linkRepo(user.id, project.id, body.data);
    return c.json({ repo, ingested, syncError }, 201);
  });

  // Repos disponibles vía una instalación de la GitHub App (para elegir cuál vincular).
  app.get("/:slug/projects/:projectSlug/github/repos", async (c) => {
    await resolveProject(c);
    const installationId = c.req.query("installationId");
    if (!installationId) throw badRequest("Falta installationId", "missing_installation");
    return c.json({ repos: await listInstallationRepos(installationId) });
  });

  app.delete("/:slug/projects/:projectSlug/repos/:repoId", async (c) => {
    const user = requireUser(c);
    return c.json(await ingest.unlinkRepo(user.id, c.req.param("repoId")));
  });

  // Sincroniza todos los repos del proyecto. Antes de :repoId para que "sync"
  // no se interprete como un id de repo.
  // `?mode=auto` sincroniza solo lo vencido y solo lo nuevo (lo que dispara la
  // pestaña al abrirse); por defecto trae el histórico completo.
  app.post("/:slug/projects/:projectSlug/repos/sync", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const mode = c.req.query("mode") === "auto" ? "auto" : "full";
    return c.json(await ingest.backfillProject(user.id, project.id, mode));
  });

  app.post("/:slug/projects/:projectSlug/repos/:repoId/backfill", async (c) => {
    const user = requireUser(c);
    return c.json(await ingest.backfillRepo(user.id, c.req.param("repoId")));
  });

  app.get("/:slug/projects/:projectSlug/commits", async (c) => {
    const project = await resolveProject(c);
    const commits = await ingest.opListCommits(project.id, ingest.parseCommitFilters(c.req.query()));
    return c.json({ commits });
  });

  app.get("/:slug/projects/:projectSlug/stats", async (c) => {
    const project = await resolveProject(c);
    return c.json({ stats: await stats.opProjectStats(project.id) });
  });

  app.get("/:slug/projects/:projectSlug/leaderboard", async (c) => {
    const project = await resolveProject(c);
    return c.json({ leaderboard: await leaderboard.opProjectLeaderboard(project.id) });
  });

  app.get("/:slug/projects/:projectSlug/search", async (c) => {
    const project = await resolveProject(c);
    const q = c.req.query("q") ?? "";
    const limitParam = c.req.query("limit");
    const result = await searchSvc.opSearch(
      project.id,
      { query: q, limit: limitParam ? Number(limitParam) : undefined },
      [...SEARCHABLE_TYPES]
    );
    return c.json(result);
  });

  app.put("/:slug/projects/:projectSlug/domain-config", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = domainConfigSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("DomainConfig inválida", "invalid_body");
    const result = await ingest.updateDomainConfig(user.id, project.id, body.data);
    return c.json(result);
  });

  // ─── F3: Objetivo, informes y notas (flujo Hermes generalizado) ────
  app.get("/:slug/projects/:projectSlug/objective", async (c) => {
    const project = await resolveProject(c);
    return c.json({ objective: await reports.opGetObjective(project.id) });
  });

  app.put("/:slug/projects/:projectSlug/objective", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = objectiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Objetivo inválido", "invalid_body");
    return c.json({ objective: await reports.setObjective(user.id, project.id, body.data.description) });
  });

  app.get("/:slug/projects/:projectSlug/objective/history", async (c) => {
    const project = await resolveProject(c);
    return c.json({ history: await reports.opListObjectiveHistory(project.id) });
  });

  app.get("/:slug/projects/:projectSlug/reports", async (c) => {
    const project = await resolveProject(c);
    const scope = c.req.query("scope");
    return c.json({
      reports: await reports.opListReports(project.id, {
        scope: scope === "day" || scope === "general" ? scope : undefined,
        limit: Number(c.req.query("limit")) || undefined,
      }),
    });
  });

  app.post("/:slug/projects/:projectSlug/reports", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = publishReportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos del informe inválidos", "invalid_body");
    const report = await reports.publishReport(user.id, project.id, body.data);
    return c.json({ report }, 201);
  });

  app.get("/:slug/projects/:projectSlug/reports/:reportId", async (c) => {
    const user = requireUser(c);
    return c.json({ report: await reports.getReport(user.id, c.req.param("reportId")) });
  });

  app.delete("/:slug/projects/:projectSlug/reports/:reportId", async (c) => {
    const user = requireUser(c);
    return c.json(await reports.deleteReport(user.id, c.req.param("reportId")));
  });

  app.get("/:slug/projects/:projectSlug/notes", async (c) => {
    const project = await resolveProject(c);
    const status = c.req.query("status");
    return c.json({
      notes: await reports.opListNotes(project.id, {
        status: status === "pending" || status === "processed" ? status : undefined,
        limit: Number(c.req.query("limit")) || undefined,
      }),
    });
  });

  app.post("/:slug/projects/:projectSlug/notes", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Nota inválida", "invalid_body");
    return c.json({ note: await reports.createNote(user.id, project.id, body.data.message) }, 201);
  });

  app.post("/:slug/projects/:projectSlug/notes/:noteId/answer", async (c) => {
    const user = requireUser(c);
    const body = answerNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Respuesta inválida", "invalid_body");
    const note = await reports.answerNote(user.id, c.req.param("noteId"), body.data.response, body.data.reportId);
    return c.json({ note });
  });

  // ─── F4: Agentes (por proyecto) ────────────────────────────────────
  app.get("/:slug/projects/:projectSlug/agents", async (c) => {
    const project = await resolveProject(c);
    return c.json({ agents: await agentsSvc.opListAgents(project.id) });
  });

  app.post("/:slug/projects/:projectSlug/agents", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createAgentSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos del agente inválidos", "invalid_body");
    const agent = await agentsSvc.createAgent(user.id, project.id, body.data.name, body.data.kind);
    return c.json({ agent }, 201);
  });

  app.get("/:slug/projects/:projectSlug/audit", async (c) => {
    const project = await resolveProject(c);
    const limit = Number(c.req.query("limit")) || undefined;
    return c.json({
      auditLogs: await agentsSvc.opListAuditLogsForProject(project.workspaceId, project.id, limit),
    });
  });

  // ─── F4: Agentes del workspace (todos los proyectos) ───────────────
  app.get("/:slug/agents", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ agents: await agentsSvc.listAgentsInWorkspace(user.id, ws.id) });
  });

  app.delete("/:slug/agents/:agentId", async (c) => {
    const user = requireUser(c);
    await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json(await agentsSvc.deleteAgent(user.id, c.req.param("agentId")));
  });

  // Bloquear/desbloquear una key ajena vista operando aquí. No hay DELETE: la
  // key pertenece a otro workspace y desde este solo se le corta el paso.
  app.post("/:slug/agents/presence/:presenceId/block", async (c) => {
    const user = requireUser(c);
    await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const presence = await agentsSvc.blockAgentPresence(user.id, c.req.param("presenceId"));
    return c.json({ presence });
  });

  app.post("/:slug/agents/presence/:presenceId/unblock", async (c) => {
    const user = requireUser(c);
    await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const presence = await agentsSvc.unblockAgentPresence(user.id, c.req.param("presenceId"));
    return c.json({ presence });
  });

  // ─── F4: API keys y AuditLog (por workspace, admin+) ───────────────
  app.get("/:slug/api-keys", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ apiKeys: await agentsSvc.listApiKeys(user.id, ws.id) });
  });

  app.post("/:slug/api-keys", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = createApiKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la API key inválidos", "invalid_body");
    // El servicio valida que los scopes existan; aquí solo pasamos los datos.
    const result = await agentsSvc.createApiKey(user.id, ws.id, {
      name: body.data.name,
      scopeLevel: body.data.scopeLevel,
      projectId: body.data.projectId,
      agentId: body.data.agentId,
      scopes: body.data.scopes,
      expiresAt: body.data.expiresAt,
    });
    return c.json(result, 201);
  });

  app.delete("/:slug/api-keys/:keyId", async (c) => {
    const user = requireUser(c);
    await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json(await agentsSvc.revokeApiKey(user.id, c.req.param("keyId")));
  });

  app.get("/:slug/audit", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const limit = Number(c.req.query("limit")) || undefined;
    return c.json({ auditLogs: await agentsSvc.listAuditLogs(user.id, ws.id, limit) });
  });

  // ─── F5: Épicas e Historias de Usuario ─────────────────────────────
  app.get("/:slug/projects/:projectSlug/epics", async (c) => {
    const project = await resolveProject(c);
    return c.json({ epics: await stories.opListEpics(project.id) });
  });

  app.post("/:slug/projects/:projectSlug/epics", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createEpicSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la épica inválidos", "invalid_body");
    return c.json({ epic: await stories.createEpic(user.id, project.id, body.data) }, 201);
  });

  app.get("/:slug/projects/:projectSlug/user-stories", async (c) => {
    const project = await resolveProject(c);
    return c.json({
      userStories: await stories.opListStories(project.id, {
        status: c.req.query("status"),
        epicId: c.req.query("epicId"),
      }),
    });
  });

  app.get("/:slug/projects/:projectSlug/contributors", async (c) => {
    const project = await resolveProject(c);
    return c.json({ contributors: await stories.opListContributors(project.id) });
  });

  app.post("/:slug/projects/:projectSlug/user-stories", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createStorySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la HU inválidos", "invalid_body");
    return c.json({ userStory: await stories.createStory(user.id, project.id, body.data) }, 201);
  });

  app.get("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    return c.json({ userStory: await stories.getStory(user.id, c.req.param("storyId")) });
  });

  app.patch("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    const body = updateStorySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la HU inválidos", "invalid_body");
    return c.json({ userStory: await stories.updateStory(user.id, c.req.param("storyId"), body.data) });
  });

  app.delete("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    // `?keepCard=1` conserva la tarjeta desvinculada; sin él se borra con la HU.
    // Contra un default destructivo el parseo tiene que ser generoso con lo que
    // la gente escribe y ruidoso con lo que no entiende: silencioso y estricto
    // convertiría un `keepCard=true` en un borrado que nadie pidió.
    const rawKeepCard = c.req.query("keepCard");
    if (rawKeepCard !== undefined && !KEEP_CARD_VALUES.has(rawKeepCard))
      throw badRequest("keepCard admite 1, true, 0 o false", "invalid_keep_card");
    const keepCard = rawKeepCard === "1" || rawKeepCard === "true";
    return c.json(
      await stories.deleteStory(user.id, c.req.param("storyId"), { deleteCard: !keepCard })
    );
  });

  // ─── F6: Kanban ────────────────────────────────────────────────────
  app.get("/:slug/projects/:projectSlug/board", async (c) => {
    const project = await resolveProject(c);
    return c.json({ board: await board.opListBoard(project.id) });
  });

  app.post("/:slug/projects/:projectSlug/board/cards", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la tarjeta inválidos", "invalid_body");
    return c.json({ card: await board.createCard(user.id, project.id, body.data) }, 201);
  });

  app.patch("/:slug/projects/:projectSlug/board/cards/:cardId", async (c) => {
    const user = requireUser(c);
    const body = updateCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de la tarjeta inválidos", "invalid_body");
    return c.json({ card: await board.updateCard(user.id, c.req.param("cardId"), body.data) });
  });

  app.delete("/:slug/projects/:projectSlug/board/cards/:cardId", async (c) => {
    const user = requireUser(c);
    return c.json(await board.deleteCard(user.id, c.req.param("cardId")));
  });

  app.get("/:slug/projects/:projectSlug/board/cards/:cardId/activities", async (c) => {
    const user = requireUser(c);
    const limit = Number(c.req.query("limit")) || undefined;
    return c.json({
      activities: await board.listCardActivities(user.id, c.req.param("cardId"), limit),
    });
  });

  app.post("/:slug/projects/:projectSlug/board/cards/:cardId/move", async (c) => {
    const user = requireUser(c);
    const body = moveCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("Datos de movimiento inválidos", "invalid_body");
    return c.json({ card: await board.moveCard(user.id, c.req.param("cardId"), body.data) });
  });

  return app;
}
