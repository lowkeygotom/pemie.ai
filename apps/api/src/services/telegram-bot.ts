// Runtime del bot Telegram: webhook → comandos o turno LLM BYOK + tools MCP.
// Proveedores: anthropic | openai | deepseek (OpenAI-compatible).

import {
  CHANNEL_LLM_DEFAULT_MODELS,
  CHANNEL_LLM_PROVIDERS,
  isAllowedModel,
  type ChannelLlmProvider,
} from "@pemie/shared";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { decryptSecret } from "../lib/secrets.js";
import { invokeMcpTool, listMcpToolDefs } from "../mcp/index.js";
import { ServiceError } from "./errors.js";
import * as channels from "./channels.js";

const MAX_TOOL_ROUNDS = 8;
/**
 * Presupuesto del turno completo. Queda por debajo del `maxDuration` de
 * vercel.json (30s) para cerrar con un mensaje útil en vez de que la plataforma
 * mate la función a mitad y Telegram reintente el update.
 */
const TURN_BUDGET_MS = 22_000;
/** Techo por llamada al proveedor: uno colgado no puede comerse el turno entero. */
const PROVIDER_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 10_000;
/** Techo del resumen de emergencia (sin LLM) que se guarda si el proveedor falla. */
const SUMMARY_FALLBACK_MAX = 1_200;

const BUDGET_REACHED =
  "La consulta tardó demasiado y corté el turno. Prueba con algo más específico.";
const TOOL_LIMIT_REACHED =
  "Se alcanzó el límite de herramientas en este turno. Reformula la pregunta.";
const TRUNCATED =
  "La respuesta se cortó por longitud. Pide algo más acotado.";

const OPENAI_COMPAT_BASE: Record<"openai" | "deepseek", string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
};

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}
interface TgChat {
  id: number;
  type: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  date: number;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

type BotSession = NonNullable<Awaited<ReturnType<typeof channels.loadBotSession>>>;

async function tgSend(chatId: number, text: string) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  for (const part of chunkTelegram(text, 4000)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: part }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) continue;
      // 403 = el usuario bloqueó el bot; 429 = rate limit de Telegram. Sin log
      // no queda rastro de por qué el usuario dejó de recibir respuestas.
      const body = await res.text().catch(() => "");
      console.error(`[telegram] sendMessage ${res.status}: ${body.slice(0, 200)}`);
      return; // cortar: los chunks siguientes van a fallar igual
    } catch (err) {
      console.error("[telegram] sendMessage falló:", err);
      return;
    }
  }
}

