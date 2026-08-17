// Servicio del flujo "Hermes generalizado" (F3): objetivo del proyecto,
// informes de avance (manuales o publicados por agentes en F4) y notas
// (feedback humano que se responde y puede colgarse de un informe).
//
// Reutiliza el control de acceso por proyecto de ./ingest (projectWithAccess)
// y se apoya en los commits ingestados en F2 para calcular métricas.

import { Prisma } from "@prisma/client";
import type { DayMetrics, ReportScope } from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

export type { DayMetrics };

// ─── Objetivo ──────────────────────────────────────────────────────────────

/** Objetivo actual del proyecto (o null si no se ha fijado). Viewer+. */
export async function getObjective(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opGetObjective(projectId);
}

/** Operación (ya autorizada): lee el objetivo del proyecto. */
export function opGetObjective(projectId: string) {
  return prisma.objective.findUnique({ where: { projectId } });
}

/**
 * Fija/actualiza el objetivo del proyecto (member+). Guarda además una entrada
 * en el historial para poder ver cómo evolucionó la meta.
 */
export async function setObjective(userId: string, projectId: string, description: string) {
  await projectWithAccess(userId, projectId, "member");
  return opSetObjective(projectId, description, userId);
}

/**
 * Operación (ya autorizada): upsert del objetivo + entrada de historial.
 * `updatedById` es el User que lo cambió, o null si lo cambió un agente (F4).
 */
export async function opSetObjective(
  projectId: string,
  description: string,
  updatedById: string | null
) {
  const desc = description.trim();
  if (desc.length < 3) throw badRequest("invalid_objective");

  const [objective] = await prisma.$transaction([
    prisma.objective.upsert({
      where: { projectId },
      update: { description: desc, updatedById },
      create: { projectId, description: desc, updatedById },
    }),
    prisma.objectiveHistory.create({
      data: { projectId, description: desc, updatedById },
    }),
  ]);
  return objective;
}

/** Historial de cambios del objetivo, más reciente primero. Viewer+. */
export async function listObjectiveHistory(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opListObjectiveHistory(projectId);
}

/** Operación (ya autorizada): historial de cambios del objetivo. */
export function opListObjectiveHistory(projectId: string) {
  return prisma.objectiveHistory.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { updatedBy: { select: { id: true, name: true, email: true } } },
  });
}

// ─── Informes ────────────────────────────────────────────────────────────

/** Carga un informe (con su proyecto) verificando acceso del usuario. */
async function reportWithAccess(userId: string, reportId: string, minRole: "viewer" | "member" | "admin" = "viewer") {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw notFound("report_not_found");
  await projectWithAccess(userId, report.projectId, minRole);
  return report;
}

/**
 * Métricas deterministas de un día: commits ingestados (total, por dominio,
 * contribuidores) + actividad de tablero (`CardActivity` action "moved").
 * Un moved con `userStoryId` es cambio de estado de HU; sin él, movimiento
 * genérico de tarjeta. Devuelve null solo si la fecha no es un día válido.
 */
export async function computeDayMetrics(
  projectId: string,
  date: string
): Promise<DayMetrics | null> {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const [commits, moves] = await Promise.all([
    prisma.commit.findMany({
      where: { projectId, committedAt: { gte: start, lt: end } },
      select: { domain: true, contributorId: true },
    }),
    // CardActivity no tiene projectId: se filtra por card.board.projectId.
    prisma.cardActivity.findMany({
      where: {
        action: "moved",
        createdAt: { gte: start, lt: end },
        card: { board: { projectId } },
      },
      select: { card: { select: { userStoryId: true } } },
    }),
  ]);

  const byDomain: Record<string, number> = {};
  const contributors = new Set<string>();
  for (const c of commits) {
    byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    contributors.add(c.contributorId);
  }

  let cardMoves = 0;
  let storyStatusChanges = 0;
  for (const m of moves) {
    if (m.card.userStoryId != null) storyStatusChanges += 1;
    else cardMoves += 1;
  }

  return {
    commits: commits.length,
    contributors: contributors.size,
    byDomain,
    cardMoves,
    storyStatusChanges,
  };
}

export interface PublishReportInput {
  date?: string; // YYYY-MM-DD para scope "day"; se ignora en "general"
  slot?: string;
  scope?: ReportScope;
  comment?: string;
  verdict?: string;
  score?: number;
  metrics?: unknown; // si no se pasa y es "day", se calculan server-side (DayMetrics)
  agentId?: string; // sólo lo setea la interfaz MCP (F4); en REST va null
}

/**
 * Publica un informe (member+). Idempotente por (projectId, date, slot): volver
 * a publicar el mismo día/slot actualiza el informe existente. Para informes de
 * día sin métricas explícitas, las calcula server-side (commits + actividad de
 * tablero del día).
 */
export async function publishReport(userId: string, projectId: string, input: PublishReportInput) {
  await projectWithAccess(userId, projectId, "member");
  return opPublishReport(projectId, input);
}

