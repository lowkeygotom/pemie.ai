// Notificaciones de producto. Esta capa resuelve destinatarios y reglas de
// negocio; mailer.ts conserva el transporte y las plantillas.

import { prisma } from "../db.js";
import { env } from "../env.js";
import { resolveActorNames } from "./actor.js";
import { sendStoryAssignedEmail, type SendResult } from "./mailer.js";
import type { CardActor } from "./board.js";

export type RecipientResolution =
  | { recipient: { id: string | null; email: string; isMember: boolean }; reason?: never }
  | { recipient: null; reason: "contributor_not_found" | "no_matching_member" | "no_email" | "placeholder_email" };

function isPlaceholderEmail(email: string) {
  return email.toLowerCase().endsWith("@users.noreply.github.com");
}

/**
 * Resuelve el usuario del contributor sin cruzar la frontera del workspace.
 * El backfill hace que los matches seguros por githubLogin se vuelvan directos
 * en las siguientes asignaciones, sin requerir una migración de datos.
 */
export async function resolveContributorRecipient(contributorId: string): Promise<RecipientResolution> {
  const contributor = await prisma.contributor.findUnique({
    where: { id: contributorId },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!contributor) return { recipient: null, reason: "contributor_not_found" };

  if (contributor.email) {
    if (isPlaceholderEmail(contributor.email)) return { recipient: null, reason: "placeholder_email" };
    const user = await prisma.user.findUnique({ where: { email: contributor.email }, select: { id: true } });
    const membership = user
      ? await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: contributor.project.workspaceId } } })
      : null;
    return { recipient: { id: user?.id ?? null, email: contributor.email, isMember: Boolean(membership) } };
  }

  const membership = { some: { workspaceId: contributor.project.workspaceId } };
  let user = contributor.userId
    ? await prisma.user.findFirst({
        where: { id: contributor.userId, memberships: membership },
        select: { id: true, email: true },
      })
    : null;

  if (!user) {
    user = await prisma.user.findFirst({
      where: { githubLogin: { equals: contributor.githubLogin, mode: "insensitive" }, memberships: membership },
      select: { id: true, email: true },
    });
    if (user && contributor.userId !== user.id)
      await prisma.contributor.update({ where: { id: contributor.id }, data: { userId: user.id } });
  }

  if (!user) {
    // Este lookup no se usa para resolver ni vincular: solo conserva el motivo
    // preciso cuando el login inferido pertenece a otra frontera de workspace.
    const globalMatch = await prisma.user.findFirst({
      where: { githubLogin: { equals: contributor.githubLogin, mode: "insensitive" } },
      select: { id: true },
    });
    return { recipient: null, reason: globalMatch ? "no_matching_member" : "no_email" };
  }
  if (isPlaceholderEmail(user.email)) return { recipient: null, reason: "placeholder_email" };
  return { recipient: { ...user, isMember: true } };
}

export type RecipientResolutionLite = {
  recipient: { id: string | null; email: string; isMember: boolean } | null;
};

/**
 * Versión batched de `resolveContributorRecipient`, sin efectos secundarios:
 * usada por lecturas (opListContributors) que no pueden degradar a un
 * `UPDATE` o a N+1 queries por fila. 3 queries fijas sin importar cuántos
 * contributors haya — el mismo patrón que `resolveActorNames` (actor.ts).
 *
 * No hace `prisma.contributor.update` (el backfill de userId por githubLogin
 * queda solo en la versión singular) ni reproduce el detalle de `reason`:
 * ningún llamador batched lo lee hoy — si hiciera falta, debe usar la
 * función singular.
 */
