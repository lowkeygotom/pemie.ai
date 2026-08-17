// Fuente de verdad de los literales propios del bot de Telegram (services/telegram-bot.ts).
// Texto copiado tal cual de cada literal existente (cero re-redacción); `en.ts`
// se tipa contra este archivo para que el compilador exija paridad.

export interface TelegramCopyParams {
  historyKeep?: number;
  telegramUsername?: string;
  provider?: string;
  keys?: string;
  model?: string;
  models?: string;
  project?: string;
  ready?: string;
  mark?: string;
  last4?: string;
  lines?: string;
  slug?: string;
  id?: string;
  projects?: string;
  message?: string;
}

export const es = {
  private_chat_only: "El bot de Pemie solo responde en chat privado.",
  rate_limited: "Demasiados mensajes. Espera un minuto.",

  start_missing_token:
    "Para vincular Pemie, abre el enlace desde la pestaña Agente en la web, o pega /start <token>.",
  start_linked:
    "Cuenta vinculada. Configura tu API key LLM en Pemie (Agente → Telegram) y usa /estado para comprobar.",
  start_link_failed: "No se pudo vincular",

  help: (p?: TelegramCopyParams) => `Comandos Pemie:
/start <token> — vincular tu cuenta (desde la web)
/ayuda — esta ayuda
/estado — vínculo, LLM, modelo y proyecto
/proyecto <slug> — fija el proyecto por defecto
/modelo — ver modelos del proveedor activo
/modelo <id> — cambiar modelo
/proveedor — ver proveedores con key guardada
/proveedor <nombre> — activar anthropic|openai|deepseek
/reset — limpia el historial del chat (también /nueva)
/desvincular — corta el vínculo con Telegram

Escribe en lenguaje natural para consultar o actuar en tus proyectos (vía MCP).
Recuerdo los últimos ${p?.historyKeep} mensajes y un resumen corto de lo anterior.`,

  not_linked: "No estás vinculado. Genera un enlace en Pemie → Agente → Telegram.",
  disconnected: "Desvinculado. Ya no responderé hasta que vuelvas a conectar.",
  reset_done: "Historial y resumen borrados. Empezamos de cero.",

  status_linked: (p?: TelegramCopyParams) => `Vinculado: sí (@${p?.telegramUsername ?? "—"})`,
  status_provider_active: (p?: TelegramCopyParams) => `Proveedor activo: ${p?.provider}`,
  status_keys_saved: (p?: TelegramCopyParams) => `Keys guardadas: ${p?.keys}`,
  status_keys_none: "ninguna",
  status_model: (p?: TelegramCopyParams) => `Modelo: ${p?.model}`,
  status_default_project: (p?: TelegramCopyParams) => `Proyecto por defecto: ${p?.project}`,
  status_project_none: "ninguno",
  status_ready: (p?: TelegramCopyParams) => `Listo: ${p?.ready}`,
  status_ready_yes: "sí",
  status_ready_no: "no",

  model_list_provider: (p?: TelegramCopyParams) => `Proveedor: ${p?.provider}`,
  model_list_current: (p?: TelegramCopyParams) => `Actual: ${p?.model}`,
  model_list_available: (p?: TelegramCopyParams) => `Disponibles:\n${p?.models}`,
  model_list_hint: "Cambia con: /modelo <id>",
  model_set: (p?: TelegramCopyParams) => `Modelo activo: ${p?.model}`,
  model_set_failed: "No se pudo cambiar el modelo",

  provider_list_header: (p?: TelegramCopyParams) => `Proveedores:\n${p?.lines}`,
  provider_list_hint: "Cambia con: /proveedor anthropic|openai|deepseek",
  provider_line_with_key: (p?: TelegramCopyParams) => `· ${p?.provider}${p?.mark} — key …${p?.last4}`,
  provider_line_without_key: (p?: TelegramCopyParams) =>
    `· ${p?.provider}${p?.mark} — sin key (pégala en la web)`,
  provider_active_mark: " (activo)",
  provider_set: (p?: TelegramCopyParams) => `Proveedor activo: ${p?.provider}\nModelo: ${p?.model}`,
  provider_set_failed: "No se pudo cambiar el proveedor",

  project_usage: "Uso: /proyecto <slug>",
  project_not_found: (p?: TelegramCopyParams) => `No encontré "${p?.slug}". Proyectos: ${p?.projects}`,
  project_none: "(ninguno)",
  project_set: (p?: TelegramCopyParams) => `Proyecto por defecto: ${p?.slug} (${p?.id})`,

  llm_key_missing: "Falta tu API key LLM. Pégala en Pemie → Agente → Canal Telegram.",
  empty_reply: "(sin respuesta)",
  turn_done: "Listo.",
  turn_error: (p?: TelegramCopyParams) => `Error: ${p?.message}`,
  turn_error_fallback: "Error en el turno",

  budget_reached: "La consulta tardó demasiado y corté el turno. Prueba con algo más específico.",
  tool_limit_reached: "Se alcanzó el límite de herramientas en este turno. Reformula la pregunta.",
  truncated: "La respuesta se cortó por longitud. Pide algo más acotado.",

  provider_timeout_turn: (p?: TelegramCopyParams) => `${p?.provider}: se agotó el tiempo del turno`,
  provider_no_response: (p?: TelegramCopyParams) => `${p?.provider} no respondió a tiempo`,
  provider_empty_response: (p?: TelegramCopyParams) => `${p?.provider}: respuesta vacía`,
};
