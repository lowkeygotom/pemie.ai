// Catálogo de skills (docs/skills-catalog.md): se ejercita el servicio real
// contra dobles en memoria (mismo patrón stubDelegate que story-card-sync).
// Lo que se afirma:
//   - hash estable ante reordenar paths (publish idempotente por contenido);
//   - token de upload expirado / reutilizado se rechaza;
//   - delete borra skill + archivos;
//   - paths inseguros se cortan al servir.

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
  where?: Row;
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

const ACTOR = { type: "agent" as const, id: "agent-1" };

function isServiceErrorWithCode(code: string) {
  return (err: unknown) => err instanceof ServiceError && err.code === code;
}

async function* filesFrom(list: Array<{ path: string; content: string }>) {
  for (const f of list) yield f;
}

/** Doble en memoria de WorkspaceSkill + archivos + uploads. */
function stubWorkspaceSkillTables(t: TestContext, seed?: Row) {
  let skill: Row | null = seed ? { ...seed } : null;
  let files: Row[] = Array.isArray(seed?.files) ? [...(seed!.files as Row[])] : [];
  let upload: Row | null = null;
  const writes = { creates: [] as Row[], updates: [] as Row[], fileCreates: 0, deletes: 0 };

  stubDelegate(t, "workspaceSkill", {
    findUnique: async ({ where }: Args) => {
      if (!skill) return null;
      if (where?.id && where.id !== skill.id) return null;
      if (where?.workspaceId_slug) {
        const key = where.workspaceId_slug as { workspaceId: string; slug: string };
        if (key.workspaceId !== skill.workspaceId || key.slug !== skill.slug) return null;
      }
      const includeFiles = true;
      return includeFiles ? { ...skill, files: files.map((f) => ({ ...f })) } : { ...skill };
    },
    findMany: async () => (skill ? [{ ...skill }] : []),
    update: async ({ data }: Args) => {
      writes.updates.push(data!);
      skill = { ...skill, ...data };
      return { ...skill };
    },
    upsert: async ({ create, update }: Args) => {
      if (skill) {
        writes.updates.push(update!);
        skill = { ...skill, ...applyIncrements(skill, update!) };
      } else {
        writes.creates.push(create!);
        skill = { id: "skill-1", version: 1, ...create };
      }
      return { ...skill };
    },
    delete: async () => {
      writes.deletes += 1;
      const prev = skill;
      skill = null;
      files = [];
      return prev;
    },
  });

  stubDelegate(t, "workspaceSkillFile", {
    deleteMany: async () => {
      const n = files.length;
      files = [];
      return { count: n };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      files = data.map((d, i) => ({ id: `file-${i}`, ...d }));
      writes.fileCreates += data.length;
      return { count: data.length };
    },
    findMany: async () => files.map((f) => ({ ...f })),
  });

  stubDelegate(t, "skillUpload", {
    findUnique: async ({ where }: Args) => {
      if (!upload) return null;
      if (where?.tokenHash && where.tokenHash !== upload.tokenHash) return null;
      return { ...upload };
    },
    create: async ({ data }: Args) => {
      upload = { id: "upload-1", ...data };
      return { ...upload };
    },
    delete: async () => {
      const prev = upload;
      upload = null;
      return prev;
    },
    deleteMany: async () => ({ count: 0 }),
  });

  stubDelegate(t, "skillDownload", {
    create: async ({ data }: Args) => ({ id: "dl-1", ...data }),
    deleteMany: async () => ({ count: 0 }),
    findUnique: async () => null,
    delete: async () => null,
  });

  // $transaction ejecuta el callback con el mismo client (ya stubbeado).
  const client = prisma as unknown as { $transaction: unknown };
  const originalTx = client.$transaction;
  client.$transaction = async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma);
  t.after(() => {
    client.$transaction = originalTx;
  });

  return {
    writes,
    getSkill: () => skill,
    getFiles: () => files,
    setUpload: (row: Row | null) => {
      upload = row;
    },
    getUpload: () => upload,
  };
}

// ─── complete upload / idempotencia ────────────────────────────────────

