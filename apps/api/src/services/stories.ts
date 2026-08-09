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
import { badRequest, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";
import * as board from "./board.js";
import type { CardActor } from "./board.js";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES: UserStoryStatus[] = ["backlog", "ready", "in_progress", "review", "done"];

// ─── Épicas ─────────────────────────────────────────────────────────────

/** Crea una épica en el proyecto (member+). */
export async function createEpic(
  userId: string,
  projectId: string,
  input: { title: string; description?: string }
) {
  await projectWithAccess(userId, projectId, "member");
  const title = input.title.trim();
  if (title.length < 2) throw badRequest("El título de la épica es muy corto", "invalid_title");
  return prisma.epic.create({
    data: { projectId, title, description: input.description?.trim() || null },
  });
}

/** Lista las épicas de un proyecto con su conteo de HUs (viewer+). */
export async function listEpics(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListEpics(projectId);
}

/** Operación (ya autorizada): lista las épicas de un proyecto. */
export function opListEpics(projectId: string) {
  return prisma.epic.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { stories: true } } },
  });
}

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
}

/** Actor que crea una HU: un usuario o un agente (F4 vía MCP). */
export interface StoryActor {
  createdById?: string | null;
  createdByAgentId?: string | null;
}

function validatePriority(p: string | undefined): string {
  if (p === undefined) return "medium";
  if (!PRIORITIES.includes(p as (typeof PRIORITIES)[number]))
    throw badRequest(`Prioridad inválida: ${p}`, "invalid_priority");
  return p;
}

function validateStatus(s: string | undefined): UserStoryStatus {
  if (s === undefined) return "backlog";
  if (!STATUSES.includes(s as UserStoryStatus))
    throw badRequest(`Estado inválido: ${s}`, "invalid_status");
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
      throw badRequest("El valor debe ser JSON válido, no un string plano", "invalid_json_field");
    }
  }
  return v as Prisma.InputJsonValue;
}

/** Verifica que el contributor exista y pertenezca al proyecto de la HU. */
async function validateAssignee(projectId: string, assigneeId: string) {
  const contributor = await prisma.contributor.findUnique({ where: { id: assigneeId } });
  if (!contributor || contributor.projectId !== projectId)
    throw badRequest("El asignado no pertenece al proyecto", "assignee_mismatch");
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
  if (!project) throw notFound("Proyecto no encontrado");
  const title = input.title.trim();
  if (title.length < 2) throw badRequest("El título de la HU es muy corto", "invalid_title");
  const priority = validatePriority(input.priority);
  const status = validateStatus(input.status);
  if (input.epicId) {
    const epic = await prisma.epic.findUnique({ where: { id: input.epicId } });
    if (!epic || epic.projectId !== projectId)
      throw badRequest("La épica no pertenece al proyecto", "epic_mismatch");
  }
  if (input.assigneeId) await validateAssignee(projectId, input.assigneeId);

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
          storyPoints: input.storyPoints ?? null,
          epicId: input.epicId ?? null,
          assigneeId: input.assigneeId ?? null,
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
  if (!story) throw badRequest("No se pudo asignar una key única a la HU", "key_collision");

  const cardActor: CardActor = actor.createdById
    ? { actorType: "user", actorId: actor.createdById }
    : { actorType: "agent", actorId: actor.createdByAgentId ?? null };
  // «PEM-13 · Título» es el formato que ya usaban las tarjetas creadas a mano:
  // la tarjeta se lee igual en el tablero venga de donde venga. `storyStatus`
  // decide la columna inicial: una HU que nace "in_progress" no puede aparecer
  // en Backlog.
  await board.opCreateCard(
    projectId,
    { title: `${story.key} · ${story.title}`, type: "story", userStoryId: story.id, storyStatus: status },
    cardActor
  );

  return story;
}

export interface ListStoriesFilter {
  status?: string;
  epicId?: string;
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
    },
    orderBy: { createdAt: "desc" },
    include: {
      epic: { select: { id: true, title: true } },
      assignee: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
    },
  });
}

/** Carga una HU cruda por id (para que el transporte valide su proyecto). */
export function getStoryById(storyId: string) {
  return prisma.userStory.findUnique({ where: { id: storyId } });
}

/** Detalle de una HU (viewer+). */
export async function getStory(userId: string, storyId: string) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("HU no encontrada");
  await projectWithAccess(userId, story.projectId);
  return story;
}

