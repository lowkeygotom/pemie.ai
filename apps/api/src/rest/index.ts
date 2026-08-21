import type { Hono } from "hono";
import { prisma } from "../db.js";
import { type AppEnv, sessionMiddleware } from "./http.js";
import { authRoutes } from "./auth.js";
import { workspaceRoutes } from "./workspaces.js";
import { invitationRoutes } from "./invitations.js";
import { webhookRoutes } from "./webhooks.js";
import { channelRoutes } from "./channels.js";
import { skillDownloadRoutes, skillTransferRoutes } from "./skill-transfer.js";
import { accountKeyRoutes } from "./account-keys.js";

/**
 * Monta la interfaz REST/JSON (consumida por el frontend web) sobre `app`.
 * Cada handler debe delegar en la capa de servicios (src/services); aquí solo
 * va traducción HTTP <-> servicios. Los recursos se agregan por fase.
 */
export function registerRest(app: Hono<AppEnv>) {
  app.get("/api/health", async (c) => {
    let db = "unknown";
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = "ok";
    } catch {
      db = "down";
    }
    return c.json({
      status: "ok",
      service: "pemie-api",
      db,
      timestamp: new Date().toISOString(),
    });
  });

  // Índice de la API.
  app.get("/api", (c) =>
    c.json({
      name: "pemie.ai API",
      version: "0.1.0",
      interfaces: {
        rest: "/api/**  (frontend web)",
        mcp: "/mcp      (agentes, API key + scopes)",
        webhooks: "/webhooks/github | /webhooks/telegram",
      },
    })
  );

  // Webhooks de ingesta (F2) y Telegram: fuera de /api/*, autenticados por secreto.
  // El alias bajo /api existe porque en Vercel las funciones viven ahí y el
  // rewrite de /webhooks/* reescribe la ruta antes de llegar a la app.
  app.route("/webhooks", webhookRoutes());
  app.route("/api/webhooks", webhookRoutes());

  // Resuelve la sesión (cookie -> user) para todo /api/*.
  app.use("/api/*", sessionMiddleware);

  // Recursos F1: auth + tenencia. F2 añade repos/commits/stats bajo proyectos.
  app.route("/api/auth", authRoutes());
  app.route("/api/workspaces", workspaceRoutes());
  app.route("/api/invitations", invitationRoutes());
  app.route("/api/me/channels", channelRoutes());
  app.route("/api/me/api-keys", accountKeyRoutes());
  // Tokens opacos (no sesión): curl pelado desde el agente / browser multipart.
  app.route("/api/skill-uploads", skillTransferRoutes());
  app.route("/api/skill-downloads", skillDownloadRoutes());
}