test("mismo contenido reordenado no sube la version", async (t) => {
  const { writes, setUpload } = stubWorkspaceSkillTables(t);
  const token = "a".repeat(48);
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  setUpload({
    id: "u1",
    workspaceId: "ws-1",
    slug: "review-bugbot",
    name: "Review Bugbot",
    description: "Trigger: X",
    tokenHash,
    actorType: "agent",
    actorId: "agent-1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const files = [
    { path: "SKILL.md", content: "# hola" },
    { path: "assets/a.json", content: "{}" },
  ];
  const first = await skills.opCompleteSkillUpload(token, filesFrom(files));
  assert.equal(first.version, 1);
  assert.equal(writes.creates.length, 1);

  setUpload({
    id: "u2",
    workspaceId: "ws-1",
    slug: "review-bugbot",
    name: "Review Bugbot",
    description: "Trigger: X",
    tokenHash: createHash("sha256").update("b".repeat(48)).digest("hex"),
    actorType: "agent",
    actorId: "agent-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const second = await skills.opCompleteSkillUpload("b".repeat(48), filesFrom([files[1]!, files[0]!]));
  assert.equal(second.version, 1, "mismo contenido, distinto orden: no es un cambio real");
  assert.equal(writes.creates.length, 1);
});

test("cambiar el contenido de files sí sube la version", async (t) => {
  const { setUpload } = stubWorkspaceSkillTables(t);
  const { createHash } = await import("node:crypto");

  setUpload({
    id: "u1",
    workspaceId: "ws-1",
    slug: "s",
    name: "n",
    description: "d",
    tokenHash: createHash("sha256").update("t1").digest("hex"),
    actorType: "agent",
    actorId: "a",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const first = await skills.opCompleteSkillUpload("t1", filesFrom([{ path: "SKILL.md", content: "v1" }]));
  assert.equal(first.version, 1);

  setUpload({
    id: "u2",
    workspaceId: "ws-1",
    slug: "s",
    name: "n",
    description: "d",
    tokenHash: createHash("sha256").update("t2").digest("hex"),
    actorType: "agent",
    actorId: "a",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const second = await skills.opCompleteSkillUpload("t2", filesFrom([{ path: "SKILL.md", content: "v2" }]));
  assert.equal(second.version, 2);
});

test("token de upload expirado se rechaza", async (t) => {
  const { setUpload } = stubWorkspaceSkillTables(t);
  const { createHash } = await import("node:crypto");
  setUpload({
    id: "u1",
    workspaceId: "ws-1",
    slug: "s",
    name: "n",
    description: "d",
    tokenHash: createHash("sha256").update("expired").digest("hex"),
    actorType: "agent",
    actorId: "a",
    expiresAt: new Date(Date.now() - 1000),
  });
  await assert.rejects(
    () => skills.opCompleteSkillUpload("expired", filesFrom([{ path: "SKILL.md", content: "x" }])),
    isServiceErrorWithCode("upload_expired")
  );
});

test("token de upload reutilizado se rechaza", async (t) => {
  const { setUpload } = stubWorkspaceSkillTables(t);
  const { createHash } = await import("node:crypto");
  const token = "once";
  setUpload({
    id: "u1",
    workspaceId: "ws-1",
    slug: "s",
    name: "n",
    description: "d",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    actorType: "agent",
    actorId: "a",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await skills.opCompleteSkillUpload(token, filesFrom([{ path: "SKILL.md", content: "x" }]));
  await assert.rejects(
    () => skills.opCompleteSkillUpload(token, filesFrom([{ path: "SKILL.md", content: "x" }])),
    (err: unknown) => err instanceof ServiceError && err.status === 404
  );
});

test("rechaza un path que intenta escapar el paquete", async () => {
  await assert.rejects(
    () =>
      skills.accumulateSkillFiles(
        filesFrom([
          { path: "SKILL.md", content: "x" },
          { path: "../../etc/passwd", content: "x" },
        ])
      ),
    isServiceErrorWithCode("invalid_path")
  );
});

test("rechaza un paquete sin SKILL.md", async () => {
  await assert.rejects(
    () => skills.accumulateSkillFiles(filesFrom([{ path: "notes.md", content: "x" }])),
    isServiceErrorWithCode("missing_skill_md")
  );
});

test("rechaza un slug que no es kebab-case", () => {
  assert.throws(
    () => skills.validateSkillMeta({ slug: "Review Bugbot", name: "n", description: "d" }),
    isServiceErrorWithCode("invalid_slug")
  );
});

// ─── get ────────────────────────────────────────────────────────────────

test("get_skill arma el rootPath y sirve files inline si es chica", async (t) => {
  stubWorkspaceSkillTables(t, {
    id: "skill-1",
    workspaceId: "ws-1",
    slug: "review-bugbot",
    name: "Review Bugbot",
    description: "d",
    version: 3,
    publishedByType: "agent",
    updatedAt: new Date("2026-01-01"),
    totalBytes: 10,
    contentHash: "x",
    files: [{ path: "SKILL.md", content: "# x", bytes: 3 }],
  });

  const result = await skills.opGetSkill("ws-1", "review-bugbot", {
    target: "cursor",
    destination: "user",
    apiBaseUrl: "http://localhost:4000",
  });
  assert.equal(result.install.rootPath, "~/.cursor/skills/review-bugbot");
  assert.ok("files" in result.install);
  assert.deepEqual(result.install.files, [{ path: "SKILL.md", content: "# x" }]);
  assert.equal("downloadUrl" in result.install ? result.install.downloadUrl : undefined, undefined);
});

test("get_skill rechaza target/destination fuera de catálogo", async (t) => {
  stubWorkspaceSkillTables(t);
  await assert.rejects(
    () =>
      skills.opGetSkill("ws-1", "s", {
        target: "chatgpt" as never,
        destination: "user",
        apiBaseUrl: "http://localhost:4000",
      }),
    isServiceErrorWithCode("invalid_target")
  );
});

test("get_skill corta si el paquete guardado tiene un path inseguro", async (t) => {
  stubWorkspaceSkillTables(t, {
    id: "skill-1",
    workspaceId: "ws-1",
    slug: "s",
    name: "n",
    description: "d",
    version: 1,
    publishedByType: "agent",
    updatedAt: new Date(),
    totalBytes: 10,
    contentHash: "x",
    files: [{ path: "../escape.md", content: "x", bytes: 1 }],
  });

  await assert.rejects(
    () =>
      skills.opGetSkill("ws-1", "s", {
        target: "claude",
        destination: "user",
        apiBaseUrl: "http://localhost:4000",
      }),
    isServiceErrorWithCode("invalid_path")
  );
});

test("get_skill de un slug inexistente da 404", async (t) => {
  stubWorkspaceSkillTables(t);
  await assert.rejects(
    () =>
      skills.opGetSkill("ws-1", "nope", {
        target: "claude",
        destination: "user",
        apiBaseUrl: "http://localhost:4000",
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 404
  );
});

// ─── delete ─────────────────────────────────────────────────────────────

test("delete_skill borra la skill y sus archivos", async (t) => {
  const { writes, getSkill, getFiles } = stubWorkspaceSkillTables(t, {
    id: "skill-1",
    workspaceId: "ws-1",
    slug: "gone",
    name: "Gone",
    description: "d",
    version: 1,
    publishedByType: "agent",
    updatedAt: new Date(),
    totalBytes: 3,
    contentHash: "x",
    files: [{ id: "f1", path: "SKILL.md", content: "# x", bytes: 3 }],
  });

  const result = await skills.opDeleteSkill("ws-1", "gone");
  assert.deepEqual(result, { ok: true, slug: "gone" });
  assert.equal(writes.deletes, 1);
  assert.equal(getSkill(), null);
  assert.equal(getFiles().length, 0);
});

test("hashFiles es estable ante reordenar", () => {
  const a = [
    { path: "SKILL.md", content: "x" },
    { path: "a.txt", content: "y" },
  ];
  const b = [a[1]!, a[0]!];
  assert.equal(skills.hashFiles(a), skills.hashFiles(b));
});
