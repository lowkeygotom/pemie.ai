// Servicio F5: épicas e Historias de Usuario (HUs). El modelo canónico de una
// HU (narrativa role/want/benefit + criterios de aceptación Given/When/Then)
// vive en @pemie/shared. Las HUs se crean manualmente (REST) o las "genera" un
// agente vía MCP (create_user_story) — misma capa de servicios.

import { Prisma } from "@prisma/client";
import type {
  UserStoryStatus,
  UserStoryNarrative,
  AcceptanceCriterion,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { commitSubjectMatchesKey } from "./commit-keys.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";
import { normalizeEmail, requireMembership } from "./tenancy.js";
import * as board from "./board.js";
import type { CardActor } from "./board.js";
import { notifyStoryAssigned, resolveContributorRecipients } from "./notifications.js";
import { resolveAssigneeId } from "./assignees.js";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES: UserStoryStatus[] = ["backlog", "ready", "in_progress", "review", "done"];

// ─── Historias de Usuario ───────────────────────────────────────────────

export interface CreateStoryInput {
  title: string;
  narrative?: UserStoryNarrative;
  acceptanceCriteria?: AcceptanceCriterion[];
  priority?: string;
  storyPoints?: number;
  epicId?: string;
  assigneeId?: string;
  status?: string;
  isEpic?: boolean;
}

export interface UpdateStoryInput {
  title?: string;
  narrative?: UserStoryNarrative | null;
  acceptanceCriteria?: AcceptanceCriterion[];
  priority?: string;
  storyPoints?: number | null;
  status?: string;
  epicId?: string | null;
  assigneeId?: string | null;
  isEpic?: boolean;
}

/** Actor que crea una HU: un usuario o un agente (F4 vía MCP). */
export interface StoryActor {
  createdById?: string | null;
  createdByAgentId?: string | null;
}

function validatePriority(p: string | undefined): string {
  if (p === undefined) return "medium";
  if (!PRIORITIES.includes(p as (typeof PRIORITIES)[number]))
    throw badRequest("invalid_priority", { priority: p });
  return p;
}

function validateStatus(s: string | undefined): UserStoryStatus {
  if (s === undefined) return "backlog";
  if (!STATUSES.includes(s as UserStoryStatus))
    throw badRequest("invalid_status", { status: s });
  return s as UserStoryStatus;
}

// MCP no valida el shape de `narrative`/`acceptanceCriteria` contra un schema
// estricto: un agente puede mandarlos ya serializados como string. Sin este
// parseo, ese string se guardaba tal cual en la columna Json en vez de como
// array/objeto real.
function asJson(v: unknown) {
  if (v == null) return Prisma.JsonNull;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Prisma.InputJsonValue;
    } catch {
      throw badRequest("invalid_json_field");
    }
  }
  return v as Prisma.InputJsonValue;
}

/**
 * Reserva la siguiente key (PRJ-N) consumiendo el contador del proyecto.
 *
 * El contador vive en `projects.storySeq` y solo crece: derivarlo del máximo de
 * las HUs vivas devolvía la key al pool al borrar la HU más alta, y una key
 * reutilizada le roba a la HU nueva los commits de la anterior —
 * `opGetStoryCommitProgress` busca por el texto de la key, no por id.
 * El `increment` de Postgres es atómico, así que dos creaciones concurrentes
 * reservan números distintos sin bloquear.
 */
async function nextStoryKey(projectId: string, prefix: string): Promise<string> {
  const { storySeq } = await prisma.project.update({
    where: { id: projectId },
    data: { storySeq: { increment: 1 } },
    select: { storySeq: true },
  });
  return `${prefix}-${storySeq}`;
}

/**
 * Valida que `epicId` sea una épica vinculable dentro de `projectId`, en el
 * mismo orden que espera quien la llama: self-vínculo, épica-dentro-de-épica,
 * épica de otro proyecto (o inexistente) y, por último, que el target sea de
 * verdad una épica. PEM-57: epicId es una auto-relación a un solo nivel — una
 * épica nunca puede colgar de otra épica.
 */
async function assertLinkableEpic(
  projectId: string,
  epicId: string,
  self?: { id: string; isEpic: boolean }
): Promise<void> {
  if (self?.isEpic) throw badRequest("epic_cannot_have_epic");
  if (self?.id === epicId) throw badRequest("epic_mismatch");
  const epic = await prisma.userStory.findUnique({ where: { id: epicId } });
  if (!epic || epic.projectId !== projectId) throw badRequest("epic_mismatch");
  if (!epic.isEpic) throw badRequest("not_an_epic");
}