function chunkTelegram(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

const HELP = `Comandos Pemie:
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
Recuerdo los últimos ${channels.HISTORY_KEEP} mensajes y un resumen corto de lo anterior.`;

function resolveProvider(raw: string | null | undefined): ChannelLlmProvider {
  if (raw && (CHANNEL_LLM_PROVIDERS as readonly string[]).includes(raw))
    return raw as ChannelLlmProvider;
  return "anthropic";
}

/**
 * Modelo efectivo del turno.
 *
 * El modelo guardado puede sobrevivir al catálogo: cuando el proveedor retira uno,
 * la fila sigue apuntando ahí y toda llamada devolvería 404. Caemos al default del
 * proveedor en vez de dejar al usuario sin bot hasta que corra la migración.
 */
function resolveModel(session: BotSession): string {
  const provider = resolveProvider(session.config.llmProvider);
  return isAllowedModel(provider, session.config.model)
    ? session.config.model
    : CHANNEL_LLM_DEFAULT_MODELS[provider];
}

function systemPrompt(session: BotSession, summary: string | null): string {
  const defaultProjectId = session.config.defaultProjectId;
  const parts = [
    "Eres el asistente Pemie en Telegram. Ayudas a monitorear proyectos (commits, HUs, kanban, informes).",
    "Usa las tools MCP. Con keys de usuario, pasa projectId en cada tool de proyecto.",
    defaultProjectId
      ? `Proyecto por defecto sugerido: ${defaultProjectId} (slug: ${session.config.defaultProject?.slug ?? "?"}). Úsalo si el usuario no especifica otro.`
      : "No hay proyecto por defecto; llama a list_projects si hace falta.",
    "Tienes historial reciente del chat; úsalo para referencias (“eso”, “lo de antes”). Datos de proyecto: re-lee con tools, no inventes.",
    "Responde en español, breve y útil para chat móvil.",
  ];
  if (summary?.trim()) {
    parts.push(`Resumen de conversación anterior (fuera de la ventana reciente):\n${summary.trim()}`);
  }
  return parts.join("\n");
}

async function runMcpToolCall(
  session: BotSession,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const args = { ...input };
  const defaultProjectId = session.config.defaultProjectId;
  if (
    !args.projectId &&
    defaultProjectId &&
    name !== "list_workspaces" &&
    name !== "list_projects"
  ) {
    args.projectId = defaultProjectId;
  }
  try {
    const result = await invokeMcpTool(session.config.apiKey, name, args);
    return JSON.stringify(result).slice(0, 80_000);
  } catch (err) {
    const msg = err instanceof ServiceError ? err.message : err instanceof Error ? err.message : "error";
    return JSON.stringify({ error: msg });
  }
}

/**
 * Procesa un update de Telegram.
 *
 * Idempotente por `update_id`: la reserva en DB (`claimChannelUpdate`) descarta
 * los reintentos del webhook, que si no re-ejecutarían las tools de escritura
 * del turno. Solo marca el update como procesado si el turno terminó.
 */
export async function handleTelegramUpdate(update: TgUpdate): Promise<{ ok: true }> {
  const msg = update.message;
  if (!msg?.from || !msg.text) return { ok: true };

  const telegramUserId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Solo chat privado: las respuestas traen datos de los proyectos del usuario
  // y en un grupo quedarían a la vista de todos sus miembros.
  if (msg.chat.type !== "private") {
    if (text.startsWith("/"))
      await tgSend(chatId, "El bot de Pemie solo responde en chat privado.");
    return { ok: true };
  }

  const updateId = String(update.update_id);
  const claim = await channels.claimChannelUpdate(updateId, telegramUserId);
  if (claim === "duplicate") return { ok: true };
  if (claim === "rate_limited") {
    await tgSend(chatId, "Demasiados mensajes. Espera un minuto.");
    return { ok: true };
  }

  await dispatchMessage({ telegramUserId, chatId, text, username: msg.from.username ?? null });
  await channels.markChannelUpdateProcessed(updateId);
  return { ok: true };
}

interface IncomingMessage {
  telegramUserId: string;
  chatId: number;
  text: string;
  username: string | null;
}

/** Comandos y turno LLM, ya deduplicado y acotado a chat privado. */
async function dispatchMessage({
  telegramUserId,
  chatId,
  text,
  username,
}: IncomingMessage): Promise<void> {
  if (text.startsWith("/start")) {
    const payload = text.replace(/^\/start(@\w+)?\s*/, "").trim();
    if (!payload) {
      await tgSend(
        chatId,
        "Para vincular Pemie, abre el enlace desde la pestaña Agente en la web, o pega /start <token>."
      );
      return;
    }
    try {
      await channels.completeLinkFromToken(payload, telegramUserId, username);
      await tgSend(
        chatId,
        "Cuenta vinculada. Configura tu API key LLM en Pemie (Agente → Telegram) y usa /estado para comprobar."
      );
    } catch (err) {
      const m = err instanceof ServiceError ? err.message : "No se pudo vincular";
      await tgSend(chatId, m);
    }
    return;
  }

  if (text.startsWith("/ayuda") || text.startsWith("/help")) {
    await tgSend(chatId, HELP);
    return;
  }

  const session = await channels.loadBotSession(telegramUserId);
  if (!session) {
    await tgSend(chatId, "No estás vinculado. Genera un enlace en Pemie → Agente → Telegram.");
    return;
  }

  if (text.startsWith("/desvincular")) {
    await channels.disconnectChannel(session.link.userId, session.link.user.analyticsEnabled);
    await tgSend(chatId, "Desvinculado. Ya no responderé hasta que vuelvas a conectar.");
    return;
  }

  if (text.startsWith("/estado")) {
    const st = await channels.getChannelStatus(session.link.userId);
    const keyed = CHANNEL_LLM_PROVIDERS.filter((p) => st.providers[p].hasKey)
      .map((p) => `${p}(…${st.providers[p].last4})`)
      .join(", ");
    await tgSend(
      chatId,
      [
        `Vinculado: sí (@${st.telegramUsername ?? "—"})`,
        `Proveedor activo: ${st.llmProvider}`,
        `Keys guardadas: ${keyed || "ninguna"}`,
        `Modelo: ${st.model}`,
        `Proyecto por defecto: ${st.defaultProject ? `${st.defaultProject.slug} (${st.defaultProject.id})` : "ninguno"}`,
        `Listo: ${st.ready ? "sí" : "no"}`,
      ].join("\n")
    );
    return;
  }

  if (text.startsWith("/reset") || text.startsWith("/nueva")) {
    await channels.clearChannelMessages(session.link.userId);
    await tgSend(chatId, "Historial y resumen borrados. Empezamos de cero.");
    return;
  }

  if (text.startsWith("/modelo")) {
    const arg = text.replace(/^\/modelo(@\w+)?\s*/, "").trim();
    const st = await channels.getChannelStatus(session.link.userId);
    if (!arg) {
      await tgSend(
        chatId,
        [
          `Proveedor: ${st.llmProvider}`,
          `Actual: ${st.model}`,
          `Disponibles:\n${st.models.map((m) => `· ${m}`).join("\n")}`,
          `Cambia con: /modelo <id>`,
        ].join("\n")
      );
      return;
    }
    try {
      await channels.setChannelModel(session.link.userId, arg);
      await tgSend(chatId, `Modelo activo: ${arg}`);
    } catch (err) {
      const m = err instanceof ServiceError ? err.message : "No se pudo cambiar el modelo";
      await tgSend(chatId, m);
    }
    return;
  }

  if (text.startsWith("/proveedor")) {
    const arg = text.replace(/^\/proveedor(@\w+)?\s*/, "").trim().toLowerCase();
    const st = await channels.getChannelStatus(session.link.userId);
    if (!arg) {
      const lines = CHANNEL_LLM_PROVIDERS.map((p) => {
        const info = st.providers[p];
        const mark = p === st.llmProvider ? " (activo)" : "";
        return info.hasKey
          ? `· ${p}${mark} — key …${info.last4}`
          : `· ${p}${mark} — sin key (pégala en la web)`;
      });
      await tgSend(
        chatId,
        [`Proveedores:\n${lines.join("\n")}`, `Cambia con: /proveedor anthropic|openai|deepseek`].join(
          "\n"
        )
      );
      return;
    }
    try {
      const updated = await channels.setChannelProvider(session.link.userId, arg);
      await tgSend(chatId, `Proveedor activo: ${arg}\nModelo: ${updated.model}`);
    } catch (err) {
      const m = err instanceof ServiceError ? err.message : "No se pudo cambiar el proveedor";
      await tgSend(chatId, m);
    }
    return;
  }

  if (text.startsWith("/proyecto")) {
    const slug = text.replace(/^\/proyecto(@\w+)?\s*/, "").trim();
    if (!slug) {
      await tgSend(chatId, "Uso: /proyecto <slug>");
      return;
    }
    const projects = await agentsListProjects(session);
    const match = projects.find((p) => p.slug === slug || p.id === slug);
    if (!match) {
      await tgSend(
        chatId,
        `No encontré "${slug}". Proyectos: ${projects.map((p) => p.slug).join(", ") || "(ninguno)"}`
      );
      return;
    }
    await channels.setDefaultProject(session.link.userId, session.link.user.analyticsEnabled, match.id);
    await tgSend(chatId, `Proyecto por defecto: ${match.slug} (${match.id})`);
    return;
  }

  if (!session.config.llmKeyCiphertext) {
    await tgSend(chatId, "Falta tu API key LLM. Pégala en Pemie → Agente → Canal Telegram.");
    return;
  }

  try {
    const reply = await runLlmTurn(session, text);
    await tgSend(chatId, reply || "(sin respuesta)");
    const pruned = await channels.recordTurnMessages(session.link.userId, text, reply || "");
    if (pruned.length > 0) {
      await refreshRollingSummary(session, pruned).catch(() => {});
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : "Error en el turno";
    await tgSend(chatId, `Error: ${m}`);
  }
}

async function agentsListProjects(session: BotSession) {
  const result = await invokeMcpTool(session.config.apiKey, "list_projects", {});
  return (Array.isArray(result) ? result : []) as Array<{
    id: string;
    name: string;
    slug: string;
    workspaceId: string;
  }>;
}

async function runLlmTurn(session: BotSession, userText: string): Promise<string> {
  const provider = resolveProvider(session.config.llmProvider);
  const deadline = Date.now() + TURN_BUDGET_MS;
  const [history, summary] = await Promise.all([
    channels.listRecentChannelMessages(session.link.userId, channels.HISTORY_KEEP),
    channels.getConversationSummary(session.link.userId),
  ]);
  if (provider === "anthropic")
    return runAnthropicTurn(session, userText, history, summary, deadline);
  return runOpenAiCompatTurn(session, userText, provider, history, summary, deadline);
}

type ChatTurn = { role: string; content: string };

/**
 * Resumen de emergencia cuando el proveedor no contesta.
 *
 * Se queda con la **cola**: lo nuevo es lo que aún no está resumido, así que
 * recortar por el principio congelaría el resumen en el pasado tras varios fallos.
 */
function fallbackSummary(prev: string, blob: string): string {
  return [prev, blob].filter(Boolean).join("\n").slice(-SUMMARY_FALLBACK_MAX);
}

/** Actualiza el resumen rolling con los mensajes que salieron de la ventana. */
async function refreshRollingSummary(session: BotSession, pruned: ChatTurn[]): Promise<void> {
  if (!session.config.llmKeyCiphertext || pruned.length === 0) return;
  const prev = (await channels.getConversationSummary(session.link.userId)) ?? "";
  const blob = pruned.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 3_000);
  const prompt =
    "Resume en español (máx 120 palabras) el hilo de chat para un asistente de proyectos. " +
    "Conserva hechos útiles (proyecto, decisiones, pendientes). Sin relleno.\n\n" +
    (prev ? `Resumen previo:\n${prev}\n\n` : "") +
    `Mensajes que salen de la ventana:\n${blob}`;

  const provider = resolveProvider(session.config.llmProvider);
  const apiKey = decryptSecret(session.config.llmKeyCiphertext);
  let summary: string | null = null;

  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: resolveModel(session),
          // El thinking adaptativo está activo por defecto y comparte `max_tokens`
          // con la respuesta: con 220 el resumen salía vacío o cortado.
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        summary = data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim() || null;
      }
    } else {
      const base = OPENAI_COMPAT_BASE[provider];
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolveModel(session),
          // 120 palabras ≈ 160 tokens: 220 dejaba el resumen al filo del corte.
          max_tokens: 512,
          messages: [
            { role: "system", content: "Eres un resumidor conciso." },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        summary = data.choices?.[0]?.message?.content?.trim() || null;
      }
    }
  } catch {
    // Fallback local si el proveedor falla
    summary = fallbackSummary(prev, blob);
  }

  if (!summary) summary = fallbackSummary(prev, blob);
  await channels.setConversationSummary(session.link.userId, summary);
}

