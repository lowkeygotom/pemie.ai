// Guarda de no-regresión: el tipado de en.ts fuerza paridad en compile-time,
// pero nada impide en runtime un catálogo desincronizado de ERROR_CODES (p.ej.
// un `as any` colado). Este test es el chequeo que sí corre siempre.

import assert from "node:assert/strict";
import test from "node:test";
import { ERROR_CODES } from "../services/error-codes.js";
import { es } from "./errors/es.js";
import { en } from "./errors/en.js";
import { es as mcpEs } from "./mcp/es.js";
import { en as mcpEn } from "./mcp/en.js";
import { es as telegramEs } from "./telegram/es.js";
import { en as telegramEn } from "./telegram/en.js";

function isEmpty(entry: string | ((params?: never) => string)): boolean {
  const text = typeof entry === "function" ? entry() : entry;
  return text.trim().length === 0;
}

test("es y en tienen exactamente las mismas claves", () => {
  const esKeys = Object.keys(es).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, esKeys);
});

test("ninguna entrada de es está vacía", () => {
  for (const [key, entry] of Object.entries(es)) {
    assert.equal(isEmpty(entry), false, `es.${key} está vacío`);
  }
});

test("ninguna entrada de en está vacía", () => {
  for (const [key, entry] of Object.entries(en)) {
    assert.equal(isEmpty(entry), false, `en.${key} está vacío`);
  }
});

test("toda clave de ERROR_CODES existe en ambos catálogos", () => {
  for (const code of ERROR_CODES) {
    assert.ok(code in es, `falta ${code} en es`);
    assert.ok(code in en, `falta ${code} en en`);
  }
});

test("ningún catálogo tiene claves huérfanas fuera de ERROR_CODES", () => {
  const codeSet: ReadonlySet<string> = new Set(ERROR_CODES);
  for (const key of Object.keys(es)) {
    assert.ok(codeSet.has(key), `es.${key} no está en ERROR_CODES`);
  }
  for (const key of Object.keys(en)) {
    assert.ok(codeSet.has(key), `en.${key} no está en ERROR_CODES`);
  }
});

// Los otros dos catálogos no tienen una lista de codes contra la que validarse
// (sus claves las define el propio catálogo), pero sí tienen que estar completos
// y no vacíos en ambos idiomas: un hueco acá es texto español suelto en la
// respuesta a un agente o en el chat de Telegram.
const OTROS_CATALOGOS = [
  { nombre: "mcp", es: mcpEs as Record<string, unknown>, en: mcpEn as Record<string, unknown> },
  { nombre: "telegram", es: telegramEs as Record<string, unknown>, en: telegramEn as Record<string, unknown> },
];

for (const catalogo of OTROS_CATALOGOS) {
  test(`${catalogo.nombre}: es y en tienen exactamente las mismas claves`, () => {
    assert.deepEqual(Object.keys(catalogo.en).sort(), Object.keys(catalogo.es).sort());
  });

  test(`${catalogo.nombre}: ninguna entrada está vacía`, () => {
    for (const locale of ["es", "en"] as const) {
      for (const [key, entry] of Object.entries(catalogo[locale])) {
        assert.equal(
          isEmpty(entry as string | ((params?: never) => string)),
          false,
          `${catalogo.nombre}/${locale}.${key} está vacío`
        );
      }
    }
  });
}