/** Crea una HU (member+). */
export async function createStory(userId: string, projectId: string, input: CreateStoryInput) {
  await projectWithAccess(userId, projectId, "member");
  return opCreateStory(projectId, input, { createdById: userId });
}

/**
 * Operación (ya autorizada): crea la HU con una key incremental por proyecto
 * y su tarjeta Kanban ya ligada (columna inicial del tablero), para que nunca
 * quede una HU huérfana sin tarjeta ni haga falta el paso manual de
 * create_card/link_story_to_card. El reintento cubre el caso residual de una
 * key ya ocupada que el contador del proyecto no conocía (datos anteriores a
 * PEM-20): cada vuelta reserva un número nuevo, nunca el mismo.
 */
export async function opCreateStory(
  projectId: string,
  input: CreateStoryInput,
  actor: StoryActor
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("project_not_found");
  const title = input.title.trim();
  if (title.length < 2) throw badRequest("story_title_too_short");
  const priority = validatePriority(input.priority);
  const status = validateStatus(input.status);
  const isEpic = input.isEpic ?? false;
  // Rechazado antes de tocar la DB: una épica agrupa HUs, no puede pertenecer
  // a otra (D1/D4 del diseño de PEM-57).
  if (isEpic && input.epicId) throw badRequest("epic_cannot_have_epic");
  if (isEpic && input.storyPoints != null) throw badRequest("epic_has_no_points");
  if (input.epicId) await assertLinkableEpic(projectId, input.epicId);
  const resolvedAssigneeId = input.assigneeId ? await resolveAssigneeId(projectId, input.assigneeId) : null;

  let story: Awaited<ReturnType<typeof prisma.userStory.create>> | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = await nextStoryKey(projectId, project.key);
    try {
      story = await prisma.userStory.create({
        data: {
          projectId,
          key,
          title,
          narrative: asJson(input.narrative),
          acceptanceCriteria: asJson(input.acceptanceCriteria),
          priority,
          status,
          storyPoints: isEpic ? null : (input.storyPoints ?? null),
          isEpic,
          epicId: input.epicId ?? null,
          assigneeId: resolvedAssigneeId,
          createdById: actor.createdById ?? null,
          createdByAgentId: actor.createdByAgentId ?? null,
        },
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  if (!story) throw badRequest("key_collision");

  const cardActor: CardActor = actor.createdById
    ? { actorType: "user", actorId: actor.createdById }
    : { actorType: "agent", actorId: actor.createdByAgentId ?? null };
  // Una épica no es un ítem de trabajo del tablero: no crea tarjeta (D2). El
  // resto de la HU (assignee, notificación) sí aplica igual que a una normal.
  if (!isEpic) {
    // «PEM-13 · Título» es el formato que ya usaban las tarjetas creadas a mano:
    // la tarjeta se lee igual en el tablero venga de donde venga. `storyStatus`
    // decide la columna inicial: una HU que nace "in_progress" no puede aparecer
    // en Backlog.
    await board.opCreateCard(
      projectId,
      { title: `${story.key} · ${story.title}`, type: "story", userStoryId: story.id, storyStatus: status },
      cardActor
    );
  }

  if (story.assigneeId) await notifyStoryAssigned({ storyId: story.id, assigneeId: story.assigneeId, actor: cardActor });

  return story;
}

export interface ListStoriesFilter {
  status?: string;
  epicId?: string;
  isEpic?: boolean;
}

/** Lista HUs de un proyecto (viewer+). */
export async function listStories(userId: string, projectId: string, filter: ListStoriesFilter = {}) {
  await projectWithAccess(userId, projectId);
  return opListStories(projectId, filter);
}

/** Operación (ya autorizada): lista HUs del proyecto. */
export function opListStories(projectId: string, filter: ListStoriesFilter = {}) {
  return prisma.userStory.findMany({
    where: {
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.epicId ? { epicId: filter.epicId } : {}),
      ...(filter.isEpic !== undefined ? { isEpic: filter.isEpic } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      epic: { select: { id: true, title: true } },
      assignee: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
      // Conteo de hijas: la UI lo necesita para una épica sin cargar la lista
      // completa (que ya trae opGetStoryDetail cuando hace falta el detalle).
      _count: { select: { children: true } },
    },
  });
}

/** Carga una HU cruda por id (para que el transporte valide su proyecto). */
export function getStoryById(storyId: string) {
  return prisma.userStory.findUnique({ where: { id: storyId } });
}

/**
 * Detalle enriquecido de una HU ya cargada: si es una épica, trae sus hijas
 * (para mostrarlas sin una segunda llamada a list_user_stories?epicId=); si
 * es una HU normal, trae la épica padre (id/key/title, no su lista de hijas).
 * Las dos formas son mutuamente excluyentes: una HU normal nunca tiene hijas.
 */
export async function opGetStoryDetail(story: { id: string; epicId: string | null; isEpic: boolean }) {
  if (story.isEpic) {
    const children = await prisma.userStory.findMany({
      where: { epicId: story.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, key: true, title: true, status: true, priority: true, assignee: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } } },
    });
    return { ...story, children };
  }
  const epic = story.epicId
    ? await prisma.userStory.findUnique({ where: { id: story.epicId }, select: { id: true, key: true, title: true } })
    : null;
  return { ...story, epic };
}

/** Detalle de una HU (viewer+). */
export async function getStory(userId: string, storyId: string) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("story_not_found");
  await projectWithAccess(userId, story.projectId);
  return opGetStoryDetail(story);
}