/** Actualiza una HU (member+). */
export async function updateStory(userId: string, storyId: string, patch: UpdateStoryInput) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("HU no encontrada");
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
  story: { id: string; projectId: string; status: string },
  patch: UpdateStoryInput,
  actor: CardActor = { actorType: "agent", actorId: null }
) {
  const data: Prisma.UserStoryUpdateInput = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 2) throw badRequest("El título de la HU es muy corto", "invalid_title");
    data.title = t;
  }
  if (patch.priority !== undefined) data.priority = validatePriority(patch.priority);
  const nextStatus = patch.status !== undefined ? validateStatus(patch.status) : undefined;
  if (nextStatus !== undefined) data.status = nextStatus;
  if (patch.storyPoints !== undefined) data.storyPoints = patch.storyPoints;
  if (patch.narrative !== undefined) data.narrative = asJson(patch.narrative);
  if (patch.acceptanceCriteria !== undefined) data.acceptanceCriteria = asJson(patch.acceptanceCriteria);
  if (patch.epicId !== undefined) {
    if (patch.epicId) {
      const epic = await prisma.epic.findUnique({ where: { id: patch.epicId } });
      if (!epic || epic.projectId !== story.projectId)
        throw badRequest("La épica no pertenece al proyecto", "epic_mismatch");
      data.epic = { connect: { id: patch.epicId } };
    } else {
      data.epic = { disconnect: true };
    }
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId) {
      await validateAssignee(story.projectId, patch.assigneeId);
      data.assignee = { connect: { id: patch.assigneeId } };
    } else {
      data.assignee = { disconnect: true };
    }
  }
  const updated = await prisma.userStory.update({ where: { id: story.id }, data });

  // El tablero es la otra cara del estado: si cambió de verdad, la tarjeta se va
  // a la columna que le toca (mismo patrón que opAssignStory con el assignee).
  if (nextStatus !== undefined && nextStatus !== story.status) {
    const card = await prisma.card.findUnique({ where: { userStoryId: story.id } });
    if (card) await board.opMoveCardToStatus(card, nextStatus, actor);
  }

  return updated;
}

/** Elimina una HU (member+). */
export async function deleteStory(userId: string, storyId: string, options: DeleteStoryOptions = {}) {
  const story = await getStoryById(storyId);
  if (!story) throw notFound("HU no encontrada");
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
  story: { id: string },
  { deleteCard = true }: DeleteStoryOptions = {}
) {
  try {
    // En una transacción: un borrado a medias dejaría justo la tarjeta huérfana
    // que este cambio viene a evitar. `deleteMany` en vez de `delete` porque no
    // lanza P2025 con cero filas: si alguien se llevó la tarjeta con delete_card
    // entre medio, la HU se borra igual y el 404 de abajo sigue significando lo
    // que dice — que la HU no está, no que faltaba su tarjeta.
    return await prisma.$transaction(async (tx) => {
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
      throw notFound("HU no encontrada");
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
  if (!story) throw notFound("HU no encontrada");
  if (assigneeId) await validateAssignee(story.projectId, assigneeId);

  const updated = await prisma.userStory.update({
    where: { id: story.id },
    data: { assigneeId },
  });

  const card = await prisma.card.findUnique({ where: { userStoryId: story.id } });
  if (card) await board.opAssignCard(card, assigneeId, actor);

  return updated;
}

/** Lista los contribuidores del proyecto, candidatos a asignar HUs/tarjetas (viewer+). */
export async function listContributors(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListContributors(projectId);
}

/** Operación (ya autorizada): lista los contribuidores del proyecto. */
export function opListContributors(projectId: string) {
  return prisma.contributor.findMany({
    where: { projectId },
    orderBy: { githubLogin: "asc" },
    select: { id: true, githubLogin: true, name: true, avatarUrl: true },
  });
}

/**
 * Cuenta y lista los commits del proyecto cuyo mensaje referencia la key de la
 * HU (ej. PRJ-123).
 *
 * El match va por regex y no por `contains`: como substring, «PEM-1» también
 * aparece dentro de «PEM-19», así que cada HU de un dígito se quedaba con el
 * avance de todas sus vecinas de dos. `\y` es la frontera de palabra de
 * Postgres — exige que la key termine donde termina su número, y deja pasar
 * paréntesis, dos puntos o fin de línea alrededor. `~*` conserva el match sin
 * distinguir mayúsculas que traía `mode: "insensitive"`.
 */
export async function opGetStoryCommitProgress(story: { id: string; projectId: string; key: string }) {
  const commits = await prisma.$queryRaw<
    Array<{ id: string; sha: string; message: string; committedAt: Date }>
  >`
    SELECT "id", "sha", "message", "committedAt"
    FROM "commits"
    WHERE "projectId" = ${story.projectId}
      AND "message" ~* ('\\y' || ${story.key} || '\\y')
    ORDER BY "committedAt" DESC
  `;
  return { storyId: story.id, key: story.key, commitCount: commits.length, commits };
}