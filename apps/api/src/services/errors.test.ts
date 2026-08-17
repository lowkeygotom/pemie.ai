// ServiceError solo emite code + params (sin texto propio). renderServiceError
// resuelve el texto contra el catálogo i18n según el locale pedido.

import assert from "node:assert/strict";
import test from "node:test";
import { badRequest, conflict, renderServiceError } from "./errors.js";

test("ServiceError.message es el code, no texto de usuario", () => {
  const err = badRequest("invalid_repo");
  assert.equal(err.message, "invalid_repo");
  assert.equal(err.code, "invalid_repo");
});

test("renderServiceError traduce por catálogo según el locale", () => {
  const err = badRequest("invalid_repo");
  assert.equal(renderServiceError(err, "es"), "Owner y nombre del repo son obligatorios");
  assert.equal(renderServiceError(err, "en"), "Repo owner and name are required");
});

test("renderServiceError interpola params contra el catálogo", () => {
  const err = badRequest("invalid_type", { type: "banana" });
  assert.equal(renderServiceError(err, "es"), "Tipo inválido: banana");
  assert.equal(renderServiceError(err, "en"), "Invalid type: banana");
});

test("params se preservan sin transformar en el ServiceError", () => {
  const err = conflict("email_taken");
  assert.equal(err.params, undefined);

  const withParams = badRequest("invalid_type", { type: "banana" });
  assert.deepEqual(withParams.params, { type: "banana" });
});

test("conflict traduce igual que badRequest", () => {
  const err = conflict("email_taken");
  assert.equal(renderServiceError(err, "en"), "An account with that email already exists");
});
