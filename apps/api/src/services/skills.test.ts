// Catálogo de skills (docs/skills-catalog.md): se ejercita el servicio real
// contra un doble en memoria de ProjectSkill (mismo patrón que
// story-card-sync.test.ts). Lo que se afirma:
//   - el hash de `files` es estable ante reordenar paths (publish idempotente
//     por contenido, no por el orden en que llegó el array);
//   - cambiar solo name/description sin tocar `files` no sube `version`;
//   - los paths de archivo se validan tanto al publicar como al servir el
//     paquete instalable (defensa en profundidad: ver isSafeSkillFilePath).

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";
import { ServiceError } from "./errors.js";
import * as skills from "./skills.js";

/** Reemplaza un delegate de Prisma por un doble y lo restaura al terminar. */
function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => {
    Object.defineProperty(client, model, { value: original, configurable: true, writable: true });
  });
}

type Row = Record<string, unknown>;
interface Args {
  data?: Row;
  create?: Row;
  update?: Row;
}

/** Prisma resuelve `{ increment: n }` server-side; el doble lo hace a mano. */
function applyIncrements(row: Row, data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] =
      v && typeof v === "object" && "increment" in (v as Row)
        ? (row[k] as number) + ((v as Row).increment as number)
        : v;
  }
  return out;
}

/** Doble en memoria de ProjectSkill: una sola fila, como la unique [projectId, slug] real. */
function stubProjectSkillTable(t: TestContext, seed?: Row) {
  let row: Row | null = seed ? { ...seed } : null;
  const writes = { creates: [] as Row[], updates: [] as Row[] };

  stubDelegate(t, "projectSkill", {
    findUnique: async () => (row ? { ...row } : null),
    update: async ({ data }: Args) => {
      writes.updates.push(data!);
      row = { ...row, ...data };
      return { ...row };
    },
    upsert: async ({ create, update }: Args) => {
      if (row) {
        writes.updates.push(update!);
        row = { ...row, ...applyIncrements(row, update!) };
      } else {
        writes.creates.push(create!);
        row = { version: 1, ...create };
      }
      return { ...row };
    },
  });

  return { writes, getRow: () => row };
}

const ACTOR = { type: "agent" as const, id: "agent-1" };

function isServiceErrorWithCode(code: string) {
  return (err: unknown) => err instanceof ServiceError && err.code === code;
}

// ─── publish ────────────────────────────────────────────────────────────

test("publicar el mismo contenido con los paths reordenados no sube la version", async (t) => {
  const files = [
    { path: "SKILL.md", content: "# hola" },
    { path: "assets/a.json", content: "{}" },
  ];
  const { writes } = stubProjectSkillTable(t);

  const first = await skills.opPublishSkill(
    "project-1",
    { slug: "review-bugbot", name: "Review Bugbot", description: "Trigger: X", files },
    ACTOR
  );
  assert.equal(first.version, 1);
  assert.equal(writes.creates.length, 1);

  const second = await skills.opPublishSkill(
    "project-1",
    { slug: "review-bugbot", name: "Review Bugbot", description: "Trigger: X", files: [files[1]!, files[0]!] },
    ACTOR
  );

  assert.equal(second.version, 1, "mismo contenido, distinto orden: no es un cambio real");
  assert.equal(writes.creates.length, 1, "la segunda publicación no crea otra fila");
  assert.equal(writes.updates.length, 1, "actualiza metadata en vez de tratarlo como sin cambios");
});

test("cambiar el contenido de files sí sube la version", async (t) => {
  stubProjectSkillTable(t);
  const base = { slug: "review-bugbot", name: "Review Bugbot", description: "Trigger: X" };

  const first = await skills.opPublishSkill(
    "project-1",
    { ...base, files: [{ path: "SKILL.md", content: "v1" }] },
    ACTOR
  );
  assert.equal(first.version, 1);

  const second = await skills.opPublishSkill(
    "project-1",
    { ...base, files: [{ path: "SKILL.md", content: "v2" }] },
    ACTOR
  );
  assert.equal(second.version, 2);
});