/**
 * Llama al proveedor sin pasarse del presupuesto del turno. Traduce el abort a
 * un mensaje legible: el usuario ve el error crudo en el chat.
 */
async function providerFetch(
  url: string,
  init: RequestInit,
  deadline: number,
  provider: string
): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${provider}: se agotó el tiempo del turno`);
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Math.min(PROVIDER_TIMEOUT_MS, remaining)),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
      throw new Error(`${provider} no respondió a tiempo`);
    throw err;
  }
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContent[] | Array<{ type: "tool_result"; tool_use_id: string; content: string }>;
};

async function runAnthropicTurn(
  session: BotSession,
  userText: string,
  history: ChatTurn[],
  summary: string | null,
  deadline: number
): Promise<string> {
  const apiKey = decryptSecret(session.config.llmKeyCiphertext!);
  const model = resolveModel(session);

  // Filtrado por la key de la sesión: el bloque de tools viaja en CADA ronda,
  // así que mandar tools que esta key no puede usar se paga otra vez cada vez.
  const toolDefs = listMcpToolDefs(session.config.apiKey).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const messages: AnthropicMessage[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userText },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() >= deadline) return BUDGET_REACHED;

    const res = await providerFetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          // El thinking adaptativo viene activo por defecto y `max_tokens` es el
          // techo de thinking + texto: con 2048 la respuesta se cortaba a mitad.
          max_tokens: 8192,
          // Cachea el prefijo hasta el último bloque: tools + system (estables en
          // todo el turno) y la conversación acumulada. Esto último es lo que más
          // pesa — cada tool_result llega hasta 80k caracteres y se reenvía entero
          // en cada ronda siguiente. Sin caché, las 8 rondas lo pagan 8 veces.
          //
          // El mínimo cacheable depende del modelo (Opus 5: 512 tokens,
          // Sonnet 5: 1024, Haiku 4.5: 4096). Por debajo de ese umbral la API
          // simplemente no cachea: no es un error y el turno sigue igual.
          cache_control: { type: "ephemeral" },
          system: systemPrompt(session, summary),
          tools: toolDefs,
          messages,
        }),
      },
      deadline,
      "Anthropic"
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      stop_reason: string;
      content: AnthropicContent[];
      usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };

    // A partir de la ronda 2 el prefijo ya se escribió, así que una lectura en
    // cero significa que algo lo invalidó (un valor que cambia dentro del
    // prefijo) o que quedó por debajo del mínimo del modelo. Solo se avisa en
    // ese caso: si el caché funciona, no hay nada que reportar.
    if (round > 0 && !data.usage?.cache_read_input_tokens) {
      console.warn(`[telegram] sin lectura de caché en la ronda ${round + 1} (modelo ${model})`);
    }

    const toolUses = data.content.filter(
      (c): c is Extract<AnthropicContent, { type: "tool_use" }> => c.type === "tool_use"
    );
    const texts = data.content.filter((c): c is Extract<AnthropicContent, { type: "text" }> => c.type === "text");
    const answer = () => texts.map((t) => t.text).join("\n").trim();

    // Con `max_tokens` el bloque tool_use puede venir cortado a mitad: ejecutar
    // ese input incompleto es peor que cerrar el turno.
    if (data.stop_reason === "max_tokens") return answer() || TRUNCATED;

    if (toolUses.length === 0) return answer() || "Listo.";

    messages.push({ role: "assistant", content: data.content });

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const tu of toolUses) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: await runMcpToolCall(session, tu.name, tu.input ?? {}),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return TOOL_LIMIT_REACHED;
}

type OpenAiMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function runOpenAiCompatTurn(
  session: BotSession,
  userText: string,
  provider: "openai" | "deepseek",
  history: ChatTurn[],
  summary: string | null,
  deadline: number
): Promise<string> {
  const apiKey = decryptSecret(session.config.llmKeyCiphertext!);
  const model = resolveModel(session);
  const base = OPENAI_COMPAT_BASE[provider];

  const tools = listMcpToolDefs(session.config.apiKey).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt(session, summary) },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user", content: userText },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() >= deadline) return BUDGET_REACHED;

    const res = await providerFetch(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          tools,
          messages,
        }),
      },
      deadline,
      provider
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${provider} ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        finish_reason: string;
        message: {
          content: string | null;
          tool_calls?: OpenAiToolCall[];
        };
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${provider}: respuesta vacía`);

    const msg = choice.message;
    const toolCalls = msg.tool_calls ?? [];

    // `length` = respuesta truncada; los `arguments` de una tool pueden venir
    // cortados y dejar de ser JSON válido.
    if (choice.finish_reason === "length") return (msg.content ?? "").trim() || TRUNCATED;

    if (toolCalls.length === 0) {
      return (msg.content ?? "").trim() || "Listo.";
    }

    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      const content = await runMcpToolCall(session, tc.function.name, input);
      messages.push({ role: "tool", tool_call_id: tc.id, content });
    }
  }

  return TOOL_LIMIT_REACHED;
}

/**
 * Verifica el secret token del webhook de Telegram, en tiempo constante — igual
 * que la firma del webhook de GitHub (lib/github-app.ts). `===` corta en el
 * primer byte distinto, así que su duración depende del prefijo acertado.
 */
export function verifyTelegramSecret(header: string | undefined): boolean {
  const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected || !header) return false;
  const received = Buffer.from(header);
  const wanted = Buffer.from(expected);
  // timingSafeEqual exige longitudes iguales; la longitud no es el secreto.
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

export function isTelegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim());
}
