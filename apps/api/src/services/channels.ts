// Canal Telegram: vincular cuenta, BYOK Anthropic, user MCP key.
// El bot no guarda la MCP key en claro: usa el registro ApiKey vía invokeMcpTool.

import { randomBytes } from "node:crypto";
import {
  API_SCOPES,
  CHANNEL_LLM_PROVIDERS,
  CHANNEL_LLM_DEFAULT_MODELS,
  isAllowedModel,
  listModelsForProvider,
  type ChannelLlmProvider,
} from "@pemie/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { encryptSecret } from "../lib/secrets.js";
import { badRequest, forbidden, notFound, ServiceError } from "./errors.js";
import * as agents from "./agents.js";
import { trackServerEvent } from "./analytics.js";

const LINK_TTL_MS = 15 * 60 * 1000;
const PROVIDER = "telegram";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
/** Retención de updates vistos: cubre de sobra la ventana de reintentos. */
const UPDATE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Ventana de historial enviada al LLM (user + assistant). */
export const HISTORY_KEEP = 10;
const MESSAGE_CONTENT_MAX = 4_000;
const SUMMARY_MAX = 1_500;

function botUsernameFromToken(_token: string | undefined): string | null {
  return env.TELEGRAM_BOT_USERNAME?.trim() || null;
}

function parseLlmProvider(raw: string | undefined | null): ChannelLlmProvider {
  const p = (raw ?? "anthropic") as ChannelLlmProvider;
  if (!(CHANNEL_LLM_PROVIDERS as readonly string[]).includes(p))
    throw badRequest("invalid_llm_provider", { provider: String(raw) });
  return p;
}

function validateLlmKey(provider: ChannelLlmProvider, key: string) {
  if (key.length < 20) throw badRequest("invalid_llm_key");
  if (provider === "anthropic") {
    if (!key.startsWith("sk-ant-") && !key.startsWith("sk-")) throw badRequest("invalid_anthropic_key");
  } else if (provider === "openai") {
    if (!key.startsWith("sk-")) throw badRequest("invalid_openai_key");
  }
  // deepseek: acepta sk-… u otros prefijos comerciales
}

/** Estado del canal Telegram del usuario (sin secretos). */
export async function getChannelStatus(userId: string) {
  const [link, config, credentials] = await Promise.all([
    prisma.channelLink.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } }),
    prisma.userChannelConfig.findUnique({
      where: { userId },
      include: { apiKey: true, defaultProject: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.channelLlmCredential.findMany({ where: { userId } }),
  ]);

  const botConfigured = Boolean(env.TELEGRAM_BOT_TOKEN?.trim());
  const botUsername = botUsernameFromToken(env.TELEGRAM_BOT_TOKEN);
  const llmProvider = (CHANNEL_LLM_PROVIDERS as readonly string[]).includes(config?.llmProvider ?? "")
    ? (config!.llmProvider as ChannelLlmProvider)
    : "anthropic";

  const providers = Object.fromEntries(
    CHANNEL_LLM_PROVIDERS.map((p) => {
      const cred = credentials.find((c) => c.provider === p);
      const legacy =
        !cred && config?.llmProvider === p && config.llmKeyCiphertext
          ? { last4: config.llmKeyLast4 }
          : null;
      return [
        p,
        {
          hasKey: Boolean(cred || legacy),
          last4: cred?.llmKeyLast4 ?? legacy?.last4 ?? null,
          models: [...listModelsForProvider(p)],
        },
      ];
    })
  ) as Record<ChannelLlmProvider, { hasKey: boolean; last4: string | null; models: string[] }>;

  const activeHasKey = providers[llmProvider].hasKey;

  return {
    botConfigured,
    botUsername,
    linked: Boolean(link),
    telegramUsername: link?.username ?? null,
    linkedAt: link?.linkedAt ?? null,
    enabled: config?.enabled ?? false,
    hasLlmKey: activeHasKey,
    llmKeyLast4: providers[llmProvider].last4,
    llmProvider,
    model: config?.model ?? CHANNEL_LLM_DEFAULT_MODELS[llmProvider],
    models: [...listModelsForProvider(llmProvider)],
    providers,
    defaultProject: config?.defaultProject ?? null,
    apiKeyPrefix: config?.apiKey?.prefix ?? null,
    ready: Boolean(link && config?.enabled && activeHasKey),
  };
}

