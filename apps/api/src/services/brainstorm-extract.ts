import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { completeJson } from "../lib/anthropic.js";
import { conflict } from "./errors.js";
import { notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

export const MAX_SEGMENTS_PER_RUN = 120;
export const MIN_SEGMENTS_TO_RUN = 3;
export const OVERLAP_SEGMENTS = 10;
export const EXTRACT_BUDGET_MS = 20_000;
export const PROVIDER_TIMEOUT_MS = 15_000;
export const NEAR_DUPLICATE_THRESHOLD = 0.6;
const LEASE_MS = 35_000;
const MAX_OPS_PER_RUN = 40;

type Segment = { seq: number; text: string; speakerTag: number | null };
type ExistingNode = { id: string; key: string; type: string; title: string; status: string };
type Citation = { segmentSeq: number; quote: string; verbatim: boolean };
type GraphOp =
  | { kind: "add"; tempId: string; type: string; title: string; detail?: string; citations: Citation[] }
  | { kind: "update"; key: string; title?: string; detail?: string; type?: string; citations: Citation[] }
  | { kind: "close"; key: string; citations: Citation[] }
  | { kind: "link"; from: string; to: string; type: string; rationale?: string };

const nodeTypes = ["idea", "decision", "question", "risk", "action", "data", "conclusion"] as const;
const edgeTypes = ["supports", "contradicts", "refines", "depends_on", "duplicates"] as const;
const citationSchema = z.object({ segmentSeq: z.number().int(), quote: z.string().min(1).max(400) });
const rawOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), id: z.string().regex(/^tmp[\w-]+$/), type: z.enum(nodeTypes), title: z.string().min(1).max(300), detail: z.string().max(4_000).optional(), citations: z.array(citationSchema).default([]) }),
  z.object({ op: z.literal("update"), key: z.string().regex(/^n\d+$/), type: z.enum(nodeTypes).optional(), title: z.string().min(1).max(300).optional(), detail: z.string().max(4_000).optional(), citations: z.array(citationSchema).default([]) }),
  z.object({ op: z.literal("close"), key: z.string().regex(/^n\d+$/), citations: z.array(citationSchema).default([]) }),
  z.object({ op: z.literal("link"), from: z.string().min(1), to: z.string().min(1), type: z.enum(edgeTypes), rationale: z.string().max(2_000).optional() }),
]);

