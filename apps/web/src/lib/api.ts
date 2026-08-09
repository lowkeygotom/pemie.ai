// Cliente HTTP del backend pemie-api. El frontend es puro cliente: toda la
// lógica de negocio vive en el backend. Aquí solo hay transporte + tipos.

import type {
  DomainConfig,
  ObservedAgent,
  RegisteredAgent,
  Role,
  UserStoryNarrative,
  WorkspaceAgentRosterItem,
} from "@pemie/shared";

// En producción el front y el API comparten dominio (el API corre como función
// de Vercel bajo /api), así que la base es relativa: la cookie de sesión es
// first-party y no hay CORS. En dev el API vive en otro puerto. VITE_API_URL
// manda si está seteada (útil si algún día el API se separa de dominio).
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

// Un VITE_API_URL apuntando a localhost en un build de producción siempre es un
// accidente (un `.env` de dev que se coló al deploy), y el síntoma es brutal: el
// front publicado llama a la máquina del visitante. Se ignora en vez de obedecerlo.
const usableApiUrl =
  configuredApiUrl && (import.meta.env.DEV || !/^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(configuredApiUrl))
    ? configuredApiUrl
    : undefined;

const API_URL = usableApiUrl
  ? usableApiUrl.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? "http://localhost:4000"
    : "";

/** Base pública absoluta del API (para mostrar el endpoint MCP, enlaces, etc.). */
export const API_BASE =
  API_URL || (typeof window !== "undefined" ? window.location.origin : "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Motivo de fallo para un evento `*_failed`: solo el código de error tipado,
 * nunca `message` (puede traer texto libre del backend con datos del intento).
 */
export function analyticsFailureReason(err: unknown): string {
  return err instanceof ApiError ? err.code ?? "unknown_error" : "unknown_error";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.code);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** Base de rutas de un proyecto. */
const pp = (wsSlug: string, projectSlug: string) =>
  `/api/workspaces/${wsSlug}/projects/${projectSlug}`;

/** Construye un query string a partir de un objeto (ignora undefined/null). */
function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// ─── Tipos ───────────────────────────────────────────────────────────

export interface Health {
  status: string;
  service: string;
  db: string;
  timestamp: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
  createdAt: string;
  analyticsEnabled: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  projectCount: number;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  membershipId: string;
  role: Role;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  /** Presentes solo en la respuesta de creación. */
  acceptUrl?: string;
  emailDelivered?: boolean;
  /** URL de vista previa del email (cuando se usa el proveedor de prueba Ethereal). */
  emailPreviewUrl?: string;
}

export interface InvitationDetail {
  email: string;
  role: Role;
  workspace: { name: string; slug: string };
  expiresAt: string;
  expired: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  key: string;
  createdAt: string;
  _count: { repos: number; userStories: number };
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  key: string;
  domainConfig: DomainConfig | null;
  createdAt: string;
  updatedAt: string;
  workspace: { name: string; slug: string };
}

// ─── F2: ingesta ─────────────────────────────────────────────────────
export interface GithubUserRepo {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  url: string;
  description: string | null;
  updatedAt: string;
}
export interface Repo {
  id: string;
  owner: string;
  name: string;
  url: string | null;
  installationId: string | null;
  createdAt: string;
  _count: { commits: number };
}
/** Resultado de sincronizar todos los repos de un proyecto. */
export interface SyncResult {
  repos: number;
  fetched: number;
  ingested: number;
  failed: { repo: string; error: string }[];
}
export interface Contributor {
  id: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}
export interface Commit {
  id: string;
  sha: string;
  message: string;
  domain: string;
  committedAt: string;
  contributor: Contributor;
  repo: { id: string; owner: string; name: string };
}
export interface Stats {
  totalCommits: number;
  repoCount: number;
  byDomain: { key: string; label: string; emoji: string | null; primary: boolean; count: number }[];
  byContributor: { contributor: Contributor | null; count: number }[];
}
/** Ranking de HUs cerradas por actor (persona o agente): quién movió la tarjeta a "Hecho". */
export interface LeaderboardEntry {
  actorType: string;
  actorId: string | null;
  actorName: string;
  storiesClosed: number;
  pointsDelivered: number;
  avgDaysToClose: number | null;
}

// ─── F3: objetivo / informes / notas ─────────────────────────────────
export interface Objective {
  id: string;
  description: string;
  updatedAt: string;
}
export interface Report {
  id: string;
  date: string;
  slot: string;
  scope: string;
  comment: string | null;
  verdict: string | null;
  score: number | null;
  metrics: unknown;
  createdAt: string;
  agent?: { id: string; name: string } | null;
  _count?: { notes: number };
}
export interface Note {
  id: string;
  message: string;
  status: string;
  response: string | null;
  reportId: string | null;
  createdAt: string;
  processedAt: string | null;
  author?: { id: string; name: string | null; email: string } | null;
}

// ─── F5: historias de usuario ────────────────────────────────────────
export interface Epic {
  id: string;
  title: string;
  description: string | null;
  _count: { stories: number };
}
export interface UserStory {
  id: string;
  key: string;
  title: string;
  narrative: { role: string; want: string; benefit: string } | null;
  acceptanceCriteria: { given: string; when: string; then: string }[] | null;
  priority: string;
  storyPoints: number | null;
  status: string;
  epicId: string | null;
  epic?: { id: string; title: string } | null;
  assigneeId: string | null;
  assignee?: Contributor | null;
  createdAt: string;
}

// ─── F4: agentes / API keys / audit ──────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  _count: { apiKeys: number };
}