/** Actualiza una HU (member+). */
export async function updateStory(userId: string, storyId: string, patch: UpdateStoryInput) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("story_not_found");
  await projectWithAccess(userId, story.projectId, "member");
  return opUpdateStory(story, patch, { actorType: "user", actorId: userId });
}

/**
 * Operación (ya autorizada): aplica el patch a una HU ya cargada y, si cambió el
 * estado, arrastra su tarjeta a la columna correspondiente.
 *
 * `actor` cae en "agent" cuando el llamador no lo pasa: un movimiento sin
 * responsable identificable no debe hacerse pasar por decisión humana ante
 * `wasLastMovedByUser`, que congelaría la tarjeta frente al auto-move.
 */
export async function opUpdateStory(
  story: { id: string; projectId: string; status: string; isEpic: boolean; epicId: string | null },
  patch: UpdateStoryInput,
  actor: CardActor = { actorType: "agent", actorId: null }
) {
  const data: Prisma.UserStoryUpdateInput = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 2) throw badRequest("story_title_too_short");
    data.title = t;
  }
  if (patch.priority !== undefined) data.priority = validatePriority(patch.priority);
  const nextStatus = patch.status !== undefined ? validateStatus(patch.status) : undefined;
  if (nextStatus !== undefined) data.status = nextStatus;

  // Resueltos antes de escribir nada: una épica no puede pertenecer a otra
  // épica (D1/D4), sea porque ya lo era o porque este mismo patch la convierte.
  const nextIsEpic = patch.isEpic !== undefined ? patch.isEpic : story.isEpic;
  const nextEpicId = patch.epicId !== undefined ? patch.epicId : story.epicId;
  if (nextIsEpic && nextEpicId) throw badRequest("epic_cannot_have_epic");

  if (patch.storyPoints !== undefined) {
    if (nextIsEpic && patch.storyPoints != null) throw badRequest("epic_has_no_points");
    data.storyPoints = patch.storyPoints;
  } else if (patch.isEpic === true && !story.isEpic) {
    // Conversión normal→épica sin tocar storyPoints explícitamente: se limpia
    // igual, para no dejar puntos huérfanos en una fila que D3 dice que no
    // puede tenerlos.
    data.storyPoints = null;
  }

  if (patch.narrative !== undefined) data.narrative = asJson(patch.narrative);
  if (patch.acceptanceCriteria !== undefined) data.acceptanceCriteria = asJson(patch.acceptanceCriteria);

  // D4: normal→épica solo si no tiene ya una épica propia (epicId === null,
  // ya garantizado arriba); épica→normal solo si no le cuelga ninguna HU —
  // convertirla dejaría hijas apuntando a una fila que dejó de agrupar nada.
  if (patch.isEpic !== undefined && patch.isEpic !== story.isEpic) {
    if (!patch.isEpic) {
      const childCount = await prisma.userStory.count({ where: { epicId: story.id } });
      if (childCount > 0) throw conflict("epic_has_children", { count: childCount });
    }
    data.isEpic = patch.isEpic;
  }

  if (patch.epicId !== undefined) {
    if (patch.epicId) {
      await assertLinkableEpic(story.projectId, patch.epicId, { id: story.id, isEpic: nextIsEpic });
      data.epic = { connect: { id: patch.epicId } };
    } else {
      data.epic = { disconnect: true };
    }
  }
  // Se resuelve antes de cualquier escritura: un patch inválido tiene que
  // rechazarse entero, no después de guardar título o estado. El id ya
  // resuelto se reenvía a opAssignStory para no volver a resolverlo.
  const resolvedAssigneeId: string | null = patch.assigneeId
    ? await resolveAssigneeId(story.projectId, patch.assigneeId)
    : null;
  const updated = Object.keys(data).length
    ? await prisma.userStory.update({ where: { id: story.id }, data })
    : await getStoryById(story.id);
  if (!updated) throw notFound("story_not_found");

  // El tablero es la otra cara del estado: si cambió de verdad, la tarjeta se va
  // a la columna que le toca (mismo patrón que opAssignStory con el assignee).
  if (nextStatus !== undefined && nextStatus !== story.status) {
    const card = await prisma.card.findUnique({ where: { userStoryId: story.id } });
    if (card) await board.opMoveCardToStatus(card, nextStatus, actor);
  }

  return patch.assigneeId === undefined
    ? updated
    : opAssignStory(story.id, resolvedAssigneeId, actor);
}

