// Webhooks entrantes (GitHub + Telegram). Fuera de sesión de usuario.

import { Hono } from "hono";
import { verifyWebhookSignature } from "../lib/github-app.js";
import * as ingest from "../services/ingest.js";
import * as telegramBot from "../services/telegram-bot.js";
import type { AppEnv } from "./http.js";
import { badRequest, serviceUnavailable, unauthorized } from "../services/errors.js";

// Fuera de sessionMiddleware (rest/index.ts monta estas rutas antes): no hay
// locale de usuario que resolver. El consumidor es GitHub/Telegram (M2M), no
// una persona — estos errores solo necesitan un `code` estable, no prosa
// localizada. Se lanzan como ServiceError igual que el resto de rest/ y los
// renderiza el onError global (locale default "es").
export function webhookRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/github", async (c) => {
    const raw = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(raw, signature)) throw unauthorized("invalid_webhook_signature");

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw badRequest("invalid_webhook_payload");
    }

    const event = c.req.header("x-github-event") ?? "";
    if (event === "ping") return c.json({ ok: true, pong: true });
    if (event === "push") {
      const result = await ingest.ingestPushEvent(payload as ingest.PushEvent);
      return c.json({ ok: true, ...result });
    }
    return c.json({ ok: true, ignored: event });
  });

  app.post("/telegram", async (c) => {
    if (!telegramBot.isTelegramConfigured()) throw serviceUnavailable("telegram_not_configured");
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    if (!telegramBot.verifyTelegramSecret(secret)) throw unauthorized("invalid_telegram_secret");

    const update = await c.req.json().catch(() => null);
    if (!update) throw badRequest("invalid_webhook_payload");

    // El turno se procesa en la misma request: en serverless no hay proceso vivo
    // después de responder. El handler acota el turno por debajo del maxDuration
    // y deduplica por update_id, así que un reintento de Telegram no repite nada.
    const result = await telegramBot.handleTelegramUpdate(update);
    return c.json(result);
  });

  return app;
}
