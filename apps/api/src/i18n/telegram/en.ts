// Tipado contra `es`: el compilador exige que todas sus claves tengan traducción.

import type { TelegramCopyParams } from "./es.js";
import { es } from "./es.js";

export const en: Record<keyof typeof es, string | ((params?: TelegramCopyParams) => string)> = {
  private_chat_only: "The Pemie bot only replies in private chat.",
  rate_limited: "Too many messages. Wait a minute.",

  start_missing_token:
    "To link Pemie, open the link from the Agent tab on the web, or paste /start <token>.",
  start_linked:
    "Account linked. Set your LLM API key in Pemie (Agent → Telegram) and use /status to check.",
  start_link_failed: "Could not link the account",

  help: (p?: TelegramCopyParams) => `Pemie commands:
/start <token> — link your account (from the web)
/help — this help
/status — link, LLM, model and project status
/project <slug> — set the default project
/model — see models for the active provider
/model <id> — change model
/provider — see providers with a saved key
/provider <name> — activate anthropic|openai|deepseek
/reset — clear the chat history (also /new)
/unlink — unlink Telegram

Write in natural language to query or act on your projects (via MCP).
I remember the last ${p?.historyKeep} messages and a short summary of what came before.`,

  not_linked: "You're not linked. Generate a link in Pemie → Agent → Telegram.",
  disconnected: "Unlinked. I won't reply again until you reconnect.",
  reset_done: "History and summary cleared. Starting fresh.",

  status_linked: (p?: TelegramCopyParams) => `Linked: yes (@${p?.telegramUsername ?? "—"})`,
  status_provider_active: (p?: TelegramCopyParams) => `Active provider: ${p?.provider}`,
  status_keys_saved: (p?: TelegramCopyParams) => `Saved keys: ${p?.keys}`,
  status_keys_none: "none",
  status_model: (p?: TelegramCopyParams) => `Model: ${p?.model}`,
  status_default_project: (p?: TelegramCopyParams) => `Default project: ${p?.project}`,
  status_project_none: "none",
  status_ready: (p?: TelegramCopyParams) => `Ready: ${p?.ready}`,
  status_ready_yes: "yes",
  status_ready_no: "no",

  model_list_provider: (p?: TelegramCopyParams) => `Provider: ${p?.provider}`,
  model_list_current: (p?: TelegramCopyParams) => `Current: ${p?.model}`,
  model_list_available: (p?: TelegramCopyParams) => `Available:\n${p?.models}`,
  model_list_hint: "Change with: /model <id>",
  model_set: (p?: TelegramCopyParams) => `Active model: ${p?.model}`,
  model_set_failed: "Could not change the model",

  provider_list_header: (p?: TelegramCopyParams) => `Providers:\n${p?.lines}`,
  provider_list_hint: "Change with: /provider anthropic|openai|deepseek",
  provider_line_with_key: (p?: TelegramCopyParams) => `· ${p?.provider}${p?.mark} — key …${p?.last4}`,
  provider_line_without_key: (p?: TelegramCopyParams) =>
    `· ${p?.provider}${p?.mark} — no key (paste it on the web)`,
  provider_active_mark: " (active)",
  provider_set: (p?: TelegramCopyParams) => `Active provider: ${p?.provider}\nModel: ${p?.model}`,
  provider_set_failed: "Could not change the provider",

  project_usage: "Usage: /project <slug>",
  project_not_found: (p?: TelegramCopyParams) => `Couldn't find "${p?.slug}". Projects: ${p?.projects}`,
  project_none: "(none)",
  project_set: (p?: TelegramCopyParams) => `Default project: ${p?.slug} (${p?.id})`,

  llm_key_missing: "Your LLM API key is missing. Paste it in Pemie → Agent → Telegram channel.",
  empty_reply: "(no reply)",
  turn_done: "Done.",
  turn_error: (p?: TelegramCopyParams) => `Error: ${p?.message}`,
  turn_error_fallback: "Error during the turn",

  budget_reached: "The request took too long and I cut the turn short. Try something more specific.",
  tool_limit_reached: "Reached the tool limit for this turn. Rephrase the question.",
  truncated: "The reply was cut short due to length. Ask something more focused.",

  provider_timeout_turn: (p?: TelegramCopyParams) => `${p?.provider}: ran out of time for the turn`,
  provider_no_response: (p?: TelegramCopyParams) => `${p?.provider} did not respond in time`,
  provider_empty_response: (p?: TelegramCopyParams) => `${p?.provider}: empty response`,
};
