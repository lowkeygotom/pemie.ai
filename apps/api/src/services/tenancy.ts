// Servicio de tenencia: workspaces, membresías, invitaciones y proyectos.
// Toda operación se scopea por workspace y verifica el rol del usuario.

import { randomBytes } from "node:crypto";
import type { Role } from "@pemie/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { uniqueSlug } from "../lib/slug.js";
import { sendInvitationEmail } from "./mailer.js";

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

/** Una sola llave de correo para invitaciones y contributors. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verifica que `userId` es miembro de `workspaceId` con al menos `minRole`.
 * Devuelve la membresía; lanza 403/404 si no aplica.
 */
export async function requireMembership(
  userId: string,
  workspaceId: string,
  minRole: Role = "viewer"
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) throw notFound("workspace_not_found");
  if (ROLE_RANK[membership.role as Role] < ROLE_RANK[minRole])
    throw forbidden("insufficient_workspace_role");
  return membership;
}

// ─── Workspaces ────────────────────────────────────────────────────────

/** Crea un workspace y hace al creador `owner`. */
export async function createWorkspace(userId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2) throw badRequest("name_too_short");
  const slug = await uniqueSlug(trimmed, async (s) =>
    Boolean(await prisma.workspace.findUnique({ where: { slug: s } }))
  );
  return prisma.workspace.create({
    data: {
      name: trimmed,
      slug,
      memberships: { create: { userId, role: "owner" } },
    },
  });
}

/** Lista los workspaces de un usuario con su rol y conteo de proyectos. */
export async function listWorkspaces(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { workspace: { include: { _count: { select: { projects: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role as Role,
    projectCount: m.workspace._count.projects,
    createdAt: m.workspace.createdAt,
  }));
}

/** Devuelve un workspace por slug si el usuario es miembro, con su rol. */
export async function getWorkspace(userId: string, slug: string) {
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) throw notFound("workspace_not_found");
  const membership = await requireMembership(userId, workspace.id);
  return { ...workspace, role: membership.role as Role };
}

/** Renombra un workspace (owner/admin). */
export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: { name: string }
) {
  const membership = await requireMembership(userId, workspaceId, "admin");
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("name_too_short");
  // El slug NO se regenera al renombrar: es la identidad del workspace en las URLs,
  // en los enlaces ya compartidos y en las configuraciones de los agentes. Cambiarlo
  // rompería todo eso, así que el nombre es solo la etiqueta visible.
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  // Misma forma que `getWorkspace` para que el cliente pueda reemplazar su estado.
  return { ...workspace, role: membership.role as Role };
}

/** Elimina un workspace con todo su contenido (solo owner). */
export async function deleteWorkspace(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId, "owner");
  // Un borrado destructivo e irreversible solo lo puede hacer quien es dueño.
  // La cascada del schema arrastra membresías, invitaciones, API keys, audit log y
  // los proyectos con todo lo que cuelga de ellos (repos, commits, informes, notas,
  // objetivos, épicas, historias y tableros): no hace falta borrar nada a mano.
  await prisma.workspace.delete({ where: { id: workspaceId } });
  return { ok: true };
}

/** Miembros de un workspace (requiere ser miembro). */
export async function listMembers(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  const memberships = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    role: m.role as Role,
    user: m.user,
  }));
}

/**
 * Cambia el rol de un miembro (owner/admin). No se puede asignar `owner`
 * (no hay flujo de transferencia de ownership) ni tocar la membresía del
 * propio owner (dejaría el workspace sin dueño).
 */
export async function updateMemberRole(
  userId: string,
  workspaceId: string,
  membershipId: string,
  newRole: Role
) {
  await requireMembership(userId, workspaceId, "admin");
  const target = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
  });
  if (!target || target.workspaceId !== workspaceId) throw notFound("member_not_found");
  if (target.role === "owner") throw forbidden("cannot_change_owner_role");
  if (newRole === "owner") throw badRequest("invalid_role");
  const updated = await prisma.membership.update({ where: { id: membershipId }, data: { role: newRole } });
  // Misma forma que `listMembers` para que el cliente reemplace la fila en su estado.
  return { membershipId: updated.id, role: updated.role as Role, user: target.user };
}

/** Quita una membresía del workspace (owner/admin). */
export async function removeMember(userId: string, workspaceId: string, membershipId: string) {
  await requireMembership(userId, workspaceId, "admin");
  const target = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!target || target.workspaceId !== workspaceId) throw notFound("member_not_found");
  if (target.role === "owner") throw forbidden("cannot_remove_owner");
  if (target.userId === userId) throw forbidden("cannot_remove_self");
  await prisma.membership.delete({ where: { id: membershipId } });
  return { ok: true };
}

// ─── Invitaciones ──────────────────────────────────────────────────────