/** Elimina una HU (member+). */
export async function deleteStory(userId: string, storyId: string, options: DeleteStoryOptions = {}) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("story_not_found");
  await projectWithAccess(userId, story.projectId, "member");
  return opDeleteStory(story, options);
}

export interface DeleteStoryOptions {
  /** Borrar también la tarjeta vinculada. Por defecto sí (PEM-19). */
  deleteCard?: boolean;
}

/**
 * Operación (ya autorizada): elimina la HU ya cargada y, salvo que se pida lo
 * contrario, su tarjeta del Kanban.
 *
 * La FK `cards.userStoryId` es `ON DELETE SET NULL`, así que sin este paso la
 * tarjeta sobrevive desvinculada. Eso tenía sentido cuando la tarjeta se creaba
 * a mano y borrarla habría tirado trabajo humano; desde PEM-13 nace sola con la
 * HU, de modo que conservarla ya no protege nada: deja una tarjeta huérfana con
 * una key en el título que el proyecto puede volver a emitir.
 *
 * `deleteCard: false` conserva el comportamiento anterior para quien quiera
 * quedarse con la tarjeta y su actividad.
 */
export async function opDeleteStory(
  story: { id: string; isEpic: boolean },
  { deleteCard = true }: DeleteStoryOptions = {}
) {
  try {
    // En una transacción: un borrado a medias dejaría justo la tarjeta huérfana
    // que este cambio viene a evitar. `deleteMany` en vez de `delete` porque no
    // lanza P2025 con cero filas: si alguien se llevó la tarjeta con delete_card
    // entre medio, la HU se borra igual y el 404 de abajo sigue significando lo
    // que dice — que la HU no está, no que faltaba su tarjeta.
    return await prisma.$transaction(async (tx) => {
      // Chequeado ANTES del delete: la FK epicId→user_stories es ON DELETE
      // RESTRICT, así que sin este paso Postgres igual lo impediría, pero con
      // un P2003 crudo en vez de un conflict legible con el conteo de hijas.
      if (story.isEpic) {
        const childCount = await tx.userStory.count({ where: { epicId: story.id } });
        if (childCount > 0) throw conflict("epic_has_children", { count: childCount });
      }
      const removed = deleteCard
        ? await tx.card.deleteMany({ where: { userStoryId: story.id } })
        : { count: 0 };
      await tx.userStory.delete({ where: { id: story.id } });
      return { ok: true, cardDeleted: removed.count > 0 };
    });
  } catch (err) {
    // Carrera: otro borrado concurrente ya se la llevó entre el findUnique y
    // el delete. Devolver 404 (no encontrada), no un 500 genérico.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      throw notFound("story_not_found");
    throw err;
  }
}

/**
 * Operación (ya autorizada): asigna (o desasigna, si `assigneeId` es null) una
 * HU a un contributor del proyecto. Si la HU tiene una Card vinculada, sincroniza
 * su assigneeId y registra la actividad en CardActivity.
 */
export async function opAssignStory(storyId: string, assigneeId: string | null, actor: CardActor) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("story_not_found");
  const resolvedAssigneeId = assigneeId ? await resolveAssigneeId(story.projectId, assigneeId) : null;

  if (story.assigneeId === resolvedAssigneeId) return story;

  const updated = await prisma.userStory.update({
    where: { id: story.id },
    data: { assigneeId: resolvedAssigneeId },
  });

  const card = await prisma.card.findUnique({ where: { userStoryId: story.id } });
  if (card) await board.opAssignCard(card, resolvedAssigneeId, actor);

  const assignmentNotification = await notifyStoryAssigned({ storyId: updated.id, assigneeId: resolvedAssigneeId, actor });
  return { ...updated, assignmentNotification };
}