/**
 * Fila del roster de Equipo. Unión discriminada por `source`: `registered` es el
 * agente con fila propia de siempre; `observed` es una key de alcance amplio a
 * la que se vio operar en este workspace sin estar registrada en él.
 *
 * Los tipos viven en `@pemie/shared` porque el backend arma exactamente este
 * payload; aquí solo se les fija la representación de fechas del JSON (string).
 */
export type WorkspaceAgent = WorkspaceAgentRosterItem;
export type RegisteredWorkspaceAgent = RegisteredAgent;
export type ObservedWorkspaceAgent = ObservedAgent;

/** Presencia devuelta al bloquear/desbloquear (la lista se recarga aparte). */
export interface AgentPresence {
  id: string;
  apiKeyId: string;
  workspaceId: string;
  blockedAt: string | null;
  blockedById: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  scopeLevel: "project" | "workspace" | "user";
  ownerUserId: string | null;
  projectId: string | null;
  agentId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
export interface AuditLog {
  id: string;
  actorType: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: unknown;
  createdAt: string;
}

export interface TelegramChannelStatus {
  botConfigured: boolean;
  botUsername: string | null;
  linked: boolean;
  telegramUsername: string | null;
  linkedAt: string | null;
  enabled: boolean;
  hasLlmKey: boolean;
  llmKeyLast4: string | null;
  llmProvider: "anthropic" | "openai" | "deepseek";
  model: string;
  models: string[];
  providers: Record<
    "anthropic" | "openai" | "deepseek",
    { hasKey: boolean; last4: string | null; models: string[] }
  >;
  defaultProject: { id: string; name: string; slug: string } | null;
  apiKeyPrefix: string | null;
  ready: boolean;
}

// ─── F6: kanban ──────────────────────────────────────────────────────
export interface Card {
  id: string;
  columnId: string;
  order: number;
  type: string;
  title: string;
  description: string | null;
  userStoryId: string | null;
  userStory?: { id: string; key: string; title: string; status: string; narrative: UserStoryNarrative | null } | null;
  assigneeId: string | null;
  assignee?: Contributor | null;
  labels?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
export interface CardActivity {
  id: string;
  cardId: string;
  actorType: string;
  actorId: string | null;
  actorName: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}
export interface Column {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
  cards: Card[];
}
export interface Board {
  id: string;
  name: string;
  columns: Column[];
}

// ─── Búsqueda global ───────────────────────────────────────────────────
export interface SearchHit {
  type: "story" | "commit" | "note" | "card";
  id: string;
  ref: string | null;
  title: string;
  createdAt: string;
}

// ─── API ─────────────────────────────────────────────────────────────

export const api = {
  health: () => get<Health>("/api/health"),

  auth: {
    me: () => get<{ user: User | null }>("/api/auth/me"),
    register: (input: { email: string; password: string; name?: string }) =>
      post<{ user: User }>("/api/auth/register", input),
    login: (input: { email: string; password: string }) =>
      post<{ user: User }>("/api/auth/login", input),
    logout: () => post<{ ok: true }>("/api/auth/logout"),
    updateAnalyticsPreference: (analyticsEnabled: boolean) =>
      patch<{ user: User }>("/api/auth/me/analytics-preference", { analyticsEnabled }),
    /** URL para iniciar el OAuth de GitHub; `next` es la ruta a la que volver. */
    githubUrl: (next?: string) =>
      `${API_URL}/api/auth/github${next ? `?next=${encodeURIComponent(next)}` : ""}`,
    githubRepos: () => get<{ repos: GithubUserRepo[] }>("/api/auth/github/repos"),
  },

  workspaces: {
    list: () => get<{ workspaces: WorkspaceSummary[] }>("/api/workspaces"),
    create: (name: string) => post<{ workspace: Workspace }>("/api/workspaces", { name }),
    get: (slug: string) => get<{ workspace: Workspace }>(`/api/workspaces/${slug}`),
    update: (slug: string, name: string) =>
      patch<{ workspace: Workspace }>(`/api/workspaces/${slug}`, { name }),
    remove: (slug: string) => del<{ ok: true }>(`/api/workspaces/${slug}`),
    members: (slug: string) => get<{ members: Member[] }>(`/api/workspaces/${slug}/members`),
    updateMemberRole: (slug: string, membershipId: string, role: Role) =>
      patch<{ member: Member }>(`/api/workspaces/${slug}/members/${membershipId}`, { role }),
    removeMember: (slug: string, membershipId: string) =>
      del<{ ok: true }>(`/api/workspaces/${slug}/members/${membershipId}`),
    invitations: (slug: string) =>
      get<{ invitations: Invitation[] }>(`/api/workspaces/${slug}/invitations`),
    invite: (slug: string, email: string, role?: Role) =>
      post<{ invitation: Invitation }>(`/api/workspaces/${slug}/invitations`, { email, role }),
    revokeInvite: (slug: string, id: string) =>
      del<{ ok: true }>(`/api/workspaces/${slug}/invitations/${id}`),
  },

  projects: {
    list: (wsSlug: string) =>
      get<{ projects: ProjectSummary[] }>(`/api/workspaces/${wsSlug}/projects`),
    create: (wsSlug: string, input: { name: string; description?: string; key?: string }) =>
      post<{ project: Project }>(`/api/workspaces/${wsSlug}/projects`, input),
    get: (wsSlug: string, projectSlug: string) =>
      get<{ project: Project }>(`/api/workspaces/${wsSlug}/projects/${projectSlug}`),
    updateDomainConfig: (wsSlug: string, projectSlug: string, config: DomainConfig) =>
      put<{ config: DomainConfig; reclassified: number }>(
        `/api/workspaces/${wsSlug}/projects/${projectSlug}/domain-config`,
        config
      ),
  },

  // Base de rutas por proyecto.
  //   p(ws, prj) => "/api/workspaces/:ws/projects/:prj"

  // ─── F2: ingesta ───────────────────────────────────────────────────
  repos: {
    list: (w: string, p: string) => get<{ repos: Repo[] }>(`${pp(w, p)}/repos`),
    link: (w: string, p: string, input: { owner: string; name: string; url?: string }) =>
      post<{ repo: Repo; ingested: number; syncError: string | null }>(`${pp(w, p)}/repos`, input),
    unlink: (w: string, p: string, repoId: string) =>
      del<{ ok: true }>(`${pp(w, p)}/repos/${repoId}`),
    backfill: (w: string, p: string, repoId: string) =>
      post<{ fetched: number; ingested: number }>(`${pp(w, p)}/repos/${repoId}/backfill`),
    // `auto`: solo repos vencidos y solo sus commits nuevos (al abrir la vista).
    syncAll: (w: string, p: string, mode: "full" | "auto" = "full") =>
      post<SyncResult>(`${pp(w, p)}/repos/sync${mode === "auto" ? "?mode=auto" : ""}`),
  },
  commits: {
    list: (
      w: string,
      p: string,
      q?: { domain?: string; contributorId?: string; limit?: number; since?: string }
    ) => get<{ commits: Commit[] }>(`${pp(w, p)}/commits${qs(q)}`),
  },
  stats: {
    get: (w: string, p: string) => get<{ stats: Stats }>(`${pp(w, p)}/stats`),
  },

  leaderboard: {
    get: (w: string, p: string) => get<{ leaderboard: LeaderboardEntry[] }>(`${pp(w, p)}/leaderboard`),
  },

  search: {
    query: (w: string, p: string, q: { q: string; limit?: number }) =>
      get<{ query: string; types: string[]; hits: SearchHit[] }>(`${pp(w, p)}/search${qs(q)}`),
  },

  // ─── F3: objetivo / informes / notas ───────────────────────────────
  objective: {
    get: (w: string, p: string) => get<{ objective: Objective | null }>(`${pp(w, p)}/objective`),
    set: (w: string, p: string, description: string) =>
      put<{ objective: Objective }>(`${pp(w, p)}/objective`, { description }),
  },
  reports: {
    list: (w: string, p: string) => get<{ reports: Report[] }>(`${pp(w, p)}/reports`),
    get: (w: string, p: string, id: string) =>
      get<{ report: Report & { notes: Note[] } }>(`${pp(w, p)}/reports/${id}`),
    publish: (w: string, p: string, input: Partial<Report> & { date?: string; scope?: string }) =>
      post<{ report: Report }>(`${pp(w, p)}/reports`, input),
    remove: (w: string, p: string, id: string) => del<{ ok: true }>(`${pp(w, p)}/reports/${id}`),
  },
  notes: {
    list: (w: string, p: string, q?: { status?: string }) =>
      get<{ notes: Note[] }>(`${pp(w, p)}/notes${qs(q)}`),
    create: (w: string, p: string, message: string) =>
      post<{ note: Note }>(`${pp(w, p)}/notes`, { message }),
    answer: (w: string, p: string, id: string, response: string) =>
      post<{ note: Note }>(`${pp(w, p)}/notes/${id}/answer`, { response }),
  },

  // ─── F5: historias de usuario ──────────────────────────────────────
  epics: {
    list: (w: string, p: string) => get<{ epics: Epic[] }>(`${pp(w, p)}/epics`),
    create: (w: string, p: string, input: { title: string; description?: string }) =>
      post<{ epic: Epic }>(`${pp(w, p)}/epics`, input),
  },
  stories: {
    list: (w: string, p: string, q?: { status?: string }) =>
      get<{ userStories: UserStory[] }>(`${pp(w, p)}/user-stories${qs(q)}`),
    create: (w: string, p: string, input: Partial<UserStory> & { title: string }) =>
      post<{ userStory: UserStory }>(`${pp(w, p)}/user-stories`, input),
    update: (w: string, p: string, id: string, patchBody: Partial<UserStory>) =>
      patch<{ userStory: UserStory }>(`${pp(w, p)}/user-stories/${id}`, patchBody),
    // `keepCard` conserva la tarjeta del Kanban desvinculada; por defecto se
    // borra junto con la HU para no dejar tarjetas huérfanas (PEM-19).
    remove: (w: string, p: string, id: string, keepCard = false) =>
      del<{ ok: true; cardDeleted: boolean }>(
        `${pp(w, p)}/user-stories/${id}${keepCard ? "?keepCard=1" : ""}`
      ),
  },
  contributors: {
    list: (w: string, p: string) => get<{ contributors: Contributor[] }>(`${pp(w, p)}/contributors`),
  },

  // ─── F4: agentes / API keys / audit ────────────────────────────────
  agents: {
    list: (w: string, p: string) => get<{ agents: Agent[] }>(`${pp(w, p)}/agents`),
    listWorkspace: (w: string) =>
      get<{ agents: WorkspaceAgent[] }>(`/api/workspaces/${w}/agents`),
    create: (w: string, p: string, name: string) =>
      post<{ agent: Agent }>(`${pp(w, p)}/agents`, { name }),
    remove: (w: string, agentId: string) =>
      del<{ ok: true }>(`/api/workspaces/${w}/agents/${agentId}`),
    // Sobre presencias, no sobre agentes: la key es de otro workspace y desde
    // aquí solo se le corta (o se le devuelve) el paso.
    blockPresence: (w: string, presenceId: string) =>
      post<{ presence: AgentPresence }>(
        `/api/workspaces/${w}/agents/presence/${presenceId}/block`,
        {}
      ),
    unblockPresence: (w: string, presenceId: string) =>
      post<{ presence: AgentPresence }>(
        `/api/workspaces/${w}/agents/presence/${presenceId}/unblock`,
        {}
      ),
  },
  apiKeys: {
    list: (w: string) => get<{ apiKeys: ApiKeyPublic[] }>(`/api/workspaces/${w}/api-keys`),
    create: (
      w: string,
      input: {
        name: string;
        scopeLevel?: "project" | "workspace" | "user";
        projectId?: string;
        agentId?: string;
        scopes: string[];
      }
    ) => post<{ apiKey: ApiKeyPublic; key: string }>(`/api/workspaces/${w}/api-keys`, input),
    revoke: (w: string, id: string) => del<{ ok: true }>(`/api/workspaces/${w}/api-keys/${id}`),
  },
  audit: {
    list: (w: string) => get<{ auditLogs: AuditLog[] }>(`/api/workspaces/${w}/audit`),
    listForProject: (w: string, p: string) =>
      get<{ auditLogs: AuditLog[] }>(`${pp(w, p)}/audit`),
  },

  channels: {
    telegramStatus: () => get<{ channel: TelegramChannelStatus }>("/api/me/channels/telegram"),
    createLinkToken: (projectId?: string) =>
      post<{ token: string; expiresAt: string; deepLink: string | null; startPayload: string }>(
        "/api/me/channels/telegram/link-token",
        { projectId }
      ),
    setLlmKey: (
      apiKey: string,
      opts?: { provider?: "anthropic" | "openai" | "deepseek"; model?: string }
    ) =>
      put<{ channel: TelegramChannelStatus }>("/api/me/channels/telegram/llm-key", {
        apiKey,
        provider: opts?.provider,
        model: opts?.model,
      }),
    deleteLlmKey: (provider: "anthropic" | "openai" | "deepseek") =>
      del<{ channel: TelegramChannelStatus }>(
        `/api/me/channels/telegram/llm-key/${provider}`
      ),
    setDefaultProject: (projectId: string | null) =>
      put<{ channel: TelegramChannelStatus }>("/api/me/channels/telegram/default-project", {
        projectId,
      }),
    disconnect: () => post<{ ok: true }>("/api/me/channels/telegram/disconnect"),
  },

  // ─── F6: kanban ────────────────────────────────────────────────────
  board: {
    get: (w: string, p: string) => get<{ board: Board }>(`${pp(w, p)}/board`),
    createCard: (
      w: string,
      p: string,
      input: {
        title: string;
        type?: string;
        description?: string;
        columnId?: string;
        userStoryId?: string;
        assigneeId?: string;
      }
    ) => post<{ card: Card }>(`${pp(w, p)}/board/cards`, input),
    moveCard: (w: string, p: string, id: string, columnId: string, order?: number) =>
      post<{ card: Card }>(`${pp(w, p)}/board/cards/${id}/move`, { columnId, order }),
    updateCard: (
      w: string,
      p: string,
      id: string,
      patchBody: {
        title?: string;
        description?: string | null;
        type?: string;
        assigneeId?: string | null;
        userStoryId?: string | null;
        labels?: unknown;
      }
    ) => patch<{ card: Card }>(`${pp(w, p)}/board/cards/${id}`, patchBody),
    removeCard: (w: string, p: string, id: string) =>
      del<{ ok: true }>(`${pp(w, p)}/board/cards/${id}`),
    activities: (w: string, p: string, id: string) =>
      get<{ activities: CardActivity[] }>(`${pp(w, p)}/board/cards/${id}/activities`),
  },

  invitations: {
    detail: (token: string) =>
      get<{ invitation: InvitationDetail }>(`/api/invitations/${token}`),
    accept: (token: string) =>
      post<{ workspace: Workspace }>(`/api/invitations/${token}/accept`),
  },
};
