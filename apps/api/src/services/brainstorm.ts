import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BRAINSTORM_NODE_STATUSES,
  BRAINSTORM_NODE_TYPES,
  type BrainstormNodeStatus,
  type BrainstormNodeType,
  type BrainstormSessionStatus,
} from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

const ABANDONED_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_SEGMENT_LIMIT = 200;
const MAX_SEGMENT_LIMIT = 500;

export interface CreateSessionInput { title: string }
export interface ListSessionFilters { status?: BrainstormSessionStatus }
export interface SegmentInput {
  seq: number;
  speakerTag?: number | null;
  text: string;
  startMs: number;
  endMs: number;
}
export interface RenameSpeakerInput { label: string; contributorId?: string | null }
export interface UpdateNodeInput {
  title?: string;
  detail?: string | null;
  type?: BrainstormNodeType;
  status?: BrainstormNodeStatus;
}
export interface AttachAudioInput { url: string; bytes: number }

async function sessionWithAccess(userId: string, sessionId: string, minRole: "viewer" | "member" = "viewer", expectedProjectId?: string) {
  const session = await prisma.brainstormSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound("brainstorm_session_not_found");
  if (expectedProjectId && session.projectId !== expectedProjectId) throw notFound("brainstorm_session_not_found");
  await projectWithAccess(userId, session.projectId, minRole);
  return session;
}

function hashRecorderToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(rawToken: string, expectedHash: string | null) {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashRecorderToken(rawToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hideRecorderTokenHash<T extends { recorderTokenHash: string | null }>(row: T): Omit<T, "recorderTokenHash"> {
  const { recorderTokenHash: _secret, ...safe } = row;
  return safe;
}

export async function createSession(userId: string, projectId: string, input: CreateSessionInput) {
  await projectWithAccess(userId, projectId, "member");
  return opCreateSession(projectId, input, { userId });
}

export async function opCreateSession(projectId: string, input: CreateSessionInput, actor: { userId: string }) {
  const title = input.title.trim();
  if (title.length < 2) throw badRequest("invalid_brainstorm_title");
  const recorderToken = randomBytes(32).toString("base64url");
  const session = await prisma.brainstormSession.create({
    data: { projectId, title, startedById: actor.userId, recorderTokenHash: hashRecorderToken(recorderToken) },
  });
  return { session: hideRecorderTokenHash(session), recorderToken };
}

export async function listSessions(userId: string, projectId: string, filters: ListSessionFilters = {}) {
  await projectWithAccess(userId, projectId);
  return opListSessions(projectId, filters);
}

export async function opListSessions(projectId: string, filters: ListSessionFilters = {}) {
  await reapAbandonedSessions(projectId);
  const sessions = await prisma.brainstormSession.findMany({
    where: { projectId, status: filters.status },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { segments: true, nodes: true } } },
  });
  return sessions.map(hideRecorderTokenHash);
}

export async function getSession(userId: string, sessionId: string, expectedProjectId?: string) {
  const session = await sessionWithAccess(userId, sessionId, "viewer", expectedProjectId);
  await reapAbandonedSessions(session.projectId);
  return opGetSession(sessionId);
}

export async function opGetSession(sessionId: string) {
  const session = await prisma.brainstormSession.findUnique({
    where: { id: sessionId },
    include: {
      speakers: { orderBy: { speakerTag: "asc" } },
      nodes: { orderBy: { key: "asc" } },
      edges: true,
      proposals: { orderBy: { id: "asc" } },
    },
  });
  if (!session) throw notFound("brainstorm_session_not_found");
  return hideRecorderTokenHash(session);
}

export async function listSegments(userId: string, sessionId: string, options: { after?: number; limit?: number } = {}, expectedProjectId?: string) {
  await sessionWithAccess(userId, sessionId, "viewer", expectedProjectId);
  return opListSegments(sessionId, options);
}

export function opListSegments(sessionId: string, options: { after?: number; limit?: number } = {}) {
  if (options.after !== undefined && (!Number.isInteger(options.after) || options.after < -1)) {
    throw badRequest("invalid_brainstorm_segment");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw badRequest("invalid_brainstorm_segment");
  }
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_SEGMENT_LIMIT, 1), MAX_SEGMENT_LIMIT);
  return prisma.brainstormSegment.findMany({
    where: { sessionId, seq: { gt: options.after ?? -1 } },
    orderBy: { seq: "asc" },
    take: limit,
  });
}

function validateSegments(segments: SegmentInput[]) {
  if (segments.length === 0 || segments.length > MAX_SEGMENT_LIMIT) throw badRequest("invalid_brainstorm_segment");
  for (const segment of segments) {
    if (!Number.isInteger(segment.seq) || segment.seq < 0 || !segment.text.trim() ||
        !Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) ||
        segment.startMs < 0 || segment.endMs < segment.startMs) {
      throw badRequest("invalid_brainstorm_segment");
    }
  }
}