export function validateOps(raw: unknown, context: { nodes: ExistingNode[]; segments: Segment[] }) {
  const source = z.object({ ops: z.array(z.unknown()) }).safeParse(raw);
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  if (!source.success) return { ops: [] as GraphOp[], rejected: { invalid_payload: 1 } };
  const known = new Set(context.nodes.map((node) => node.key));
  // Se recolectan primero: un link puede apuntar a un tmp declarado más adelante.
  const temporary = new Set(source.data.ops.flatMap((candidate) => {
    const parsed = rawOpSchema.safeParse(candidate);
    return parsed.success && parsed.data.op === "add" ? [parsed.data.id] : [];
  }));
  const validSeq = new Map(context.segments.map((segment) => [segment.seq, segment]));
  const ops: GraphOp[] = [];
  for (const rawOp of source.data.ops.slice(0, MAX_OPS_PER_RUN)) {
    const parsed = rawOpSchema.safeParse(rawOp);
    if (!parsed.success) { reject("invalid_operation"); continue; }
    const op = parsed.data;
    const citations = "citations" in op ? op.citations.flatMap((citation) => {
      const segment = validSeq.get(citation.segmentSeq);
      if (!segment) { reject("citation_outside_window"); return []; }
      return [{ ...citation, verbatim: normalized(segment.text).includes(normalized(citation.quote)) }];
    }) : [];
    if (op.op === "add") { ops.push({ kind: "add", tempId: op.id, type: op.type, title: op.title.trim(), detail: op.detail?.trim(), citations }); continue; }
    if (op.op === "update" || op.op === "close") {
      if (!known.has(op.key)) { reject("unknown_key"); continue; }
      ops.push(op.op === "close" ? { kind: "close", key: op.key, citations } : { kind: "update", key: op.key, title: op.title?.trim(), detail: op.detail?.trim(), type: op.type, citations });
      continue;
    }
    if ((!known.has(op.from) && !temporary.has(op.from)) || (!known.has(op.to) && !temporary.has(op.to)) || op.from === op.to) { reject("unknown_key"); continue; }
    ops.push({ kind: "link", from: op.from, to: op.to, type: op.type, rationale: op.rationale?.trim() });
  }
  if (source.data.ops.length > MAX_OPS_PER_RUN) reject("too_many_operations");
  return { ops, rejected };
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function trigramJaccardSimilarity(left: string, right: string) {
  const trigrams = (value: string) => {
    const text = normalized(value);
    if (!text) return new Set<string>();
    if (text.length < 3) return new Set([text]);
    return new Set(Array.from({ length: text.length - 2 }, (_, index) => text.slice(index, index + 3)));
  };
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  if (!leftTrigrams.size && !rightTrigrams.size) return 1;
  let intersection = 0;
  for (const trigram of leftTrigrams) if (rightTrigrams.has(trigram)) intersection += 1;
  return intersection / (leftTrigrams.size + rightTrigrams.size - intersection);
}

export function resolveNearDuplicateAdds(ops: GraphOp[], nodes: ExistingNode[]) {
  const rejected: Record<string, number> = {};
  const temporaryKeys = new Map<string, string>();
  const resolved = ops.map((op): GraphOp => {
    if (op.kind !== "add") return op;
    const duplicate = nodes.find((node) => node.type === op.type && trigramJaccardSimilarity(node.title, op.title) >= NEAR_DUPLICATE_THRESHOLD);
    if (!duplicate) return op;
    // Conserva el alias temporal: los links del batch pueden referirse al add original.
    temporaryKeys.set(op.tempId, duplicate.key);
    rejected.near_duplicate = (rejected.near_duplicate ?? 0) + 1;
    return { kind: "update", key: duplicate.key, citations: op.citations };
  });
  return { ops: resolved, rejected, temporaryKeys };
}

function prompt(nodes: ExistingNode[], segments: Segment[]) {
  const digest = nodes.map((node) => `[${node.key}|${node.type}|${node.status}] ${node.title.slice(0, 120)}`).join("\n") || "(sin nodos)";
  const transcript = segments.map((segment) => `[s${segment.seq}${segment.speakerTag == null ? "" : `|H${segment.speakerTag}`}] ${segment.text}`).join("\n");
  return { system: "Eres un extractor de conversación en español. Devuelve únicamente emit_graph_ops con {ops}. Usa nN solo para nodos existentes y tmpN para nodos nuevos. Operaciones: add, update, close y link. Las citas deben usar segmentSeq de la ventana.", user: `Grafo actual:\n${digest}\n\nVentana nueva:\n${transcript}` };
}

async function release(sessionId: string, lockId: string) {
  await prisma.brainstormSession.updateMany({ where: { id: sessionId, extractLockId: lockId }, data: { extractLockId: null, extractLockUntil: null } });
}

export type ExtractionOutcome = { ok: boolean; status: "ok" | "idle" | "skipped"; reason?: string; pending?: number; opsApplied?: number };

export async function runExtraction(userId: string, sessionId: string, options: { final?: boolean } = {}, expectedProjectId?: string) {
  const session = await prisma.brainstormSession.findUnique({ where: { id: sessionId } });
  if (!session || (expectedProjectId && session.projectId !== expectedProjectId)) throw notFound("brainstorm_session_not_found");
  await projectWithAccess(userId, session.projectId, "member");
  return opRunExtraction(sessionId, options);
}

export async function opRunExtraction(sessionId: string, options: { final?: boolean } = {}): Promise<ExtractionOutcome> {
  const before = await prisma.brainstormSession.findUnique({ where: { id: sessionId } });
  if (!before) return { ok: false, status: "skipped", reason: "session_not_found" };
  if (before.extractionMode === "paused") return { ok: false, status: "skipped", reason: "paused" };
  const lockId = randomUUID();
  const now = new Date();
  // UPDATE condicional: bajo READ COMMITTED el segundo competidor reevalúa el WHERE tras el lock de fila.
  const claimed = await prisma.brainstormSession.updateMany({
    where: { id: sessionId, status: "recording", extractCursor: before.extractCursor, OR: [{ extractLockUntil: null }, { extractLockUntil: { lte: now } }] },
    data: { extractLockId: lockId, extractLockUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (!claimed.count) return { ok: false, status: "skipped", reason: "locked", pending: Math.max(0, before.segmentSeq - before.extractCursor) };

  try {
    const segments = await prisma.brainstormSegment.findMany({ where: { sessionId, seq: { gt: before.extractCursor } }, orderBy: { seq: "asc" }, take: MAX_SEGMENTS_PER_RUN });
    if (!options.final && segments.length < MIN_SEGMENTS_TO_RUN) return { ok: true, status: "idle", pending: segments.length };
    if (!segments.length) return { ok: true, status: "idle", pending: 0 };
    const nodes = await prisma.brainstormNode.findMany({ where: { sessionId }, orderBy: { key: "asc" }, select: { id: true, key: true, type: true, title: true, status: true } });
    const deadline = Date.now() + EXTRACT_BUDGET_MS;
    const request = prompt(nodes, segments);
    let completion;
    try { completion = await completeJson({ ...request, maxTokens: 2_500, timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, Math.max(1, deadline - Date.now())) }); }
    catch (error) {
      await prisma.brainstormSession.updateMany({ where: { id: sessionId, extractLockId: lockId }, data: { extractFailures: { increment: 1 } } });
      return { ok: false, status: "skipped", reason: error instanceof Error ? error.message : "provider_failed" };
    }
    const validated = validateOps(completion.json, { nodes, segments });
    const deduplicated = resolveNearDuplicateAdds(validated.ops, nodes);
    const consumedThrough = segments.at(-1)!.seq;
    const applied = await prisma.$transaction(async (tx) => {
      const owner = await tx.brainstormSession.updateMany({ where: { id: sessionId, extractLockId: lockId }, data: { extractLockUntil: new Date(Date.now() + LEASE_MS) } });
      if (!owner.count) throw conflict("brainstorm_lease_lost");
      const keyToId = new Map(nodes.map((node) => [node.key, node.id]));
      for (const [tempId, key] of deduplicated.temporaryKeys) keyToId.set(tempId, keyToId.get(key)!);
      let nodeSeq = before.nodeSeq;
      let count = 0;
      for (const op of deduplicated.ops) if (op.kind === "add") {
        nodeSeq += 1;
        const node = await tx.brainstormNode.create({ data: { sessionId, key: `n${nodeSeq}`, type: op.type, title: op.title, detail: op.detail, firstSeq: segments[0].seq, lastSeq: consumedThrough } });
        keyToId.set(op.tempId, node.id); count += 1;
        for (const citation of op.citations) await tx.brainstormCitation.upsert({ where: { nodeId_segmentSeq_quote: { nodeId: node.id, segmentSeq: citation.segmentSeq, quote: citation.quote } }, create: { nodeId: node.id, segmentSeq: citation.segmentSeq, quote: citation.quote, verbatim: citation.verbatim }, update: {} });
      }
      for (const op of deduplicated.ops) {
        if (op.kind === "update" || op.kind === "close") {
          const nodeId = keyToId.get(op.key)!;
          await tx.brainstormNode.update({ where: { id: nodeId }, data: op.kind === "close" ? { status: "resolved", lastSeq: consumedThrough } : { title: op.title, detail: op.detail, type: op.type, lastSeq: consumedThrough } }); count += 1;
          for (const citation of op.citations) await tx.brainstormCitation.upsert({ where: { nodeId_segmentSeq_quote: { nodeId, segmentSeq: citation.segmentSeq, quote: citation.quote } }, create: { nodeId, segmentSeq: citation.segmentSeq, quote: citation.quote, verbatim: citation.verbatim }, update: {} });
        } else if (op.kind === "link") {
          const fromNodeId = keyToId.get(op.from)!; const toNodeId = keyToId.get(op.to)!;
          await tx.brainstormEdge.upsert({ where: { fromNodeId_toNodeId_type: { fromNodeId, toNodeId, type: op.type } }, create: { sessionId, fromNodeId, toNodeId, type: op.type, rationale: op.rationale }, update: { rationale: op.rationale } }); count += 1;
        }
      }
      const advanced = await tx.brainstormSession.updateMany({ where: { id: sessionId, extractLockId: lockId, extractCursor: before.extractCursor }, data: { extractCursor: consumedThrough, nodeSeq, extractLockId: null, extractLockUntil: null, lastExtractAt: new Date(), extractRuns: { increment: 1 }, extractFailures: 0 } });
      if (!advanced.count) throw conflict("brainstorm_lease_lost");
      await tx.brainstormRun.upsert({ where: { sessionId_runIndex: { sessionId, runIndex: before.extractRuns + 1 } }, create: { sessionId, runIndex: before.extractRuns + 1, fromSeq: segments[0].seq, toSeq: consumedThrough, status: "ok", model: completion.model, latencyMs: EXTRACT_BUDGET_MS - Math.max(0, deadline - Date.now()), inputTokens: completion.inputTokens, cachedInputTokens: completion.cachedInputTokens, outputTokens: completion.outputTokens, opsApplied: count, opsRejected: { ...validated.rejected, ...Object.fromEntries(Object.entries(deduplicated.rejected).map(([reason, count]) => [reason, (validated.rejected[reason] ?? 0) + count])) } }, update: {} });
      return count;
    });
    return { ok: true, status: "ok", opsApplied: applied, pending: Math.max(0, before.segmentSeq - consumedThrough) };
  } catch (error) {
    return { ok: false, status: "skipped", reason: error instanceof Error ? error.message : "extraction_failed" };
  } finally {
    // También libera tras fallos y retornos tempranos; el TTL es la red para un proceso terminado.
    await release(sessionId, lockId).catch(() => undefined);
  }
}