/**
 * Crea un token one-shot para deep link t.me/Bot?start=<token>.
 * Al completar el link se asegura UserChannelConfig + user MCP key.
 *
 * `analyticsEnabled` viene explícito del `User` que rest/channels.ts ya cargó
 * para autorizar la petición (nunca un fetch aparte); si es `false`,
 * trackServerEvent es no-op silencioso.
 */
export async function createLinkToken(
  userId: string,
  analyticsEnabled: boolean,
  projectId?: string | null
) {
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
    trackServerEvent(analyticsEnabled, userId, "telegram_link_started_failed", {
      reason: "telegram_not_configured",
    });
    throw badRequest("telegram_not_configured");
  }

  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("project_not_found");
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { workspaceId: project.workspaceId, userId } },
    });
    if (!membership) throw forbidden("not_workspace_member");
  }

  const token = randomBytes(24).toString("hex");
  const row = await prisma.channelLinkToken.create({
    data: {
      token,
      userId,
      projectId: projectId ?? null,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    },
  });

  const botUsername = botUsernameFromToken(env.TELEGRAM_BOT_TOKEN);
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=${token}`
    : null;

  trackServerEvent(analyticsEnabled, userId, "telegram_link_started");

  return {
    token: row.token,
    expiresAt: row.expiresAt,
    deepLink,
    // Fallback si no hay username: el usuario pega /start <token> en el bot.
    startPayload: token,
  };
}

/**
 * Completa el vínculo desde el webhook /start <token>.
 * Crea o reutiliza UserChannelConfig + ApiKey user-scoped.
 */
export async function completeLinkFromToken(
  token: string,
  telegramUserId: string,
  telegramUsername?: string | null
) {
  // El link se completa fuera de la SPA (el bot habla directo con Telegram): se
  // detecta acá, al procesar /start, y se incluye el User ya en la misma query
  // para trackear `telegram_linked` sin un fetch aparte.
  const row = await prisma.channelLinkToken.findUnique({
    where: { token },
    include: { user: { select: { analyticsEnabled: true, locale: true } } },
  });
  if (!row || row.usedAt) throw badRequest("invalid_link_token");
  if (row.expiresAt.getTime() < Date.now()) throw badRequest("link_token_expired");

  const userId = row.userId;

  // Si otro usuario Pemie ya tiene este telegram, o este user tiene otro telegram: reemplazar.
  await prisma.$transaction(async (tx) => {
    await tx.channelLink.deleteMany({
      where: {
        OR: [
          { provider: PROVIDER, externalId: telegramUserId },
          { userId, provider: PROVIDER },
        ],
      },
    });
    await tx.channelLink.create({
      data: {
        userId,
        provider: PROVIDER,
        externalId: telegramUserId,
        username: telegramUsername ?? null,
      },
    });
    await tx.channelLinkToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
  });

  await ensureUserChannelConfig(userId, row.projectId);
  trackServerEvent(row.user.analyticsEnabled, userId, "telegram_linked");
  return { userId, projectId: row.projectId, locale: row.user.locale };
}

/**
 * Locale del usuario vinculado a un telegram id, sin cargar el resto de la
 * sesión (`loadBotSession` trae config + credenciales, que no hacen falta acá).
 */
export async function getLinkedLocale(telegramUserId: string): Promise<string | null> {
  const link = await prisma.channelLink.findUnique({
    where: { provider_externalId: { provider: PROVIDER, externalId: telegramUserId } },
    select: { user: { select: { locale: true } } },
  });
  return link?.user.locale ?? null;
}

/** Asegura config + user MCP key (reutiliza si ya existe). */
export async function ensureUserChannelConfig(userId: string, defaultProjectId?: string | null) {
  const existing = await prisma.userChannelConfig.findUnique({ where: { userId } });
  if (existing) {
    if (defaultProjectId && !existing.defaultProjectId) {
      return prisma.userChannelConfig.update({
        where: { userId },
        data: { defaultProjectId, enabled: true },
      });
    }
    if (!existing.enabled) {
      return prisma.userChannelConfig.update({
        where: { userId },
        data: { enabled: true },
      });
    }
    return existing;
  }

  const { apiKey } = await agents.createPersonalApiKey(userId, {
    name: "Telegram bot",
    scopes: [...API_SCOPES],
  });

  // createApiKey returns public view; we need the id
  return prisma.userChannelConfig.create({
    data: {
      userId,
      apiKeyId: apiKey.id,
      defaultProjectId: defaultProjectId ?? null,
      enabled: true,
    },
  });
}

/** Guarda / actualiza la LLM key del usuario (cifrada) y el proveedor activo. */
export async function setLlmKey(
  userId: string,
  analyticsEnabled: boolean,
  rawKey: string,
  opts?: { provider?: string; model?: string }
) {
  try {
    const provider = parseLlmProvider(opts?.provider ?? "anthropic");
    const trimmed = rawKey.trim();
    validateLlmKey(provider, trimmed);

    await ensureUserChannelConfig(userId);
    const ciphertext = encryptSecret(trimmed);
    const last4 = trimmed.slice(-4);
    const requested = opts?.model?.trim();
    // Un modelo fuera del catálogo se rechaza igual que en `setChannelModel`: caer
    // al default en silencio dejaba al usuario creyendo que guardó otra cosa.
    if (requested && !isAllowedModel(provider, requested)) {
      throw badRequest("invalid_model", { provider, models: listModelsForProvider(provider).join(", ") });
    }
    const model = requested || CHANNEL_LLM_DEFAULT_MODELS[provider];

    await prisma.channelLlmCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, llmKeyCiphertext: ciphertext, llmKeyLast4: last4 },
      update: { llmKeyCiphertext: ciphertext, llmKeyLast4: last4 },
    });

    const config = await prisma.userChannelConfig.update({
      where: { userId },
      data: {
        llmProvider: provider,
        llmKeyCiphertext: ciphertext,
        llmKeyLast4: last4,
        model,
        enabled: true,
      },
    });
    // provider/model son metadata, no secretos: nunca el valor de la key.
    trackServerEvent(analyticsEnabled, userId, "telegram_llm_key_set", { provider, model });
    return config;
  } catch (err) {
    const reason = err instanceof ServiceError ? err.code ?? "unknown_error" : "unknown_error";
    trackServerEvent(analyticsEnabled, userId, "telegram_llm_key_set_failed", { reason });
    throw err;
  }
}

/**
 * Borra la LLM key guardada de un proveedor.
 *
 * La key es del usuario y se factura a su cuenta: tiene que poder revocarla desde
 * el producto. Si además es la del proveedor activo se limpia el espejo en
 * `UserChannelConfig`, que es de donde leen `loadBotSession` y `getChannelStatus`.
 */
export async function deleteLlmKey(userId: string, rawProvider: string) {
  const provider = parseLlmProvider(rawProvider);

  await prisma.channelLlmCredential.deleteMany({ where: { userId, provider } });
  await prisma.userChannelConfig.updateMany({
    where: { userId, llmProvider: provider },
    data: { llmKeyCiphertext: null, llmKeyLast4: null },
  });

  return prisma.userChannelConfig.findUnique({ where: { userId } });
}

/** Cambia el proveedor activo si ya hay credential guardada. */
export async function setChannelProvider(userId: string, rawProvider: string) {
  const provider = parseLlmProvider(rawProvider);
  await ensureUserChannelConfig(userId);

  const cred = await prisma.channelLlmCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!cred) {
    // Compat: key solo en UserChannelConfig del mismo proveedor
    const config = await prisma.userChannelConfig.findUnique({ where: { userId } });
    if (config?.llmProvider === provider && config.llmKeyCiphertext) {
      await prisma.channelLlmCredential.create({
        data: {
          userId,
          provider,
          llmKeyCiphertext: config.llmKeyCiphertext,
          llmKeyLast4: config.llmKeyLast4 ?? "????",
        },
      });
    } else {
      throw badRequest("provider_key_missing", { provider });
    }
  }

  const fresh = await prisma.channelLlmCredential.findUniqueOrThrow({
    where: { userId_provider: { userId, provider } },
  });
  const config = await prisma.userChannelConfig.findUniqueOrThrow({ where: { userId } });
  const model = isAllowedModel(provider, config.model)
    ? config.model
    : CHANNEL_LLM_DEFAULT_MODELS[provider];

  return prisma.userChannelConfig.update({
    where: { userId },
    data: {
      llmProvider: provider,
      llmKeyCiphertext: fresh.llmKeyCiphertext,
      llmKeyLast4: fresh.llmKeyLast4,
      model,
      enabled: true,
    },
  });
}

/** Cambia el modelo del proveedor activo (catálogo fijo). */
export async function setChannelModel(userId: string, rawModel: string) {
  await ensureUserChannelConfig(userId);
  const config = await prisma.userChannelConfig.findUniqueOrThrow({ where: { userId } });
  const provider = parseLlmProvider(config.llmProvider);
  const model = rawModel.trim();
  if (!isAllowedModel(provider, model)) {
    throw badRequest("invalid_model", { provider, models: listModelsForProvider(provider).join(", ") });
  }
  return prisma.userChannelConfig.update({
    where: { userId },
    data: { model },
  });
}

function truncateContent(text: string, max = MESSAGE_CONTENT_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export async function listRecentChannelMessages(userId: string, limit = HISTORY_KEEP) {
  // Ordena por `seq`, no por `createdAt`: el par user+assistant se inserta en la
  // misma transacción y comparte timestamp, así que el desempate sería arbitrario
  // y podría abrir el historial con un turno "assistant" (400 del proveedor).
  const rows = await prisma.channelMessage.findMany({
    where: { userId, provider: PROVIDER },
    orderBy: { seq: "desc" },
    take: limit,
    select: { role: true, content: true, createdAt: true },
  });
  return rows.reverse();
}

export async function getConversationSummary(userId: string): Promise<string | null> {
  const config = await prisma.userChannelConfig.findUnique({
    where: { userId },
    select: { conversationSummary: true },
  });
  return config?.conversationSummary ?? null;
}

export async function setConversationSummary(userId: string, summary: string | null) {
  const value = summary ? truncateContent(summary, SUMMARY_MAX) : null;
  await prisma.userChannelConfig.update({
    where: { userId },
    data: { conversationSummary: value },
  });
}

/**
 * Guarda el par user/assistant del turno, poda a HISTORY_KEEP y
 * devuelve los mensajes expulsados (para actualizar el resumen rolling).
 */
export async function recordTurnMessages(
  userId: string,
  userText: string,
  assistantText: string
): Promise<Array<{ role: string; content: string }>> {
  await prisma.channelMessage.createMany({
    data: [
      { userId, provider: PROVIDER, role: "user", content: truncateContent(userText) },
      { userId, provider: PROVIDER, role: "assistant", content: truncateContent(assistantText) },
    ],
  });

  // Mismo motivo que en `listRecentChannelMessages`: por `createdAt` la poda podría
  // expulsar el assistant y dejar huérfano su user del mismo turno.
  const all = await prisma.channelMessage.findMany({
    where: { userId, provider: PROVIDER },
    orderBy: { seq: "asc" },
    select: { id: true, role: true, content: true },
  });

  if (all.length <= HISTORY_KEEP) return [];

  const overflow = all.slice(0, all.length - HISTORY_KEEP);
  await prisma.channelMessage.deleteMany({
    where: { id: { in: overflow.map((m) => m.id) } },
  });
  return overflow.map((m) => ({ role: m.role, content: m.content }));
}

export async function clearChannelMessages(userId: string) {
  await prisma.channelMessage.deleteMany({ where: { userId, provider: PROVIDER } });
  await prisma.userChannelConfig.updateMany({
    where: { userId },
    data: { conversationSummary: null },
  });
}

export async function setDefaultProject(
  userId: string,
  analyticsEnabled: boolean,
  projectId: string | null
) {
  await ensureUserChannelConfig(userId);
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("project_not_found");
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { workspaceId: project.workspaceId, userId } },
    });
    if (!membership) throw forbidden("not_workspace_member");
  }
  const config = await prisma.userChannelConfig.update({
    where: { userId },
    data: { defaultProjectId: projectId },
  });
  trackServerEvent(analyticsEnabled, userId, "telegram_default_project_set");
  return config;
}

/** Desvincula Telegram y desactiva el canal (no borra la user key MCP ni credentials). */
export async function disconnectChannel(userId: string, analyticsEnabled: boolean) {
  await prisma.channelLink.deleteMany({ where: { userId, provider: PROVIDER } });
  await clearChannelMessages(userId).catch(() => {});
  const config = await prisma.userChannelConfig.findUnique({ where: { userId } });
  if (config) {
    await prisma.userChannelConfig.update({
      where: { userId },
      data: { enabled: false },
    });
  }
  trackServerEvent(analyticsEnabled, userId, "telegram_disconnected");
  return { ok: true };
}

export type UpdateClaim = "claimed" | "duplicate" | "rate_limited";

/**
 * Reserva un update entrante antes de procesarlo.
 *
 * Telegram reintenta la entrega cuando el webhook tarda o responde 5xx, y el
 * turno puede ejecutar tools de escritura (publicar informe, crear tarjeta):
 * repetirlo duplica efectos. La unique (provider, updateId) hace de candado, así
 * que el reintento cae en `duplicate` y no vuelve a ejecutar nada. Si el turno
 * se cae a mitad el update queda reservado sin `processedAt` — preferimos perder
 * una respuesta antes que duplicar escrituras.
 *
 * Las filas también son el rate limit: contar en DB funciona en serverless,
 * donde cada request puede caer en otra instancia y un Map de proceso no vale.
 */
export async function claimChannelUpdate(
  updateId: string,
  externalId: string
): Promise<UpdateClaim> {
  try {
    await prisma.channelUpdate.create({
      data: { provider: PROVIDER, updateId, externalId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return "duplicate";
    throw err;
  }

  const recent = await prisma.channelUpdate.count({
    where: {
      provider: PROVIDER,
      externalId,
      createdAt: { gte: new Date(Date.now() - RATE_WINDOW_MS) },
    },
  });

  // Poda oportunista: no hay cron, y la tabla no puede crecer sin techo.
  await prisma.channelUpdate
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - UPDATE_RETENTION_MS) } } })
    .catch(() => {});

  return recent > RATE_MAX ? "rate_limited" : "claimed";
}

/** Cierra un update reservado (deja rastro de los turnos que sí terminaron). */
export async function markChannelUpdateProcessed(updateId: string) {
  await prisma.channelUpdate
    .updateMany({
      where: { provider: PROVIDER, updateId, processedAt: null },
      data: { processedAt: new Date() },
    })
    .catch(() => {});
}

/** Carga contexto completo del bot para un telegram user id. */
export async function loadBotSession(telegramUserId: string) {
  // Incluye preferencias de usuario en la misma query (no un fetch aparte): los
  // comandos y el idioma del asistente las leen de acá.
  const link = await prisma.channelLink.findUnique({
    where: { provider_externalId: { provider: PROVIDER, externalId: telegramUserId } },
    include: { user: { select: { analyticsEnabled: true, locale: true } } },
  });
  if (!link) return null;

  const config = await prisma.userChannelConfig.findUnique({
    where: { userId: link.userId },
    include: {
      apiKey: true,
      defaultProject: { select: { id: true, name: true, slug: true, workspaceId: true } },
    },
  });
  if (!config || !config.enabled) return null;

  // Preferir credential del proveedor activo; fallback al espejo en config.
  const cred = await prisma.channelLlmCredential.findUnique({
    where: { userId_provider: { userId: link.userId, provider: config.llmProvider } },
  });
  const llmKeyCiphertext = cred?.llmKeyCiphertext ?? config.llmKeyCiphertext;
  const llmKeyLast4 = cred?.llmKeyLast4 ?? config.llmKeyLast4;

  return {
    link,
    config: {
      ...config,
      llmKeyCiphertext,
      llmKeyLast4,
    },
  };
}