export async function resolveContributorRecipients(
  workspaceId: string,
  contributors: Array<{ id: string; email: string | null; userId: string | null; githubLogin: string }>
): Promise<Map<string, RecipientResolutionLite>> {
  const withEmail = contributors.filter(
    (c): c is typeof c & { email: string } => c.email !== null && !isPlaceholderEmail(c.email)
  );
  const placeholderIds = contributors
    .filter((c) => c.email !== null && isPlaceholderEmail(c.email))
    .map((c) => c.id);
  const withoutEmail = contributors.filter((c) => c.email === null);

  const emails = [...new Set(withEmail.map((c) => c.email))];
  const directUserIds = [...new Set(withoutEmail.filter((c) => c.userId).map((c) => c.userId as string))];
  const logins = [...new Set(withoutEmail.map((c) => c.githubLogin))];

  const [usersByEmail, usersByIdOrLogin] = await Promise.all([
    emails.length
      ? prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
      : Promise.resolve([] as Array<{ id: string; email: string }>),
    directUserIds.length || logins.length
      ? prisma.user.findMany({
          where: { OR: [{ id: { in: directUserIds } }, { githubLogin: { in: logins, mode: "insensitive" } }] },
          select: { id: true, email: true, githubLogin: true },
        })
      : Promise.resolve([] as Array<{ id: string; email: string; githubLogin: string | null }>),
  ]);

  const candidateUserIds = [...new Set([...usersByEmail.map((u) => u.id), ...usersByIdOrLogin.map((u) => u.id)])];
  const memberships = candidateUserIds.length
    ? await prisma.membership.findMany({
        where: { workspaceId, userId: { in: candidateUserIds } },
        select: { userId: true },
      })
    : [];
  const memberIds = new Set(memberships.map((m) => m.userId));

  const userByEmail = new Map(usersByEmail.map((u) => [u.email, u]));
  const userById = new Map(usersByIdOrLogin.map((u) => [u.id, u]));
  const userByLoginLower = new Map<string, (typeof usersByIdOrLogin)[number]>();
  for (const u of usersByIdOrLogin) {
    const key = u.githubLogin?.toLowerCase();
    if (key && !userByLoginLower.has(key)) userByLoginLower.set(key, u);
  }

  const result = new Map<string, RecipientResolutionLite>();
  for (const c of withEmail) {
    const user = userByEmail.get(c.email);
    result.set(c.id, {
      recipient: { id: user?.id ?? null, email: c.email, isMember: user ? memberIds.has(user.id) : false },
    });
  }
  for (const id of placeholderIds) result.set(id, { recipient: null });
  for (const c of withoutEmail) {
    const direct = c.userId ? userById.get(c.userId) : undefined;
    const matched = direct && memberIds.has(direct.id) ? direct : userByLoginLower.get(c.githubLogin.toLowerCase());
    const user = matched && memberIds.has(matched.id) ? matched : undefined;
    result.set(c.id, {
      recipient: user && !isPlaceholderEmail(user.email) ? { id: user.id, email: user.email, isMember: true } : null,
    });
  }
  return result;
}

export function storyAssignmentUrl(workspaceSlug: string, projectSlug: string, storyKey: string) {
  return `${env.WEB_ORIGIN}/w/${encodeURIComponent(workspaceSlug)}/p/${encodeURIComponent(
    projectSlug
  )}?tab=stories&story=${encodeURIComponent(storyKey)}`;
}

export type AssignmentNotificationResult =
  | { notified: true; delivered: boolean; previewUrl?: string; email: string; contentLite: boolean }
  | { notified: false; reason: string; email?: string };

/** Intenta notificar una asignación; sus fallos nunca revocan la asignación. */
export async function notifyStoryAssigned(opts: {
  storyId: string;
  assigneeId: string | null;
  actor: CardActor;
}): Promise<AssignmentNotificationResult> {
  if (!opts.assigneeId) return { notified: false, reason: "unassigned" };

  try {
    const [story, resolved] = await Promise.all([
      prisma.userStory.findUnique({
        where: { id: opts.storyId },
        select: {
          key: true,
          title: true,
          project: { select: { name: true, slug: true, workspace: { select: { slug: true } } } },
        },
      }),
      resolveContributorRecipient(opts.assigneeId),
    ]);
    if (!story) return { notified: false, reason: "story_not_found" };
    if (!resolved.recipient) {
      console.info(`[notifications] HU ${story.key}: sin destinatario (${resolved.reason})`);
      return { notified: false, reason: resolved.reason };
    }
    if (opts.actor.actorType === "user" && opts.actor.actorId === resolved.recipient.id)
      return { notified: false, reason: "self_assignment" };

    const previous = await prisma.assignmentNotification.findUnique({
      where: { storyId_contributorId: { storyId: opts.storyId, contributorId: opts.assigneeId } },
    });
    if (previous && Date.now() - previous.notifiedAt.getTime() < 15 * 60 * 1000)
      return { notified: false, reason: "recently_notified", email: resolved.recipient.email };

    const [actor] = await resolveActorNames([{ ...opts.actor, actorId: opts.actor.actorId ?? null }]);
    // El idioma del correo es el de quien lo recibe. Un contributor externo (sin
    // fila User) no tiene preferencia, así que cae al español por defecto.
    const recipientLocale = resolved.recipient.id
      ? (await prisma.user.findUnique({ where: { id: resolved.recipient.id }, select: { locale: true } }))?.locale
      : null;
    const result: SendResult = await sendStoryAssignedEmail({
      to: resolved.recipient.email,
      storyKey: story.key,
      storyTitle: story.title,
      projectName: story.project.name,
      assignerName: actor.actorName,
      storyUrl: storyAssignmentUrl(story.project.workspace.slug, story.project.slug, story.key),
      contentLite: !resolved.recipient.isMember,
      locale: recipientLocale === "en" ? "en" : "es",
    });
    await prisma.assignmentNotification.upsert({
      where: { storyId_contributorId: { storyId: opts.storyId, contributorId: opts.assigneeId } },
      create: { storyId: opts.storyId, contributorId: opts.assigneeId },
      update: { notifiedAt: new Date() },
    });
    return { notified: true, ...result, email: resolved.recipient.email, contentLite: !resolved.recipient.isMember };
  } catch (err) {
    console.error(`[notifications] No se pudo notificar la asignación de HU ${opts.storyId}:`, err);
    return { notified: false, reason: "notification_error" };
  }
}
