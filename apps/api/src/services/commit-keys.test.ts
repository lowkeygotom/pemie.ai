// PEM-22: la regla de correlación commit ↔ HU.
//
// El match real lo resuelve Postgres, así que acá se fija el SQL que se le manda:
// que mire solo el asunto y que use frontera de palabra. Son las dos propiedades
// que, si alguien las toca sin querer, rompen el avance por HU y las alertas de
// drift a la vez y en silencio.

import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { commitSubjectMatchesKey } from "./commit-keys.js";

test("solo mira el asunto del commit, no el cuerpo", () => {
  const sql = commitSubjectMatchesKey(Prisma.sql`c."message"`, Prisma.sql`s."key"`).sql;

  assert.match(
    sql,
    /split_part\(.+?,\s*E'\\n',\s*1\)/,
    "sin recortar a la primera línea, una key nombrada en la prosa del cuerpo — una referencia cruzada o una URL de ejemplo — cuenta como trabajo hecho"
  );
});

test("exige frontera de palabra alrededor de la key", () => {
  const sql = commitSubjectMatchesKey(Prisma.sql`c."message"`, Prisma.sql`s."key"`).sql;

  assert.ok(
    sql.includes(`'\\y'`),
    "sin \\y, «PEM-1» matchea dentro de «PEM-19» y cada HU de un dígito se roba el avance de sus vecinas de dos"
  );
  assert.ok(sql.includes("~*"), "el match no distingue mayúsculas: «pem-1» también cuenta");
});

test("la key viaja como parámetro, no interpolada en el SQL", () => {
  const fragment = commitSubjectMatchesKey(Prisma.sql`"message"`, Prisma.sql`${"PEM-1"}`);

  assert.deepEqual(fragment.values, ["PEM-1"]);
  assert.ok(
    !fragment.sql.includes("PEM-1"),
    "la key llega de la base y nunca se concatena al texto de la consulta"
  );
});
