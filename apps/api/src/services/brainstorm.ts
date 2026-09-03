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
import { grantListenToken, isDeepgramConfigured } from "../lib/deepgram.js";
import { completeJson } from "../lib/anthropic.js";
import { opCreateStory } from "./stories.js";
import { z } from "zod";

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

const proposalSchema = z.object({
  nodeKey: z.string().regex(/^n\d+$/),
  title: z.string().min(2).max(300),
  narrative: z.object({ role: z.string().min(1), want: z.string().min(1), benefit: z.string().min(1) }),
  acceptanceCriteria: z.array(z.object({ given: z.string().min(1), when: z.string().min(1), then: z.string().min(1) })).min(1).max(12),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
// Espejo JSON-Schema de harvestSchema. Debe seguir a proposalSchema: si el modelo no ve la
// forma de una propuesta, devuelve la lista vacía y la cosecha se pierde en silencio.
const HARVEST_SCHEMA = {
  type: "object",
  required: ["summary", "proposals"],
  properties: {
    summary: { type: "string", description: "Acta en español, fundamentada solo en los nodos y citas entregados." },
    proposals: {
      type: "array",
      maxItems: 20,
      description: "Historias de Usuario propuestas. Vacío si ningún nodo sostiene una necesidad implementable.",
      items: {
        type: "object",
        required: ["nodeKey", "title", "narrative", "acceptanceCriteria", "priority"],
        properties: {
          nodeKey: { type: "string", description: "key del nodo que la sustenta, con forma n1, n2, ..." },
          title: { type: "string" },
          narrative: {
            type: "object",
            required: ["role", "want", "benefit"],
            properties: { role: { type: "string" }, want: { type: "string" }, benefit: { type: "string" } },
          },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              required: ["given", "when", "then"],
              properties: { given: { type: "string" }, when: { type: "string" }, then: { type: "string" } },
            },
          },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
      },
    },
  },
} as const;

const harvestSchema = z.object({ summary: z.string().min(1).max(8_000), proposals: z.array(proposalSchema).max(20) });

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

/** El servicio conserva la autorización; REST nunca entrega tokens por sí solo. */
export async function grantSttToken(userId: string, sessionId: string, expectedProjectId?: string) {
  await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  return grantListenToken();
}

export { isDeepgramConfigured };

export async function opGetSession(sessionId: string) {
  const session = await prisma.brainstormSession.findUnique({
    where: { id: sessionId },
    include: {
      speakers: { orderBy: { speakerTag: "asc" } },
      nodes: { orderBy: { key: "asc" }, include: { citations: { orderBy: { segmentSeq: "asc" } } } },
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

/** Genera un acta y propuestas únicamente a partir de nodos y citas persistidos. */
async function generateHarvest(sessionId: string) {
  const session = await prisma.brainstormSession.findUnique({
    where: { id: sessionId },
    include: { nodes: { orderBy: { key: "asc" }, include: { citations: { orderBy: { segmentSeq: "asc" } } } }, edges: true, proposals: true },
  });
  if (!session) throw notFound("brainstorm_session_not_found");
  if (session.summary || session.proposals.length) return session;
  const evidence = session.nodes.map((node) => ({
    key: node.key, type: node.type, title: node.title, detail: node.detail, status: node.status,
    citations: node.citations.filter((citation) => citation.verbatim).map((citation) => ({ segmentSeq: citation.segmentSeq, quote: citation.quote })),
  }));
  if (!evidence.length) {
    return prisma.brainstormSession.update({ where: { id: sessionId }, data: { summary: "No se extrajeron hallazgos verificables de esta sesión." } });
  }
  const fallback = evidence.map((node) => `• ${node.title}${node.citations[0] ? ` — “${node.citations[0].quote}”` : ""}`).join("\n");
  try {
    const completion = await completeJson({
      system: "Eres relator de producto. Escribe en español y usa exclusivamente los nodos y citas entregados. No inventes requisitos, actores, decisiones ni criterios. Solo propone HUs cuando el nodo y sus citas sostengan una necesidad implementable; conserva los términos técnicos literales.",
      user: `Evidencia del grafo:\n${JSON.stringify({ nodes: evidence, edges: session.edges.map((edge) => ({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, type: edge.type })) })}`,
      maxTokens: 2_500,
      timeoutMs: 15_000,
      tool: {
        name: "emit_harvest", description: "Emite el acta y propuestas sustentadas.",
        inputSchema: HARVEST_SCHEMA,
      },
    });
    const harvested = harvestSchema.safeParse(completion.json);
    if (!harvested.success) throw new Error("invalid_harvest");
    const nodeByKey = new Map(session.nodes.map((node) => [node.key, node]));
    const proposals = harvested.data.proposals.filter((proposal) => nodeByKey.has(proposal.nodeKey));
    await prisma.$transaction([
      prisma.brainstormSession.update({ where: { id: sessionId }, data: { summary: harvested.data.summary } }),
      ...proposals.map((proposal) => prisma.brainstormStoryProposal.create({ data: {
        sessionId, nodeId: nodeByKey.get(proposal.nodeKey)!.id, title: proposal.title,
        narrative: proposal.narrative, acceptanceCriteria: proposal.acceptanceCriteria, priority: proposal.priority,
      } })),
    ]);
  } catch {
    // El acta sigue siendo auditable sin proveedor: reproduce solamente títulos y citas literales.
    await prisma.brainstormSession.update({ where: { id: sessionId }, data: { summary: fallback } });
  }
  return opGetSession(sessionId);
}

export async function acceptProposal(userId: string, sessionId: string, proposalId: string, expectedProjectId?: string) {
  const session = await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  return opAcceptProposal(session.projectId, sessionId, proposalId, userId);
}

type ProposalStoryCreator = typeof opCreateStory;

/** Operación ya autorizada; separada para probar que un reintento no duplica la HU. */
export async function opAcceptProposal(projectId: string, sessionId: string, proposalId: string, userId: string, createStory: ProposalStoryCreator = opCreateStory) {
  const proposal = await prisma.brainstormStoryProposal.findFirst({ where: { id: proposalId, sessionId } });
  if (!proposal) throw notFound("brainstorm_proposal_not_found");
  if (proposal.status === "accepted") return proposal;
  if (proposal.status !== "pending") throw conflict("brainstorm_proposal_already_decided");
  // El candado breve impide que dos clics/reintentos creen dos HUs antes de persistir userStoryId.
  const claimed = await prisma.brainstormStoryProposal.updateMany({ where: { id: proposalId, status: "pending" }, data: { status: "accepting" } });
  if (!claimed.count) {
    const current = await prisma.brainstormStoryProposal.findUnique({ where: { id: proposalId } });
    if (current?.status === "accepted") return current;
    throw conflict("brainstorm_proposal_already_decided");
  }
  try {
    const story = await createStory(projectId, {
      title: proposal.title, narrative: proposal.narrative as { role: string; want: string; benefit: string },
      acceptanceCriteria: proposal.acceptanceCriteria as Array<{ given: string; when: string; then: string }>, priority: proposal.priority,
    }, { createdById: userId });
    return prisma.brainstormStoryProposal.update({ where: { id: proposalId }, data: { status: "accepted", userStoryId: story.id, decidedById: userId, decidedAt: new Date() } });
  } catch (error) {
    await prisma.brainstormStoryProposal.updateMany({ where: { id: proposalId, status: "accepting" }, data: { status: "pending" } });
    throw error;
  }
}

export async function rejectProposal(userId: string, sessionId: string, proposalId: string, expectedProjectId?: string) {
  await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  const changed = await prisma.brainstormStoryProposal.updateMany({ where: { id: proposalId, sessionId, status: "pending" }, data: { status: "rejected", decidedById: userId, decidedAt: new Date() } });
  if (changed.count) return prisma.brainstormStoryProposal.findUniqueOrThrow({ where: { id: proposalId } });
  const proposal = await prisma.brainstormStoryProposal.findFirst({ where: { id: proposalId, sessionId } });
  if (!proposal) throw notFound("brainstorm_proposal_not_found");
  throw conflict("brainstorm_proposal_already_decided");
}

/** La pasada final es best-effort: cerrar la grabación nunca depende de Anthropic. */
export async function closeSession(userId: string, sessionId: string, expectedProjectId?: string) {
  const session = await sessionWithAccess(userId, sessionId, "member", expectedProjectId);
  const { opRunExtraction } = await import("./brainstorm-extract.js");
  const extraction = await opRunExtraction(session.id, { final: true });
  await generateHarvest(session.id);
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
