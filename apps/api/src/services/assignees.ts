// Candidatos asignables a una HU/Card: contributors reales del proyecto
// (identidad de GitHub, creada al ingerir commits) + miembros del workspace
// que todavía no tienen contributor en este proyecto. `assigneeId` sigue
// apuntando siempre a `Contributor.id`; un miembro sin contributor se
// resuelve a una fila sintética recién en el momento de asignar.

import { prisma } from "../db.js";
import { badRequest } from "./errors.js";
import { projectWithAccess } from "./ingest.js";
import { resolveContributorRecipients } from "./notifications.js";

const MEMBER_ASSIGNEE_PREFIX = "member:";

function isVirtualMemberAssigneeId(id: string): boolean {
  return id.startsWith(MEMBER_ASSIGNEE_PREFIX);
}

function toVirtualMemberAssigneeId(userId: string): string {
  return `${MEMBER_ASSIGNEE_PREFIX}${userId}`;
}

/**
 * Resuelve un assigneeId de cliente a un Contributor.id real del proyecto.
 * Si es un id de Contributor, lo valida igual que antes. Si es un id
 * virtual "member:<userId>", confirma la membership en el workspace del
 * proyecto y hace upsert de un Contributor sintético ligado a ese userId.
 *
 * El email sintético queda siempre null: así la resolución de avisos
 * (resolveContributorRecipient) pasa por `contributor.userId`, no por
 * `githubLogin`, y revalida la membership en cada notificación en vez de
 * confiar en un dato copiado una sola vez.
 */
export async function resolveAssigneeId(projectId: string, assigneeId: string): Promise<string> {
  if (!isVirtualMemberAssigneeId(assigneeId)) {
    const contributor = await prisma.contributor.findUnique({ where: { id: assigneeId } });
    if (!contributor || contributor.projectId !== projectId)
      throw badRequest("assignee_mismatch");
    return contributor.id;
  }

  const userId = assigneeId.slice(MEMBER_ASSIGNEE_PREFIX.length);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw badRequest("assignee_mismatch");
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
  });
  if (!membership) throw badRequest("assignee_mismatch");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, avatarUrl: true, email: true } });
  // Fallback al local-part del email cuando el User no puso nombre: evita
  // que el board/ContributorsTab terminen mostrando el githubLogin sintético crudo.
  const displayName = user?.name ?? user?.email.split("@")[0] ?? null;
  const githubLogin = toVirtualMemberAssigneeId(userId);

  const contributor = await prisma.contributor.upsert({
    where: { projectId_githubLogin: { projectId, githubLogin } },
    update: { userId, name: displayName ?? undefined, avatarUrl: user?.avatarUrl ?? undefined },
    create: { projectId, githubLogin, userId, name: displayName, avatarUrl: user?.avatarUrl ?? null, email: null },
  });
  return contributor.id;
}

export interface AssigneeCandidate {
  id: string;
  origin: "contributor" | "member";
  userId: string | null;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  notify: "member" | "external" | "none";
}

/** Candidatos asignables del proyecto (viewer+). */
export async function listAssignableCandidates(userId: string, projectId: string) {
  const project = await projectWithAccess(userId, projectId);
  return opListAssignableCandidates(project.id, project.workspaceId);
}

/**
 * Operación (ya autorizada): contributors del proyecto + members del
 * workspace sin contributor todavía, deduplicados por userId. Los de origen
 * "member" llevan un id virtual "member:<userId>" — se persisten como
 * Contributor recién si se los asigna (ver resolveAssigneeId).
 */
export async function opListAssignableCandidates(
  projectId: string,
  workspaceId: string
): Promise<AssigneeCandidate[]> {
  const [contributors, memberships] = await Promise.all([
    prisma.contributor.findMany({
      where: { projectId },
      orderBy: { githubLogin: "asc" },
      select: { id: true, githubLogin: true, name: true, avatarUrl: true, email: true, userId: true },
    }),
    prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const recipients = await resolveContributorRecipients(workspaceId, contributors);
  const contributorUserIds = new Set(contributors.filter((c) => c.userId).map((c) => c.userId as string));

  const contributorCandidates: AssigneeCandidate[] = contributors.map((c) => {
    const resolution = recipients.get(c.id)?.recipient ?? null;
    return {
      id: c.id,
      origin: "contributor",
      userId: c.userId,
      githubLogin: c.githubLogin,
      name: c.name,
      avatarUrl: c.avatarUrl,
      email: c.email,
      notify: resolution ? (resolution.isMember ? "member" : "external") : "none",
    };
  });

  const memberCandidates: AssigneeCandidate[] = memberships
    .filter((m) => !contributorUserIds.has(m.userId))
    .map((m) => ({
      id: toVirtualMemberAssigneeId(m.userId),
      origin: "member",
      userId: m.userId,
      githubLogin: null,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      email: m.user.email,
      notify: "member",
    }));

  return [...contributorCandidates, ...memberCandidates];
}
