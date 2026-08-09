// Catálogo canónico de analítica de producto (PEM-8). Fuente única de verdad
// para nombres de evento + propiedades permitidas — agnóstico de runtime
// (cero import de posthog-js/posthog-node), mismo patrón que API_SCOPES en
// packages/shared/src/index.ts. Los wrappers de runtime (apps/web/src/lib/analytics,
// apps/api/src/services/analytics.ts) importan de aquí y nunca declaran eventos
// por su cuenta. Ver PLANS/PEMIE_POSTHOG_UX_CONSENT_EVENT_MAP.md.
//
// Convención: snake_case, `area_objeto_accion` en pasado; sufijo `_failed` para
// el mismo intento cuando falla. Loading no se trackea (es UX, no analítica).
// Ninguna propiedad puede contener contenido de negocio, prompts, tokens ni
// valores de API keys — solo IDs/enums/metadata de bajo cardinal.
export const ANALYTICS_EVENTS = {
  // ─── Auth ────────────────────────────────────────────────────────────
  user_signed_up: [],
  user_signed_up_failed: ["reason"],
  user_logged_in: [],
  user_logged_in_failed: ["reason"],
  invite_accepted: [],
  invite_accepted_failed: ["reason"],
  user_logged_out: [],

  // ─── Workspace ───────────────────────────────────────────────────────
  workspace_created: [],
  workspace_created_failed: ["reason"],
  workspace_updated: [],
  workspace_deleted: [],
  // Nunca el email completo: si hace falta segmentar, dominio del correo.
  workspace_member_invited: ["role", "email_domain"],
  workspace_member_invited_failed: ["reason"],
  workspace_invite_revoked: [],

  // ─── Proyecto ────────────────────────────────────────────────────────
  project_created: [],
  project_created_failed: ["reason"],

  // ─── Historias de usuario ────────────────────────────────────────────
  story_created: [],
  story_created_failed: ["reason"],
  // Nunca el texto de la HU, solo el tránsito de estado.
  story_status_changed: ["from_status", "to_status"],
  story_updated: [],
  story_update_failed: ["reason"],
  // `card_deleted` mide si el equipo acepta el default de arrastrar la tarjeta
  // con la HU o lo desmarca: es lo que valida la decisión de PEM-19.
  story_deleted: ["card_deleted"],
  story_delete_failed: ["reason"],

  // ─── Tablero (Kanban) ────────────────────────────────────────────────
  board_card_created: ["card_type"],
  board_card_created_failed: ["reason"],
  // Disparado solo en el drop final, nunca durante el arrastre.
  board_card_moved: ["from_column", "to_column"],
  // `had_story` distingue limpiar una tarjeta suelta de romper el vínculo con
  // una HU viva, que es el caso que puede sorprender.
  board_card_deleted: ["had_story"],
  board_card_deleted_failed: ["reason"],

  // ─── Commits ─────────────────────────────────────────────────────────
  // Solo la interacción de filtrar, nunca cada fetch de commits.
  commits_filter_applied: ["filter_type"],
  commits_filter_cleared: [],

  // ─── Búsqueda ────────────────────────────────────────────────────────
  project_search_used: ["result_type"],
  project_search_failed: ["reason"],

  // ─── Informes ────────────────────────────────────────────────────────
  report_objective_set: [],
  report_objective_set_failed: ["reason"],
  // Nunca el contenido de la nota.
  report_note_created: [],
  report_note_created_failed: ["reason"],
  report_note_answered: [],
  report_note_answered_failed: ["reason"],

  // ─── Agentes / API keys ──────────────────────────────────────────────
  agent_registered: [],
  agent_registered_failed: ["reason"],
  agent_deleted: [],
  agent_deleted_failed: ["reason"],
  // Bloqueo de una key ajena vista operando en el workspace. `scope_level` es
  // metadata del alcance de la key, nunca su valor ni su dueño.
  agent_presence_blocked: ["scope_level"],
  agent_presence_blocked_failed: ["reason"],
  agent_presence_unblocked: ["scope_level"],
  agent_presence_unblocked_failed: ["reason"],
  // Nunca el valor de la key, solo metadata.
  api_key_created: ["scope_level"],
  api_key_created_failed: ["reason"],
  api_key_revoked: [],

  // ─── Telegram (server-side, apps/api/src/services/analytics.ts) ──────
  telegram_link_started: [],
  telegram_link_started_failed: ["reason"],
  // El link se completa fuera de la SPA; se detecta al procesar /start en el bot.
  telegram_linked: [],
  // provider/model son metadata, no secretos: nunca el valor de la key.
  telegram_llm_key_set: ["provider", "model"],
  telegram_llm_key_set_failed: ["reason"],
  telegram_default_project_set: [],
  telegram_disconnected: [],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

/** Nombre de propiedad declarado para un evento dado. */
export type AnalyticsEventProperty<E extends AnalyticsEvent> =
  (typeof ANALYTICS_EVENTS)[E][number];

/** Valor de propiedad de evento: primitivas simples, nunca objetos/arrays anidados. */
export type AnalyticsPropertyValue = string | number | boolean | null;

export type AnalyticsEventProperties<E extends AnalyticsEvent> = Partial<
  Record<AnalyticsEventProperty<E>, AnalyticsPropertyValue>
>;

/** Guardrail mecánico (cliente y servidor): límite de longitud por valor string. */
export const ANALYTICS_STRING_PROPERTY_MAX = 200;

export function isDeclaredAnalyticsProperty(event: AnalyticsEvent, key: string): boolean {
  return (ANALYTICS_EVENTS[event] as readonly string[]).includes(key);
}

export class UndeclaredAnalyticsPropertyError extends Error {
  constructor(event: string, key: string) {
    super(`Propiedad de analítica no declarada en el catálogo: "${event}.${key}"`);
    this.name = "UndeclaredAnalyticsPropertyError";
  }
}

export interface SanitizeAnalyticsPropertiesOptions {
  /** true en dev: lanza ante una propiedad inválida en vez de descartarla/truncarla en silencio. */
  strict: boolean;
}

/**
 * Guardrail mecánico compartido por los wrappers de cliente (apps/web) y
 * servidor (apps/api): valida cada propiedad contra el catálogo declarado
 * para `event`. En modo estricto (dev) lanza ante una propiedad no declarada
 * o un string >200 chars — así un evento mal instrumentado falla rápido en
 * desarrollo. En modo no estricto (prod) descarta la propiedad no declarada y
 * trunca el string: nunca bloquea el evento en producción por un error de
 * instrumentación, pero tampoco deja pasar contenido de negocio sin querer.
 */
export function sanitizeAnalyticsProperties<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEventProperties<E> | undefined,
  options: SanitizeAnalyticsPropertiesOptions
): Record<string, AnalyticsPropertyValue> {
  const out: Record<string, AnalyticsPropertyValue> = {};
  if (!properties) return out;
  const entries = Object.entries(properties) as [string, AnalyticsPropertyValue | undefined][];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (!isDeclaredAnalyticsProperty(event, key)) {
      if (options.strict) throw new UndeclaredAnalyticsPropertyError(event, key);
      continue;
    }
    if (typeof value === "string" && value.length > ANALYTICS_STRING_PROPERTY_MAX) {
      if (options.strict) {
        throw new Error(
          `Propiedad de analítica demasiado larga: "${event}.${key}" (${value.length} > ${ANALYTICS_STRING_PROPERTY_MAX} chars)`
        );
      }
      out[key] = value.slice(0, ANALYTICS_STRING_PROPERTY_MAX);
      continue;
    }
    out[key] = value;
  }
  return out;
}
