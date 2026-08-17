// Servicio de autenticación: registro/login por email+password, sesiones
// persistidas (modelo Session) y vinculación de cuentas OAuth de GitHub.
// Agnóstico del transporte: el REST traduce cookies <-> tokens de sesión.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, conflict, unauthorized } from "./errors.js";

export const USER_LOCALES = ["es", "en"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días
const BCRYPT_ROUNDS = 12;

/** Usuario expuesto al cliente (sin passwordHash). */
export type PublicUser = Pick<
  User,
  "id" | "email" | "name" | "avatarUrl" | "githubLogin" | "createdAt" | "analyticsEnabled" | "locale"
>;

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    githubLogin: u.githubLogin,
    createdAt: u.createdAt,
    analyticsEnabled: u.analyticsEnabled,
    locale: u.locale as UserLocale,
  };
}

/** Preferencia de idioma de la cuenta. El valor se valida en el núcleo, no en REST. */
export async function updateLocale(userId: string, locale: string): Promise<PublicUser> {
  if (!(USER_LOCALES as readonly string[]).includes(locale))
    throw badRequest("Idioma inválido", "invalid_locale");
  const user = await prisma.user.update({ where: { id: userId }, data: { locale } });
  return toPublicUser(user);
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { userId, token, expiresAt } });
  return { token, expiresAt };
}

/** Registro con email + password. Devuelve el usuario y una sesión nueva. */
export async function register(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw badRequest("Email inválido", "invalid_email");
  if (input.password.length < 8)
    throw badRequest("La contraseña debe tener al menos 8 caracteres", "weak_password");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("Ya existe una cuenta con ese email", "email_taken");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: input.name?.trim() || null },
  });
  const session = await createSession(user.id);
  return { user: toPublicUser(user), ...session };
}

/** Login con email + password. */
export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash)
    throw unauthorized("Credenciales inválidas");
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw unauthorized("Credenciales inválidas");
  const session = await createSession(user.id);
  return { user: toPublicUser(user), ...session };
}

/** Cierra la sesión asociada a un token (idempotente). */
export async function logout(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

/** Preferencia de analítica de producto (toggle reversible en /settings). */
export async function updateAnalyticsPreference(
  userId: string,
  enabled: boolean
): Promise<PublicUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { analyticsEnabled: enabled },
  });
  return toPublicUser(user);
}

/**
 * Resuelve el usuario a partir de un token de sesión. Devuelve null si el
 * token no existe o expiró (limpiando la sesión expirada de paso).
 */
export async function userFromSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/**
 * Alta o vinculación de un usuario vía GitHub OAuth. Reutiliza la cuenta por
 * providerAccountId; si no existe, la vincula a un user con el mismo email o
 * crea uno nuevo. Devuelve una sesión lista.
 */
export async function loginWithGithub(profile: {
  githubId: string;
  login: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  accessToken: string;
}): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "github",
        providerAccountId: profile.githubId,
      },
    },
    include: { user: true },
  });

  let user = account?.user ?? null;

  if (!user && profile.email) {
    user = await prisma.user.findUnique({ where: { email: normalizeEmail(profile.email) } });
  }

  if (!user) {
    // Sin email de GitHub usamos un placeholder estable por id de GitHub.
    const email = profile.email
      ? normalizeEmail(profile.email)
      : `${profile.login}@users.noreply.github.com`;
    user = await prisma.user.create({
      data: {
        email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        githubLogin: profile.login,
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        githubLogin: profile.login,
        avatarUrl: user.avatarUrl ?? profile.avatarUrl,
        name: user.name ?? profile.name,
      },
    });
  }

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "github",
        providerAccountId: profile.githubId,
      },
    },
    create: {
      provider: "github",
      providerAccountId: profile.githubId,
      userId: user.id,
      accessToken: profile.accessToken,
    },
    update: { accessToken: profile.accessToken },
  });

  const session = await createSession(user.id);
  return { user: toPublicUser(user), ...session };
}
