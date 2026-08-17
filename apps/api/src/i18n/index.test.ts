// translate(): fallback de 3 pasos (locale pedido → "es" → clave cruda), y
// nunca lanza aunque la clave no exista en ningún catálogo.

import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "./index.js";

const catalogs = {
  es: { greeting: "Hola", withParams: (p?: { name?: string }) => `Hola ${p?.name}` },
  en: { greeting: "Hello" },
};

test("usa la clave del locale pedido cuando existe", () => {
  assert.equal(translate(catalogs, "en", "greeting"), "Hello");
});

test("cae a es cuando el locale pedido no tiene la clave", () => {
  assert.equal(translate(catalogs, "en", "withParams", { name: "Ada" }), "Hola Ada");
});

test("cae a la clave cruda cuando no existe en ningún catálogo", () => {
  assert.equal(translate(catalogs, "en", "missing_key"), "missing_key");
});

test("un locale no registrado también cae a es", () => {
  assert.equal(translate(catalogs, "fr", "greeting"), "Hola");
});
