// Tipos y constantes compartidos entre el backend (apps/api) y el frontend (apps/web).
// Mantener agnóstico de runtime: sin imports de Node ni del navegador.

export * from "./analytics.js";
export * from "./mcp-tools.js";
export * from "./skills.js";

export type Role = "owner" | "admin" | "member" | "viewer";

export type ReportScope = "day" | "general";

/**
 * Métricas deterministas de un informe de día: commits ingestados + actividad
 * de tablero (movimientos genéricos y cambios de estado de HU). Las calcula
 * el servidor en `computeDayMetrics`; el cliente solo las renderiza.
 */
export interface DayMetrics {
  commits: number;
  contributors: number;
  byDomain: Record<string, number>;
  /** Movimientos de tarjeta sin HU vinculada. */
  cardMoves: number;
  /** Cambios de columna de tarjetas con HU (= cambio de estado de la HU). */
  storyStatusChanges: number;
}

export type NoteStatus = "pending" | "processed";

export type CardType = "story" | "task" | "bug";

export type ActorType = "user" | "agent";

export type UserStoryStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "review"
  | "done";

/**
 * Columna del tablero Kanban (por su `order`) que corresponde a cada estado de HU.
 * Espejo exacto de DEFAULT_COLUMNS en apps/api/src/services/board.ts: las columnas
 * no son editables, así que el mapeo puede ser estático — pero ambos lados deben
 * cambiar juntos si algún día se agrega o reordena un estado.
 */
