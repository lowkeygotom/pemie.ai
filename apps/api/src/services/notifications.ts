// Notificaciones de producto. Esta capa resuelve destinatarios y reglas de
// negocio; mailer.ts conserva el transporte y las plantillas.

import { prisma } from "../db.js";
import { env } from "../env.js";
import { resolveActorNames } from "./actor.js";
import { sendStoryAssignedEmail, type SendResult } from "./mailer.js";
import type { CardActor } from "./board.js";

export type RecipientResolution =
  | { recipient: { id: string; email: string }; reason?: never }
  | { recipient: null; reason: "contributor_not_found" | "no_matching_member" | "placeholder_email" };

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

  if (!user) return { recipient: null, reason: "no_matching_member" };
  if (isPlaceholderEmail(user.email)) return { recipient: null, reason: "placeholder_email" };
  return { recipient: user };
}

export function storyAssignmentUrl(workspaceSlug: string, projectSlug: string, storyKey: string) {
  return `${env.WEB_ORIGIN}/w/${encodeURIComponent(workspaceSlug)}/p/${encodeURIComponent(
    projectSlug
  )}?tab=stories&story=${encodeURIComponent(storyKey)}`;
}

export type AssignmentNotificationResult =
  | { notified: true; delivered: boolean; previewUrl?: string }
  | { notified: false; reason: string };

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

    const [actor] = await resolveActorNames([{ ...opts.actor, actorId: opts.actor.actorId ?? null }]);
    const result: SendResult = await sendStoryAssignedEmail({
      to: resolved.recipient.email,
      storyKey: story.key,
      storyTitle: story.title,
      projectName: story.project.name,
      assignerName: actor.actorName,
      storyUrl: storyAssignmentUrl(story.project.workspace.slug, story.project.slug, story.key),
    });
    return { notified: true, ...result };
  } catch (err) {
    console.error(`[notifications] No se pudo notificar la asignación de HU ${opts.storyId}:`, err);
    return { notified: false, reason: "notification_error" };
  }
}