/** Crea una invitación (owner/admin). */
export async function createInvitation(
  userId: string,
  workspaceId: string,
  email: string,
  role: Role = "member"
) {
  await requireMembership(userId, workspaceId, "admin");
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) throw badRequest("invalid_email");
  if (role === "owner") throw badRequest("invalid_invite_role");

  // Si ya es miembro, no invitar.
  const existingUser = await prisma.user.findUnique({ where: { email: normalized } });
  if (existingUser) {
    const already = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
    });
    if (already) throw conflict("already_member");
  }

  const token = randomBytes(24).toString("hex");
  const invitation = await prisma.invitation.create({
    data: {
      workspaceId,
      email: normalized,
      role,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  // Enlace de aceptación (ruta del frontend). Se envía por correo y también se
  // devuelve para que el owner pueda compartirlo manualmente si hace falta.
  const acceptUrl = `${env.WEB_ORIGIN}/invite/${token}`;

  // Envío best-effort: un fallo de correo no debe tumbar la invitación.
  const [workspace, inviter, recipient] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, locale: true } }),
    prisma.user.findUnique({ where: { email: normalized }, select: { locale: true } }),
  ]);
  const { delivered, previewUrl } = await sendInvitationEmail({
    to: normalized,
    acceptUrl,
    workspaceName: workspace?.name ?? "un workspace",
    inviterName: inviter?.name ?? inviter?.email ?? "Alguien",
    role,
    // Si la persona ya existe, gana su preferencia. Para un email nuevo se
    // usa la del invitador; ambos casos conservan español como default.
    locale: (recipient?.locale ?? inviter?.locale ?? "es") as "es" | "en",
  });

  return { ...invitation, acceptUrl, emailDelivered: delivered, emailPreviewUrl: previewUrl };
}

/** Lista invitaciones pendientes (owner/admin). */
export async function listInvitations(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId, "admin");
  return prisma.invitation.findMany({
    where: { workspaceId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

/** Revoca una invitación (owner/admin). */
export async function revokeInvitation(userId: string, invitationId: string) {
  const invite = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invite) throw notFound("invitation_not_found");
  await requireMembership(userId, invite.workspaceId, "admin");
  return prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "revoked" },
  });
}

/**
 * Acepta una invitación por token: crea la membresía para el usuario actual
 * y marca la invitación como aceptada. El email debe coincidir.
 */
export async function acceptInvitation(userId: string, token: string) {
  const invite = await prisma.invitation.findUnique({ where: { token } });
  if (!invite || invite.status !== "pending") throw notFound("invalid_invitation");
  if (invite.expiresAt.getTime() < Date.now())
    throw badRequest("invite_expired");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("user_not_found");
  if (user.email.toLowerCase() !== invite.email.toLowerCase())
    throw forbidden("invitation_email_mismatch");

  const existing = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
  });

  await prisma.$transaction([
    prisma.invitation.update({ where: { id: invite.id }, data: { status: "accepted" } }),
    ...(existing
      ? []
      : [
          prisma.membership.create({
            data: { userId, workspaceId: invite.workspaceId, role: invite.role },
          }),
        ]),
  ]);

  return prisma.workspace.findUnique({ where: { id: invite.workspaceId } });
}

/** Detalle público de una invitación por token (para la pantalla de aceptar). */
export async function getInvitationByToken(token: string) {
  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: { workspace: { select: { name: true, slug: true } } },
  });
  if (!invite || invite.status !== "pending") throw notFound("invalid_invitation");
  return {
    email: invite.email,
    role: invite.role as Role,
    workspace: invite.workspace,
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt.getTime() < Date.now(),
  };
}

// ─── Proyectos ─────────────────────────────────────────────────────────

/** Crea un proyecto dentro de un workspace (owner/admin/member). */
export async function createProject(
  userId: string,
  workspaceId: string,
  input: { name: string; description?: string; key?: string }
) {
  await requireMembership(userId, workspaceId, "member");
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("name_too_short");
  const slug = await uniqueSlug(name, async (s) =>
    Boolean(await prisma.project.findUnique({ where: { workspaceId_slug: { workspaceId, slug: s } } }))
  );
  const key = (input.key?.trim() || name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, "") || "PRJ";
  return prisma.project.create({
    data: {
      workspaceId,
      name,
      slug,
      description: input.description?.trim() || null,
      key,
    },
  });
}

/** Lista proyectos de un workspace (requiere ser miembro). */
export async function listProjects(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  return prisma.project.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      key: true,
      createdAt: true,
      _count: { select: { repos: true, userStories: true } },
    },
  });
}

/**
 * Devuelve un proyecto por slug dentro de un workspace-slug (requiere membresía).
 *
 * La membresía se exige con `minRole: "viewer"` (rank 0), que ninguna membresía
 * existente puede incumplir — así que el filtro `memberships: { some: { userId } }`
 * resuelve en una sola consulta lo que antes eran dos (workspace + requireMembership)
 * sin cambiar los mensajes de error: sigue siendo "Workspace no encontrado" tanto si
 * el workspace no existe como si el usuario no es miembro, igual que antes.
 */
export async function getProject(userId: string, workspaceSlug: string, projectSlug: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceSlug, memberships: { some: { userId } } },
    include: { memberships: { where: { userId }, select: { role: true } } },
  });
  if (!workspace) throw notFound("workspace_not_found");
  const project = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: projectSlug } },
  });
  if (!project) throw notFound("project_not_found");
  return {
    ...project,
    workspace: { name: workspace.name, slug: workspace.slug },
    role: workspace.memberships[0]!.role as Role,
  };
}