/** Lista los contribuidores del proyecto, candidatos a asignar HUs/tarjetas (viewer+). */
export async function listContributors(userId: string, projectId: string) {
  const project = await projectWithAccess(userId, projectId);
  const membership = await requireMembership(userId, project.workspaceId);
  return opListContributors(projectId, membership.role === "owner" || membership.role === "admin");
}

/**
 * Batchea el correo sugerido (`suggestedEmail`) para contributors sin email:
 * el email que ya cargó otro proyecto del mismo workspace para el mismo
 * githubLogin. Antes era un `findFirst` por fila (N+1); acá es una sola
 * query para todos los logins sin email de la lista.
 */
async function loadSuggestedEmails(
  workspaceId: string,
  projectId: string,
  contributors: Array<{ email: string | null; githubLogin: string }>
): Promise<Map<string, string>> {
  const logins = [...new Set(contributors.filter((c) => !c.email).map((c) => c.githubLogin))];
  if (logins.length === 0) return new Map();
  const matches = await prisma.contributor.findMany({
    where: { githubLogin: { in: logins, mode: "insensitive" }, email: { not: null }, project: { workspaceId }, NOT: { projectId } },
    select: { githubLogin: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  const byLogin = new Map<string, string>();
  for (const m of matches) {
    const key = m.githubLogin.toLowerCase();
    if (!byLogin.has(key)) byLogin.set(key, m.email!);
  }
  return byLogin;
}

/** Operación (ya autorizada): lista los contribuidores del proyecto. */
export async function opListContributors(projectId: string, includeSuggestion = false) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) return [];
  const contributors = await prisma.contributor.findMany({
    where: { projectId },
    orderBy: { githubLogin: "asc" },
    select: { id: true, githubLogin: true, name: true, avatarUrl: true, email: true, userId: true },
  });
  const [recipients, suggestions] = await Promise.all([
    resolveContributorRecipients(project.workspaceId, contributors),
    includeSuggestion ? loadSuggestedEmails(project.workspaceId, projectId, contributors) : Promise.resolve(new Map<string, string>()),
  ]);
  return contributors.map((contributor) => {
    const resolution = recipients.get(contributor.id)?.recipient ?? null;
    return {
      id: contributor.id,
      githubLogin: contributor.githubLogin,
      name: contributor.name,
      avatarUrl: contributor.avatarUrl,
      email: contributor.email,
      notify: resolution ? (resolution.isMember ? "member" : "external") : "none",
      suggestedEmail: includeSuggestion ? suggestions.get(contributor.githubLogin.toLowerCase()) ?? null : null,
    };
  });
}

/** Guarda el correo explícito de un contributor (owner/admin). */
export async function updateContributorEmail(userId: string, contributorId: string, email: string | null) {
  const contributor = await prisma.contributor.findUnique({ where: { id: contributorId }, include: { project: { select: { workspaceId: true } } } });
  if (!contributor) throw notFound("contributor_not_found");
  await requireMembership(userId, contributor.project.workspaceId, "admin");
  const normalized = email === null ? null : normalizeEmail(email);
  if (normalized && !normalized.includes("@")) throw badRequest("invalid_email");
  if (normalized && normalized.endsWith("@users.noreply.github.com")) throw badRequest("placeholder_email");
  return prisma.contributor.update({ where: { id: contributorId }, data: { email: normalized } });
}

/**
 * Cuenta y lista los commits del proyecto cuyo asunto referencia la key de la
 * HU (ej. PRJ-123). La regla de correlación vive en `commit-keys.ts`, compartida
 * con la detección de drift para que el avance por HU y las alertas no puedan
 * discrepar.
 */
export async function opGetStoryCommitProgress(story: { id: string; projectId: string; key: string }) {
  const commits = await prisma.$queryRaw<
    Array<{ id: string; sha: string; message: string; committedAt: Date }>
  >`
    SELECT "id", "sha", "message", "committedAt"
    FROM "commits"
    WHERE "projectId" = ${story.projectId}
      AND ${commitSubjectMatchesKey(Prisma.sql`"message"`, Prisma.sql`${story.key}`)}
    ORDER BY "committedAt" DESC
  `;
  return { storyId: story.id, key: story.key, commitCount: commits.length, commits };
}
