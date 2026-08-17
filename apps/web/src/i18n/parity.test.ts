// Guarda de no-regresión del i18n: cada namespace tiene que existir en ambos
// idiomas y con exactamente las mismas claves.
//
// Sin esto, una clave que se agrega solo en `es` no rompe nada en compilación:
// react-i18next cae al fallback y la persona en inglés ve español suelto en
// medio de la pantalla. Ese fue justamente el modo de falla que dejó los tabs
// del proyecto y el "Mostrar/Ocultar" del design system sin traducir.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

async function load(locale: "es" | "en", file: string): Promise<Record<string, unknown>> {
  const mod = await import(pathToFileURL(join(here, locale, file)).href);
  return mod.default as Record<string, unknown>;
}

test("cada namespace de es tiene su par en en", async () => {
  const es = readdirSync(join(here, "es")).sort();
  const en = readdirSync(join(here, "en")).sort();
  assert.deepEqual(es, en, "los directorios es/ y en/ deben tener los mismos archivos");
});

test("los namespaces tienen las mismas claves en ambos idiomas", async () => {
  const files = readdirSync(join(here, "es"));
  for (const file of files) {
    const [dictEs, dictEn] = await Promise.all([load("es", file), load("en", file)]);
    const keysEs = Object.keys(dictEs).sort();
    const keysEn = Object.keys(dictEn).sort();
    assert.deepEqual(
      keysEn,
      keysEs,
      `${file}: faltan en EN [${keysEs.filter((k) => !keysEn.includes(k))}] · faltan en ES [${keysEn.filter((k) => !keysEs.includes(k))}]`
    );
  }
});

test("ninguna traducción quedó vacía", async () => {
  const files = readdirSync(join(here, "es"));
  for (const locale of ["es", "en"] as const) {
    for (const file of files) {
      const dict = await load(locale, file);
      for (const [key, value] of Object.entries(dict)) {
        assert.notEqual(String(value).trim(), "", `${locale}/${file}: la clave "${key}" está vacía`);
      }
    }
  }
});