/** Operación (ya autorizada): publica/actualiza el informe. Ver `publishReport`. */
export async function opPublishReport(projectId: string, input: PublishReportInput) {
  const scope: ReportScope = input.scope ?? "day";
  const date = (input.date?.trim() || (scope === "general" ? "todos" : "")).trim();
  if (scope === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw badRequest("invalid_date");
  const slot = input.slot?.trim() || "manual";

  if (input.score != null && (input.score < 0 || input.score > 100)) throw badRequest("invalid_score");

  let metrics = input.metrics ?? undefined;
  if (metrics === undefined && scope === "day") {
    metrics = (await computeDayMetrics(projectId, date)) ?? undefined;
  }

  const data = {
    scope,
    comment: input.comment?.trim() || null,
    verdict: input.verdict?.trim() || null,
    score: input.score ?? null,
    // Json nullable: SQL NULL se pasa como Prisma.JsonNull, no como null crudo.
    metrics: metrics == null ? Prisma.JsonNull : (metrics as unknown as Prisma.InputJsonValue),
    agentId: input.agentId ?? null,
  };

  return prisma.report.upsert({
    where: { projectId_date_slot: { projectId, date, slot } },
    update: data,
    create: { projectId, date, slot, ...data },
  });
}

export interface ListReportsFilter {
  scope?: ReportScope;
  limit?: number;
}

/** Lista informes de un proyecto, más recientes primero (viewer+). */
export async function listReports(userId: string, projectId: string, filter: ListReportsFilter = {}) {
  await projectWithAccess(userId, projectId);
  return opListReports(projectId, filter);
}

/** Operación (ya autorizada): lista informes del proyecto. */
export function opListReports(projectId: string, filter: ListReportsFilter = {}) {
  const take = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return prisma.report.findMany({
    where: { projectId, ...(filter.scope ? { scope: filter.scope } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      agent: { select: { id: true, name: true } },
      _count: { select: { notes: true } },
    },
  });
}

/** Detalle de un informe con sus notas asociadas (viewer+). */
export async function getReport(userId: string, reportId: string) {
  const report = await reportWithAccess(userId, reportId);
  const notes = await prisma.note.findMany({
    where: { reportId: report.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  return { ...report, notes };
}

/** Elimina un informe (admin+). */
export async function deleteReport(userId: string, reportId: string) {
  const report = await reportWithAccess(userId, reportId, "admin");
  await prisma.report.delete({ where: { id: report.id } });
  return { ok: true };
}

// ─── Notas ─────────────────────────────────────────────────────────────────

/** Carga una nota (con su proyecto) verificando acceso del usuario. */
async function noteWithAccess(userId: string, noteId: string, minRole: "viewer" | "member" | "admin" = "viewer") {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw notFound("note_not_found");
  await projectWithAccess(userId, note.projectId, minRole);
  return note;
}

export interface ListNotesFilter {
  status?: "pending" | "processed";
  limit?: number;
}

/** Lista notas de un proyecto, más recientes primero (viewer+). */
export async function listNotes(userId: string, projectId: string, filter: ListNotesFilter = {}) {
  await projectWithAccess(userId, projectId);
  return opListNotes(projectId, filter);
}

/** Operación (ya autorizada): lista notas del proyecto. */
export function opListNotes(projectId: string, filter: ListNotesFilter = {}) {
  const take = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return prisma.note.findMany({
    where: { projectId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: { author: { select: { id: true, name: true, email: true } } },
  });
}

/** Crea una nota/feedback en el proyecto (member+). Queda `pending`. */
export async function createNote(userId: string, projectId: string, message: string) {
  await projectWithAccess(userId, projectId, "member");
  return opCreateNote(projectId, message, userId);
}

/** Operación (ya autorizada): crea una nota. `authorId` null si la crea un agente. */
export function opCreateNote(projectId: string, message: string, authorId: string | null) {
  const msg = message.trim();
  if (msg.length < 1) throw badRequest("empty_note");
  return prisma.note.create({ data: { projectId, authorId, message: msg } });
}

/** Carga una nota cruda por id (para que el transporte valide su proyecto). */
export function getNoteById(noteId: string) {
  return prisma.note.findUnique({ where: { id: noteId } });
}

/**
 * Responde una nota (member+): guarda la respuesta, la marca `processed` y
 * opcionalmente la asocia a un informe. Reutilizable por el agente vía MCP (F4).
 */
export async function answerNote(
  userId: string,
  noteId: string,
  response: string,
  reportId?: string
) {
  const note = await noteWithAccess(userId, noteId, "member");
  return opAnswerNote(note, response, reportId);
}

/**
 * Operación (ya autorizada): guarda la respuesta a una nota ya cargada. El
 * informe opcional debe pertenecer al mismo proyecto que la nota.
 */
export async function opAnswerNote(
  note: { id: string; projectId: string; reportId: string | null },
  response: string,
  reportId?: string
) {
  const resp = response.trim();
  if (resp.length < 1) throw badRequest("empty_response");

  if (reportId) {
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report || report.projectId !== note.projectId) throw badRequest("report_mismatch");
  }

  return prisma.note.update({
    where: { id: note.id },
    data: {
      response: resp,
      status: "processed",
      processedAt: new Date(),
      reportId: reportId ?? note.reportId,
    },
  });
}