test("cambiar solo name/description sin tocar files actualiza metadata pero no sube version", async (t) => {
  const files = [{ path: "SKILL.md", content: "# hola" }];
  const { getRow } = stubProjectSkillTable(t);

  await skills.opPublishSkill(
    "project-1",
    { slug: "s", name: "Old name", description: "old desc", files },
    ACTOR
  );
  const second = await skills.opPublishSkill(
    "project-1",
    { slug: "s", name: "New name", description: "new desc", files },
    { type: "user", id: "user-1" }
  );

  assert.equal(second.version, 1);
  assert.equal(getRow()?.name, "New name");
  assert.equal(getRow()?.publishedByType, "user");
});

test("rechaza un path que intenta escapar el paquete", async () => {
  await assert.rejects(
    () =>
      skills.opPublishSkill(
        "project-1",
        {
          slug: "s",
          name: "n",
          description: "d",
          files: [
            { path: "SKILL.md", content: "x" },
            { path: "../../etc/passwd", content: "x" },
          ],
        },
        ACTOR
      ),
    isServiceErrorWithCode("invalid_path")
  );
});

test("rechaza un paquete sin SKILL.md", async () => {
  await assert.rejects(
    () =>
      skills.opPublishSkill(
        "project-1",
        { slug: "s", name: "n", description: "d", files: [{ path: "notes.md", content: "x" }] },
        ACTOR
      ),
    isServiceErrorWithCode("missing_skill_md")
  );
});

test("rechaza un slug que no es kebab-case", async () => {
  await assert.rejects(
    () =>
      skills.opPublishSkill(
        "project-1",
        { slug: "Review Bugbot", name: "n", description: "d", files: [{ path: "SKILL.md", content: "x" }] },
        ACTOR
      ),
    isServiceErrorWithCode("invalid_slug")
  );
});

// ─── get ────────────────────────────────────────────────────────────────

test("get_skill arma el rootPath según target y destination", async (t) => {
  stubDelegate(t, "projectSkill", {
    findUnique: async () => ({
      slug: "review-bugbot",
      name: "Review Bugbot",
      description: "d",
      version: 3,
      publishedByType: "agent",
      updatedAt: new Date("2026-01-01"),
      files: [{ path: "SKILL.md", content: "# x" }],
    }),
  });

  const result = await skills.opGetSkill("project-1", "review-bugbot", { target: "cursor", destination: "user" });
  assert.equal(result.install.rootPath, "~/.cursor/skills/review-bugbot");
  assert.deepEqual(result.install.files, [{ path: "SKILL.md", content: "# x" }]);
});

test("get_skill rechaza target/destination fuera de catálogo", async (t) => {
  stubDelegate(t, "projectSkill", { findUnique: async () => assert.fail("no debería consultar la fila") });

  await assert.rejects(
    () => skills.opGetSkill("project-1", "s", { target: "chatgpt" as never, destination: "user" }),
    isServiceErrorWithCode("invalid_target")
  );
});

test("get_skill corta si el paquete guardado tiene un path inseguro (defensa en profundidad)", async (t) => {
  stubDelegate(t, "projectSkill", {
    findUnique: async () => ({
      slug: "s",
      name: "n",
      description: "d",
      version: 1,
      publishedByType: "agent",
      updatedAt: new Date(),
      files: [{ path: "../escape.md", content: "x" }],
    }),
  });

  await assert.rejects(
    () => skills.opGetSkill("project-1", "s", { target: "claude", destination: "user" }),
    isServiceErrorWithCode("invalid_path")
  );
});

test("get_skill de un slug inexistente da 404", async (t) => {
  stubDelegate(t, "projectSkill", { findUnique: async () => null });

  await assert.rejects(
    () => skills.opGetSkill("project-1", "nope", { target: "claude", destination: "user" }),
    (err: unknown) => err instanceof ServiceError && err.status === 404
  );
});
