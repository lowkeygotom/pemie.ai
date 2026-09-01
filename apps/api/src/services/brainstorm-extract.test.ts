import assert from "node:assert/strict";
import test from "node:test";
import { validateOps } from "./brainstorm-extract.js";

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
