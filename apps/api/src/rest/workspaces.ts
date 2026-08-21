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
import * as assignees from "../services/assignees.js";
import * as leaderboard from "../services/leaderboard.js";
import * as overview from "../services/overview.js";
import * as agentReliability from "../services/agent-reliability.js";
import * as searchSvc from "../services/search.js";
import * as skills from "../services/skills.js";
import { badRequest } from "../services/errors.js";
import { type AppContext, type AppEnv, apiOrigin, requireUser } from "./http.js";
import { isSafeHttpUrl, SEARCHABLE_TYPES, SKILL_DESTINATIONS, SKILL_TARGETS, type SkillDestination, type SkillTarget } from "@pemie/shared";

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
  // `.url()` de Zod acepta cualquier esquema, y este valor se pinta como `href`
  // en la pestaña Commits: un `javascript:` guardado aquí se ejecutaría con la
  // sesión de quien haga clic.
  url: z.string().url().refine(isSafeHttpUrl, { message: "unsafe_url_scheme" }).optional(),
  externalId: z.string().optional(),
  // Sin `installationId`: ver el comentario de ingest.LinkRepoInput.
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
  scopeLevel: z.enum(["project", "workspace"]).optional(),
  projectId: z.string().optional(),
  agentId: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.coerce.date().optional(),
  locale: z.enum(["es", "en"]).optional(),
});
const updateApiKeyLocaleSchema = z.object({ locale: z.enum(["es", "en"]) });
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
  isEpic: z.boolean().optional(),
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
  isEpic: z.boolean().optional(),
});
const updateContributorSchema = z.object({ email: z.string().nullable() });
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
    if (!body.success) throw badRequest("invalid_workspace_name");
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
    if (!body.success) throw badRequest("invalid_workspace_name");
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
    if (!body.success) throw badRequest("invalid_member_role");
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
    if (!body.success) throw badRequest("invalid_invitation_body");
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
    if (!body.success) throw badRequest("invalid_project_body");
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
    if (!body.success) throw badRequest("invalid_repo_body");
    const { repo, ingested, syncError } = await ingest.linkRepo(user.id, project.id, body.data);
    return c.json({ repo, ingested, syncError }, 201);
  });

  // Repos visibles por una instalación de la GitHub App ya vinculada al proyecto.
  // El servicio decide si esta instalación es de este proyecto; aquí solo se parsea.
  app.get("/:slug/projects/:projectSlug/github/repos", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const installationId = c.req.query("installationId");
    if (!installationId) throw badRequest("missing_installation");
    return c.json({
      repos: await ingest.listProjectInstallationRepos(user.id, project.id, installationId),
    });
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

  // PEM-45: vista de estado del proyecto (objetivo, stats, WIP, drift, último informe).
  app.get("/:slug/projects/:projectSlug/overview", async (c) => {
    const project = await resolveProject(c);
    return c.json(await overview.opProjectOverview(project.id));
  });

  // PEM-48: proporción de acciones de agente que un humano no deshizo.
  app.get("/:slug/projects/:projectSlug/agent-reliability", async (c) => {
    const project = await resolveProject(c);
    const windowDaysRaw = c.req.query("windowDays");
    const settleHoursRaw = c.req.query("settleHours");
    return c.json(
      await agentReliability.opAgentReliability(project.id, {
        windowDays:
          windowDaysRaw != null && Number.isFinite(Number(windowDaysRaw))
            ? Number(windowDaysRaw)
            : undefined,
        settleHours:
          settleHoursRaw != null && Number.isFinite(Number(settleHoursRaw))
            ? Number(settleHoursRaw)
            : undefined,
      })
    );
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
    if (!body.success) throw badRequest("invalid_domain_config");
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
    if (!body.success) throw badRequest("invalid_objective_body");
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
    if (!body.success) throw badRequest("invalid_report_body");
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
    if (!body.success) throw badRequest("invalid_note_body");
    return c.json({ note: await reports.createNote(user.id, project.id, body.data.message) }, 201);
  });

  app.post("/:slug/projects/:projectSlug/notes/:noteId/answer", async (c) => {
    const user = requireUser(c);
    const body = answerNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_answer_body");
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
    if (!body.success) throw badRequest("invalid_agent_body");
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
    if (!body.success) throw badRequest("invalid_api_key_body");
    // El servicio valida que los scopes existan; aquí solo pasamos los datos.
    const result = await agentsSvc.createApiKey(user.id, ws.id, {
      name: body.data.name,
      scopeLevel: body.data.scopeLevel,
      projectId: body.data.projectId,
      agentId: body.data.agentId,
      scopes: body.data.scopes,
      expiresAt: body.data.expiresAt,
      locale: body.data.locale,
    });
    return c.json(result, 201);
  });

  app.patch("/:slug/api-keys/:keyId/locale", async (c) => {
    const user = requireUser(c);
    await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = updateApiKeyLocaleSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_preference_body");
    const apiKey = await agentsSvc.updateApiKeyLocale(user.id, c.req.param("keyId"), body.data.locale);
    return c.json({ apiKey });
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

  // ─── F5: Historias de Usuario (incluye épicas: PEM-57) ─────────────
  app.get("/:slug/projects/:projectSlug/user-stories", async (c) => {
    const project = await resolveProject(c);
    // `?type=epic|story` es la forma pública de filtrar por isEpic: el
    // transporte traduce, el servicio no conoce la palabra "type".
    const type = c.req.query("type");
    return c.json({
      userStories: await stories.opListStories(project.id, {
        status: c.req.query("status"),
        epicId: c.req.query("epicId"),
        isEpic: type === "epic" ? true : type === "story" ? false : undefined,
      }),
    });
  });

  app.get("/:slug/projects/:projectSlug/contributors", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    return c.json({ contributors: await stories.listContributors(user.id, project.id) });
  });

  app.get("/:slug/projects/:projectSlug/assignees", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    return c.json({ assignees: await assignees.listAssignableCandidates(user.id, project.id) });
  });

  app.patch("/:slug/projects/:projectSlug/contributors/:contributorId", async (c) => {
    const user = requireUser(c);
    const body = updateContributorSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_contributor_body");
    return c.json({ contributor: await stories.updateContributorEmail(user.id, c.req.param("contributorId"), body.data.email) });
  });

  app.post("/:slug/projects/:projectSlug/user-stories", async (c) => {
    const user = requireUser(c);
    const project = await resolveProject(c);
    const body = createStorySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_story_body");
    return c.json({ userStory: await stories.createStory(user.id, project.id, body.data) }, 201);
  });

  app.get("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    return c.json({ userStory: await stories.getStory(user.id, c.req.param("storyId")) });
  });

  app.patch("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    const body = updateStorySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_story_body");
    return c.json({ userStory: await stories.updateStory(user.id, c.req.param("storyId"), body.data) });
  });

  app.delete("/:slug/projects/:projectSlug/user-stories/:storyId", async (c) => {
    const user = requireUser(c);
    // `?keepCard=1` conserva la tarjeta desvinculada; sin él se borra con la HU.
    // Contra un default destructivo el parseo tiene que ser generoso con lo que
    // la gente escribe y ruidoso con lo que no entiende: silencioso y estricto
    // convertiría un `keepCard=true` en un borrado que nadie pidió.
    const rawKeepCard = c.req.query("keepCard");
    if (rawKeepCard !== undefined && !KEEP_CARD_VALUES.has(rawKeepCard)) throw badRequest("invalid_keep_card");
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
    if (!body.success) throw badRequest("invalid_card_body");
    return c.json({ card: await board.createCard(user.id, project.id, body.data) }, 201);
  });

  app.patch("/:slug/projects/:projectSlug/board/cards/:cardId", async (c) => {
    const user = requireUser(c);
    const body = updateCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_card_body");
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
    if (!body.success) throw badRequest("invalid_move_body");
    return c.json({ card: await board.moveCard(user.id, c.req.param("cardId"), body.data) });
  });

  // ─── Catálogo de skills (docs/skills-catalog.md) ───────────────────
  // Scope workspace: listar/obtener/borrar por sesión; el upload de bytes
  // viaja por /api/skill-uploads (token), no por estas rutas.
  app.get("/:slug/skills", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json({ skills: await skills.listSkills(user.id, ws.id) });
  });

  app.get("/:slug/skills/:skillSlug", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const target = c.req.query("target");
    const destination = c.req.query("destination");
    if (!target || !SKILL_TARGETS.includes(target as SkillTarget))
      throw badRequest("invalid_target_list", { targets: SKILL_TARGETS.join(", ") });
    if (!destination || !SKILL_DESTINATIONS.includes(destination as SkillDestination))
      throw badRequest("invalid_destination_list", { destinations: SKILL_DESTINATIONS.join(", ") });
    return c.json(
      await skills.getSkill(user.id, ws.id, c.req.param("skillSlug"), {
        target: target as SkillTarget,
        destination: destination as SkillDestination,
        apiBaseUrl: apiOrigin(c),
      })
    );
  });

  app.post("/:slug/skills", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    const body = z
      .object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_skill_body");
    const ticket = await skills.startSkillUpload(
      user.id,
      ws.id,
      body.data,
      { type: "user", id: user.id },
      apiOrigin(c)
    );
    return c.json(ticket, 201);
  });

  app.delete("/:slug/skills/:skillSlug", async (c) => {
    const user = requireUser(c);
    const ws = await tenancy.getWorkspace(user.id, c.req.param("slug"));
    return c.json(await skills.deleteSkill(user.id, ws.id, c.req.param("skillSlug")));
  });

  return app;
}