export const STATUS_COLUMN_ORDER: Record<UserStoryStatus, number> = {
  backlog: 0,
  ready: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

/** Estado de HU que implica un `order` de columna, o null si ninguno lo usa. */
export function statusForColumnOrder(order: number): UserStoryStatus | null {
  const entry = (Object.entries(STATUS_COLUMN_ORDER) as [UserStoryStatus, number][]).find(
    ([, columnOrder]) => columnOrder === order
  );
  return entry ? entry[0] : null;
}

export type StoryProgressGroup = "not_started" | "in_flight" | "closed";

/** Grupo de avance por estado. Record total: sumar un UserStoryStatus obliga a clasificarlo. */
export const STATUS_PROGRESS_GROUP: Record<UserStoryStatus, StoryProgressGroup> = {
  backlog: "not_started",
  ready: "not_started",
  in_progress: "in_flight",
  review: "in_flight",
  done: "closed",
};

/**
 * Solo se alerta lo que tiene una acción detrás. Una HU cerrada sin commits que
 * la referencien NO es una alerta: hay HUs que se cierran legítimamente sin
 * código (investigación, spike, decisión de producto), y pedirle a alguien que
 * descarte esa alerta una por una convierte la herramienta en burocracia. Ese
 * dato vive como cobertura agregada (PEM-46), que se lee sin exigir nada.
 */
export const DRIFT_ALERT_TYPES = ["unreported_work", "stalled_wip"] as const;
export type DriftAlertType = (typeof DRIFT_ALERT_TYPES)[number];

/** Evidencia distinta por tipo: el discriminante evita campos opcionales que mienten. */
export type DriftEvidence<TDate = string> =
  | { type: "unreported_work"; commitCount: number; lastCommitAt: TDate }
  | {
      type: "stalled_wip";
      /** Último commit posterior a `inFlightSince`: el avance de ESTE ciclo, no de uno anterior. */
      lastCommitAt: TDate | null;
      inFlightSince: TDate | null;
      daysSince: number;
    };

export interface DriftAlert<TDate = string> {
  story: { id: string; key: string; title: string; status: UserStoryStatus };
  evidence: DriftEvidence<TDate>;
}

export interface DriftReport<TDate = string> {
  correlationAvailable: boolean;
  staleDaysThreshold: number;
  /**
   * Proporción de commits del proyecto que referencian alguna HU (PEM-51).
   * Guardia distinta de `correlationAvailable`: esa cubre adopción CERO
   * (ningún commit tagea nada); esta cubre adopción PARCIAL. Cuando
   * `correlationAvailable` es false, viaja en 0 — valor válido pero que
   * nunca se lee de forma aislada, la UI prioriza ese otro guard primero.
   */
  correlationCoverage: number;
  coverageThreshold: number;
  /** correlationCoverage < coverageThreshold: por debajo, se suprimen las alertas stalled_wip. */
  coverageBelowThreshold: boolean;
  /** Ordenadas por el servicio: unreported_work → stalled_wip, y por fecha desc dentro de cada tipo. */
  alerts: DriftAlert<TDate>[];
  countsByType: Record<DriftAlertType, number>;
}

/**
 * Indicador de "agentes fluidos" (PEM-48): qué proporción de movimientos y
 * asignaciones de agente quedan en pie, contando corrección solo cuando un
 * humano deshace el cambio concreto (fromValue/toValue), no cuando sigue
 * trabajando encima.
 */
export interface AgentReliabilityReport {
  windowDays: number;
  settleHours: number;
  agentActions: number;
  revertedActions: number;
  /** null cuando agentActions === 0: sin acciones no hay tasa, y 0 ó 100 mentirían. */
  survivalRate: number | null;
  byAction: Record<"moved" | "assigned", { actions: number; reverted: number }>;
}

/** Columna del Kanban con su carga actual (WIP del overview). */
export interface WipColumn {
  name: string;
  order: number;
  cardCount: number;
}

/** Scopes de API key para agentes (MCP + REST de agente). */
export const API_SCOPES = [
  "commits:read",
  "reports:read",
  "reports:write",
  "notes:read",
  "notes:write",
  "stories:read",
  "stories:write",
  "board:read",
  "board:write",
  "objective:read",
  "objective:write",
  "skills:read",
  "skills:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Alcance de una API key MCP. */
export const API_KEY_SCOPE_LEVELS = ["project", "workspace", "user"] as const;
export type ApiKeyScopeLevel = (typeof API_KEY_SCOPE_LEVELS)[number];

// ─── Roster de agentes de un workspace ────────────────────────────────

/** Proyecto referenciado desde el roster (lo mínimo para etiquetar una fila). */
export interface AgentRosterProject {
  id: string;
  name: string;
  slug: string;
  key: string;
}

/**
 * Persona detrás de un agente o de una key. Que exista no implica que siga en
 * el equipo: eso se resuelve contra las membresías, no contra este campo.
 */
export interface AgentRosterOwner {
  id: string;
  name: string | null;
  email: string;
}

/** Agente con fila propia en un proyecto del workspace. */
export interface RegisteredAgent<TDate = string> {
  source: "registered";
  id: string;
  name: string;
  kind: string;
  projectId: string;
  project: AgentRosterProject;
  owner: AgentRosterOwner | null;
  createdAt: TDate;
  _count: { apiKeys: number };
}

/**
 * API key de alcance amplio vista operando en el workspace. No hay `Agent`
 * detrás —las keys workspace/user no lo llevan—, así que la identidad que se
 * muestra es la de la key y su dueño.
 */
export interface ObservedAgent<TDate = string> {
  source: "observed";
  /** Id de la presencia, no de la key: es lo que se bloquea o desbloquea. */
  id: string;
  apiKeyId: string;
  name: string;
  scopeLevel: ApiKeyScopeLevel;
  owner: AgentRosterOwner | null;
  lastProject: AgentRosterProject | null;
  firstSeenAt: TDate;
  lastSeenAt: TDate;
  blockedAt: TDate | null;
}

/**
 * Ítem del roster de Equipo. `TDate` existe porque el backend maneja `Date` y
 * el cliente recibe el ISO string del JSON: mismo contrato, dos representaciones.
 */
export type WorkspaceAgentRosterItem<TDate = string> =
  | RegisteredAgent<TDate>
  | ObservedAgent<TDate>;

/** Proveedores LLM BYOK para el canal Telegram. */
export const CHANNEL_LLM_PROVIDERS = ["anthropic", "openai", "deepseek"] as const;
export type ChannelLlmProvider = (typeof CHANNEL_LLM_PROVIDERS)[number];

export const CHANNEL_LLM_DEFAULT_MODELS: Record<ChannelLlmProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
};

/** Modelos seleccionables por proveedor (Telegram + UI). */
export const CHANNEL_LLM_MODELS: Record<ChannelLlmProvider, readonly string[]> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

export function listModelsForProvider(provider: ChannelLlmProvider): readonly string[] {
  return CHANNEL_LLM_MODELS[provider] ?? [CHANNEL_LLM_DEFAULT_MODELS[provider]];
}

export function isAllowedModel(provider: ChannelLlmProvider, model: string): boolean {
  return listModelsForProvider(provider).includes(model);
}

/**
 * Configuración de categorías/"dominios" por proyecto. Reemplaza el
 * hardcode tofu/pipeline/reuniones del gotom-reports original: cada
 * proyecto define sus propias categorías y las reglas para clasificarlas.
 */
export interface DomainCategory {
  key: string;
  label: string;
  emoji?: string;
  /** Patrones (regex string) que, si matchean el mensaje del commit, asignan esta categoría. */
  matchers?: string[];
  /** Si es la categoría que cuenta como "avance hacia la meta". */
  primary?: boolean;
}

export interface DomainConfig {
  categories: DomainCategory[];
  /** Categoría por defecto cuando ninguna matchea. */
  fallback: string;
}

/** Config de dominios por defecto (genérica, editable por proyecto). */
export const DEFAULT_DOMAIN_CONFIG: DomainConfig = {
  categories: [
    { key: "feature", label: "Feature", emoji: "✨", primary: true, matchers: ["^feat", "feature"] },
    { key: "fix", label: "Fix", emoji: "🐛", matchers: ["^fix", "bug"] },
    { key: "infra", label: "Infra", emoji: "🏗️", matchers: ["^chore", "^ci", "^build", "deploy", "infra"] },
    { key: "docs", label: "Docs", emoji: "📝", matchers: ["^docs"] },
    { key: "refactor", label: "Refactor", emoji: "♻️", matchers: ["^refactor", "^style", "^perf"] },
  ],
  fallback: "otro",
};

/**
 * Clasifica el mensaje de un commit en una categoría de dominio.
 *
 * Función pura y agnóstica de runtime (usada por la ingesta del backend y por
 * el frontend para previsualizar). Toma la primera línea del mensaje y devuelve
 * la `key` de la primera categoría cuyo matcher (regex, case-insensitive)
 * coincida; si ninguna coincide, devuelve `config.fallback`.
 */
export function classifyCommit(
  message: string,
  config: DomainConfig = DEFAULT_DOMAIN_CONFIG
): string {
  const subject = (message ?? "").split("\n")[0]!.trim();
  for (const category of config.categories) {
    for (const matcher of category.matchers ?? []) {
      let re: RegExp;
      try {
        re = new RegExp(matcher, "i");
      } catch {
        continue; // matcher inválido: se ignora en vez de romper la ingesta
      }
      if (re.test(subject)) return category.key;
    }
  }
  return config.fallback;
}

/**
 * ¿La URL sirve como destino de un enlace?
 *
 * Sólo `http:` y `https:`. Tanto `new URL()` como el `.url()` de Zod aceptan
 * cualquier esquema —`javascript:` incluido—, así que comprobar "es una URL" no
 * alcanza para un valor que después acaba en un `href`. La comprobación se
 * comparte entre api y web para que lo que se guarda y lo que se pinta digan lo
 * mismo, en vez de depender de que ambos lados se acuerden por separado.
 */
export function isSafeHttpUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const { protocol } = new URL(raw.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Narrativa canónica de una Historia de Usuario. */
export interface UserStoryNarrative {
  role: string; // Como <role>
  want: string; // quiero <want>
  benefit: string; // para <benefit>
}

/** Criterio de aceptación estilo Gherkin/Given-When-Then. */
export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

/**
 * Formatea la narrativa de una HU como una sola frase legible ("Como <rol>,
 * quiero <want> para <benefit>"). Devuelve `null` si falta la narrativa o
 * alguno de sus tres campos, para que el caller pueda omitir el bloque en vez
 * de mostrar una frase a medias.
 */
export function formatNarrative(narrative: UserStoryNarrative | null | undefined): string | null {
  if (!narrative?.role || !narrative?.want || !narrative?.benefit) return null;
  return `Como ${narrative.role}, quiero ${narrative.want} para ${narrative.benefit}`;
}
