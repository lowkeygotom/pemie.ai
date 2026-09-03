import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  // Sin SESSION_SECRET: las sesiones son tokens opacos de 32 bytes guardados en
  // la tabla `sessions` (services/auth.ts), no cookies firmadas. Declararlo
  // sugería una firma que nunca existió.

  // Origen del frontend. En el deploy monolítico de Vercel (front + API en el
  // mismo dominio) no hace falta setearlo: se resuelve del dominio del deploy y
  // los redirects de OAuth usan el origen de la petición, así los *previews*
  // también funcionan. Setéalo solo si el front vive en otro dominio.
  WEB_ORIGIN: z.string().optional(),
  // Orígenes extra con permiso de CORS (coma-separados), p. ej. un dominio
  // propio adicional o un front local apuntando al API de staging.
  WEB_ORIGINS: z.string().optional(),
  // Origen público del API. Solo necesario si el API está detrás de un proxy
  // que no reenvía x-forwarded-host; si no, se deriva de la petición.
  PUBLIC_API_URL: z.string().optional(),

  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  // Deepgram firma credenciales efímeras para el WebSocket del modo mesa.
  // Si falta, el feature se anuncia como no disponible en vez de fallar al grabar.
  DEEPGRAM_API_KEY: z.string().optional(),
  // Vercel Blob firma uploads directos desde el navegador; el audio no pasa por la función.

  // Bot de Telegram (canal on-demand). Opcional en local; requerido en prod
  // si se usa el canal. Webhook: POST /webhooks/telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Username del bot sin @ (para deep links t.me/…). */
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // AES-256 key (32 bytes en base64) para cifrar Anthropic BYOK del usuario.
  // Generar: openssl rand -base64 32
  CHANNEL_SECRETS_KEY: z.string().optional(),

  // Envío de correo. Resend es el transporte definitivo; SMTP es un escalón
  // temporal de prueba y solo se usa si no hay key de Resend.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("pemie.ai <onboarding@resend.dev>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65535).default(587)
  ),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Analítica de producto (PEM-8, server-side: eventos telegram_*). Credencial
  // separada de la del cliente (VITE_POSTHOG_KEY en apps/web) — sin key, el
  // wrapper de servicios/analytics.ts es un no-op silencioso.
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),
});

const parsed = schema.parse(process.env);

export const isProd = parsed.NODE_ENV === "production";

/** Quita slashes finales para poder concatenar rutas sin duplicarlos. */
function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Dominio del deploy en Vercel, conocido solo en runtime. Sirve de default de
 * WEB_ORIGIN para que un deploy sin configurar no acabe apuntando a localhost
 * (que era exactamente el bug de "en prod el login intenta entrar en local").
 */
function vercelOrigin(): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/** true si WEB_ORIGIN vino de configuración explícita (no de un default). */
export const webOriginConfigured = Boolean(parsed.WEB_ORIGIN?.trim());

const webOrigin = normalizeOrigin(
  parsed.WEB_ORIGIN?.trim() || vercelOrigin() || "http://localhost:5173"
);

export type Env = z.infer<typeof schema> & { WEB_ORIGIN: string };

/** Config validada. WEB_ORIGIN ya viene resuelto y normalizado. */
export const env: Env = { ...parsed, WEB_ORIGIN: webOrigin };

/** Orígenes con permiso para llamar al API con credenciales (CORS). */
export const allowedOrigins: string[] = Array.from(
  new Set(
    [webOrigin, vercelOrigin(), ...(parsed.WEB_ORIGINS?.split(",") ?? [])]
      .filter((o): o is string => Boolean(o?.trim()))
      .map(normalizeOrigin)
  )
);