export async function appendSegments(userId: string, sessionId: string, recorderToken: string, segments: SegmentInput[], expectedProjectId?: string) {
  await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  return opAppendSegments(sessionId, recorderToken, segments);
}

export async function opAppendSegments(sessionId: string, recorderToken: string, segments: SegmentInput[]) {
  validateSegments(segments);
  return prisma.$transaction(async (tx) => {
    const session = await tx.brainstormSession.findUnique({ where: { id: sessionId } });
    if (!session) throw notFound("brainstorm_session_not_found");
    if (session.status !== "recording") throw conflict("brainstorm_session_not_recording");
    if (!tokenMatches(recorderToken, session.recorderTokenHash)) throw forbidden("invalid_brainstorm_recorder_token");
    const result = await tx.brainstormSegment.createMany({
      data: segments.map((segment) => ({ ...segment, text: segment.text.trim(), sessionId })),
      skipDuplicates: true,
    });
    const highWatermark = Math.max(session.segmentSeq, ...segments.map((segment) => segment.seq));
    await tx.brainstormSession.update({
      where: { id: sessionId },
      data: { lastRecorderBeatAt: new Date(), segmentSeq: highWatermark },
    });
    return { inserted: result.count };
  });
}

export async function renameSpeaker(userId: string, sessionId: string, speakerTag: number, input: RenameSpeakerInput, expectedProjectId?: string) {
  const session = await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  return opRenameSpeaker(session.projectId, sessionId, speakerTag, input);
}

export async function opRenameSpeaker(projectId: string, sessionId: string, speakerTag: number, input: RenameSpeakerInput) {
  const label = input.label.trim();
  if (!Number.isInteger(speakerTag) || speakerTag < 0 || !label) throw badRequest("invalid_brainstorm_speaker");
  if (input.contributorId) {
    const contributor = await prisma.contributor.findUnique({ where: { id: input.contributorId } });
    if (!contributor || contributor.projectId !== projectId) throw badRequest("brainstorm_contributor_mismatch");
  }
  return prisma.brainstormSpeaker.upsert({
    where: { sessionId_speakerTag: { sessionId, speakerTag } },
    create: { sessionId, speakerTag, label, contributorId: input.contributorId ?? null },
    update: { label, contributorId: input.contributorId ?? null },
  });
}

export async function updateNode(userId: string, nodeId: string, input: UpdateNodeInput, expectedProjectId?: string, expectedSessionId?: string) {
  const node = await prisma.brainstormNode.findUnique({ where: { id: nodeId }, include: { session: true } });
  if (!node) throw notFound("brainstorm_node_not_found");
  if (expectedProjectId && node.session.projectId !== expectedProjectId) throw notFound("brainstorm_node_not_found");
  if (expectedSessionId && node.sessionId !== expectedSessionId) throw notFound("brainstorm_node_not_found");
  await projectWithAccess(userId, node.session.projectId, "member");
  return opUpdateNode(nodeId, input, { userId });
}

export function opUpdateNode(nodeId: string, input: UpdateNodeInput, actor: { userId: string }) {
  const title = input.title?.trim();
  if (input.title !== undefined && !title) throw badRequest("invalid_brainstorm_node");
  if (input.type && !BRAINSTORM_NODE_TYPES.includes(input.type)) throw badRequest("invalid_brainstorm_node");
  if (input.status && !BRAINSTORM_NODE_STATUSES.includes(input.status)) throw badRequest("invalid_brainstorm_node");
  return prisma.brainstormNode.update({
    where: { id: nodeId },
    data: { ...input, title, detail: input.detail?.trim() || input.detail, editedByUserId: actor.userId },
  });
}

export async function attachAudio(userId: string, sessionId: string, input: AttachAudioInput) {
  await sessionWithAccess(userId, sessionId, "member");
  return opAttachAudio(sessionId, input);
}

export function opAttachAudio(sessionId: string, input: AttachAudioInput) {
  if (!/^https:\/\//.test(input.url) || !Number.isInteger(input.bytes) || input.bytes < 0) throw badRequest("invalid_brainstorm_audio");
  return prisma.brainstormSession.update({ where: { id: sessionId }, data: { audioUrl: input.url, audioBytes: input.bytes } });
}

/** La pasada final es best-effort: cerrar la grabación nunca depende de Anthropic. */
export async function closeSession(userId: string, sessionId: string, expectedProjectId?: string) {
  const session = await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  const { opRunExtraction } = await import("./brainstorm-extract.js");
  const extraction = await opRunExtraction(session.id, { final: true });
  await prisma.brainstormSession.updateMany({
    where: { id: session.id, status: "recording" },
    data: { status: "closed", closedAt: new Date(), extractLockId: null, extractLockUntil: null },
  });
  return extraction;
}

export async function reapAbandonedSessions(projectId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS);
  return prisma.brainstormSession.updateMany({
    where: { projectId, status: "recording", lastRecorderBeatAt: { lt: cutoff } },
    data: { status: "abandoned", closedAt: now, extractLockId: null, extractLockUntil: null },
  });
}
