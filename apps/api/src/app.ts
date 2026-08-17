// Construcción de la app Hono: un solo núcleo de negocio (services/) expuesto
// por REST y MCP. Este módulo NO escucha en un puerto — así el mismo grafo de
// rutas se usa tanto por el servidor Node local (index.ts) como por la función
// serverless de Vercel (api/server.ts).

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { allowedOrigins, isProd } from "./env.js";
import { registerRest } from "./rest/index.js";
import { mcpRoutes } from "./mcp/index.js";
import type { AppEnv } from "./rest/http.js";
import { ServiceError, renderServiceError } from "./services/errors.js";

const GENERIC_ERROR = { es: "Error interno", en: "Internal server error" } as const;

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use("*", securityHeaders());
  app.use("*", cors({ origin: resolveCorsOrigin, credentials: true }));

  // Interfaz REST (frontend web) e interfaz MCP (agentes), ambas sobre la
  // misma capa de servicios.
  registerRest(app);

  // MCP se monta dos veces a propósito: `/mcp` es la URL pública que consume el
  // agente, y `/api/mcp` es donde aterriza en Vercel (las funciones viven bajo
  // /api y el rewrite de `/mcp` reescribe la ruta).
  const mcp = mcpRoutes();
  app.route("/mcp", mcp);
  app.route("/api/mcp", mcp);

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Traduce errores de la capa de servicios a respuestas HTTP, en el locale
  // que resolvió sessionMiddleware (o "es" si la ruta no pasó por ahí).
  app.onError((err, c) => {
    const locale = c.get("locale") ?? "es";
    if (err instanceof ServiceError) {
      return c.json({ error: renderServiceError(err, locale), code: err.code }, err.status as 400);
    }
    console.error("Unhandled error:", err);
    return c.json({ error: locale === "en" ? GENERIC_ERROR.en : GENERIC_ERROR.es }, 500);
  });

  return app;
}

/**
 * Cabeceras de seguridad de las respuestas del API.
 *
 * Todavía sin CSP: la política del front depende de a qué host apunte
 * VITE_POSTHOG_HOST y de los avatares de GitHub, así que se despliega aparte y
 * en report-only primero. Además esto solo cubre lo que pasa por Hono — el HTML
 * de la SPA lo sirve la capa estática de Vercel y necesita su propio bloque
 * `headers` en vercel.json.
 */
function securityHeaders() {
  return secureHeaders({
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    // HSTS solo sobre TLS: en http://localhost el navegador recordaría que debe
    // forzar https y dejaría el dev server inalcanzable hasta limpiar ese estado.
    strictTransportSecurity: isProd
      ? "max-age=63072000; includeSubDomains; preload"
      : false,
    // CORP sigue al despliegue: en producción front y API comparten dominio, así
    // que `same-origin` no cuesta nada; en dev el front es otro origen (Vite en
    // su puerto) y no vale la pena arriesgar ahí una restricción que en prod no
    // se aplicaría nunca.
    crossOriginResourcePolicy: isProd ? "same-origin" : false,
  });
}

/**
 * Allowlist de CORS. En producción el front se sirve del mismo origen que el
 * API (deploy monolítico en Vercel), así que CORS casi no interviene; importa
 * en dev (Vite en otro puerto) y para orígenes extra declarados en WEB_ORIGINS.
 */
function resolveCorsOrigin(origin: string): string | null {
  if (allowedOrigins.includes(origin)) return origin;
  // En dev, cualquier localhost: Vite cambia de puerto si el 5173 está ocupado.
  if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export const app = createApp();
