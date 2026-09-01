import assert from "node:assert/strict";
import test from "node:test";
import { NEAR_DUPLICATE_THRESHOLD, resolveNearDuplicateAdds, trigramJaccardSimilarity, validateOps } from "./brainstorm-extract.js";

const context = {
  nodes: [{ id: "node-1", key: "n1", type: "idea", title: "Precio", status: "open" }],
  segments: [
    { seq: 1, speakerTag: 0, text: "Debemos revisar el precio mensual." },
    { seq: 2, speakerTag: 0, text: "La decisión queda pendiente." },
    { seq: 3, speakerTag: 1, text: "Esto depende del presupuesto." },
  ],
};

test("dos corridas concurrentes comparten la misma ventana sin producir operaciones duplicadas", () => {
  const payload = { ops: [{ op: "add", id: "tmp1", type: "idea", title: "Precio", citations: [{ segmentSeq: 1, quote: "precio mensual" }] }] };
  const first = validateOps(payload, context);
  const second = validateOps(payload, context);
  assert.deepEqual(second, first);
  assert.equal(first.ops.length, 1);
});

test("JSON roto se rechaza por completo, por lo que la corrida no tiene operaciones para avanzar cursor", () => {
  assert.deepEqual(validateOps({ nope: true }, context), { ops: [], rejected: { invalid_payload: 1 } });
});

test("operaciones con una key inexistente se descartan sin descartar el batch", () => {
  const result = validateOps({ ops: [
    { op: "update", key: "n404", title: "No existe" },
    { op: "close", key: "n1" },
  ] }, context);
  assert.equal(result.ops.length, 1);
  assert.deepEqual(result.rejected, { unknown_key: 1 });
});

test("reintentar una ventana conserva ids temporales y deduplica citas por la misma clave natural", () => {
  const result = validateOps({ ops: [
    { op: "add", id: "tmp1", type: "idea", title: "Presupuesto", citations: [{ segmentSeq: 3, quote: "presupuesto" }] },
    { op: "link", from: "tmp1", to: "n1", type: "depends_on" },
  ] }, context);
  assert.equal(result.ops.length, 2);
  assert.equal((result.ops[0] as { citations: unknown[] }).citations.length, 1);
});

const duplicateNode = { id: "node-risk", key: "n7", type: "risk", title: "Riesgo de costo de audio de Deepgram", status: "open" };
const duplicateAdd = { kind: "add" as const, tempId: "tmp-risk", type: "risk", title: "Riesgo por costo de audio de Deepgram", citations: [{ segmentSeq: 1, quote: "precio mensual", verbatim: true }] };

test("un add casi duplicado del mismo tipo se fusiona y conserva las citas", () => {
  assert.ok(trigramJaccardSimilarity(duplicateNode.title, duplicateAdd.title) >= NEAR_DUPLICATE_THRESHOLD);
  const result = resolveNearDuplicateAdds([duplicateAdd], [duplicateNode]);
  assert.deepEqual(result.ops, [{ kind: "update", key: "n7", citations: duplicateAdd.citations }]);
  assert.deepEqual(result.rejected, { near_duplicate: 1 });
  assert.equal(result.temporaryKeys.get("tmp-risk"), "n7");
});

test("textos similares de tipos distintos no se fusionan", () => {
  const result = resolveNearDuplicateAdds([{ ...duplicateAdd, type: "idea" }], [duplicateNode]);
  assert.equal(result.ops[0].kind, "add");
  assert.deepEqual(result.rejected, {});
});

test("un link al temporal fusionado sigue resolviendo al nodo existente", () => {
  const result = resolveNearDuplicateAdds([
    duplicateAdd,
    { kind: "link", from: "tmp-risk", to: "n1", type: "depends_on" },
  ], [duplicateNode, context.nodes[0]]);
  const keyToId = new Map([["n7", "node-risk"], ["n1", "node-1"]]);
  for (const [tempId, key] of result.temporaryKeys) keyToId.set(tempId, keyToId.get(key)!);
  const link = result.ops[1] as { kind: "link"; from: string; to: string };
  assert.equal(keyToId.get(link.from), "node-risk");
  assert.equal(keyToId.get(link.to), "node-1");
});

test("ideas distintas del mismo tipo no se fusionan", () => {
  const result = resolveNearDuplicateAdds([
    { ...duplicateAdd, title: "Definir responsables de las pruebas de carga" },
  ], [duplicateNode]);
  assert.equal(result.ops[0].kind, "add");
  assert.deepEqual(result.rejected, {});
});
