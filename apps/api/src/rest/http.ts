// Tipos y helpers compartidos por los routers REST.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { User } from "@prisma/client";
import { env, isProd, webOriginConfigured } from "../env.js";
import { unauthorized } from "../services/errors.js";
import * as auth from "../services/auth.js";
import { parseAcceptLanguage } from "../lib/accept-language.js";

export const SESSION_COOKIE = "pemie_session";

/** Variables que los middlewares dejan en el contexto Hono. */
export type AppEnv = { Variables: { user: User | null; locale: string } };
export type AppContext = Context<AppEnv>;

/**
 * Escribe la cookie de sesión httpOnly.
 *
 * `SameSite=Lax` (no `None`): front y API comparten dominio, así la cookie es
 * first-party y sobrevive al bloqueo de cookies de terceros de Safari/Chrome.
 * Lax igual viaja en la navegación top-level del callback de OAuth.
 */
export function setSessionCookie(c: AppContext, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Origen público por el que entró esta petición. Detrás del proxy de Vercel el
 * host real viaja en x-forwarded-*: `c.req.url` trae el host interno, así que no
 * sirve para construir URLs absolutas (redirect_uri de OAuth, redirects, etc.).
 */
export function requestOrigin(c: AppContext): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.slice(0, -1);
  const host =
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

/** Origen público del API, para construir el `redirect_uri` de OAuth. */
export function apiOrigin(c: AppContext): string {
  return env.PUBLIC_API_URL?.trim() ? env.PUBLIC_API_URL.replace(/\/+$/, "") : requestOrigin(c);
}

/**
 * Origen del frontend al que redirigir (post-OAuth, errores de login). Si
 * WEB_ORIGIN no se configuró se asume front y API en el mismo dominio, que es
 * el deploy por defecto y hace funcionar también los previews de Vercel.
 */
export function webOrigin(c: AppContext): string {
  return webOriginConfigured ? env.WEB_ORIGIN : requestOrigin(c);
}

/**
 * Sanea una ruta de retorno (`?next=`): solo rutas relativas del propio front.
 * Evita open redirects hacia dominios externos.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}

export function clearSessionCookie(c: AppContext) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Resuelve el usuario de la cookie y el locale de la petición, y los deja en
 * el contexto (usuario o null; locale del usuario si hay sesión, si no
 * `Accept-Language`, si no "es").
 */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = await auth.userFromSession(token);
  c.set("user", user);
  c.set("locale", user?.locale ?? parseAcceptLanguage(c.req.header("accept-language")) ?? "es");
  await next();
};

/** Exige usuario autenticado; devuelve el user no-nulo. */
export function requireUser(c: AppContext): User {
  const user = c.get("user");
  if (!user) throw unauthorized("not_authenticated");
  return user;
}
