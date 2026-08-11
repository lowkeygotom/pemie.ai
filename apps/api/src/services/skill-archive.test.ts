// Tests del parser de tar.gz de skills: paths, symlinks, bomba de descompresión
// y strip del directorio raíz. Construye los archives en el propio test.

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import * as tar from "tar-stream";
import { ServiceError } from "./errors.js";
import { parseSkillTarGz, stripCommonRootPrefix } from "./skill-archive.js";

function isServiceErrorWithCode(code: string) {
  return (err: unknown) => err instanceof ServiceError && err.code === code;
}

/** Empaqueta entradas en un Buffer tar.gz. `type` por defecto es file. */
async function buildTarGz(
  entries: Array<{ name: string; content?: string; type?: string; linkname?: string; size?: number }>
): Promise<Buffer> {
  const pack = tar.pack();
  const gzip = createGzip();
  const out = Readable.from(pack).pipe(gzip);
  const done = buffer(out);

  for (const entry of entries) {
    const type = (entry.type ?? "file") as tar.Headers["type"];
    if (type === "directory") {
      await new Promise<void>((resolve, reject) => {
        pack.entry({ name: entry.name, type: "directory" }, (err) => (err ? reject(err) : resolve()));
      });
      continue;
    }
    if (type === "symlink" || type === "link") {
      await new Promise<void>((resolve, reject) => {
        pack.entry(
          { name: entry.name, type, linkname: entry.linkname ?? "target", size: 0 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      continue;
    }
    const content = entry.content ?? "";
    const buf = Buffer.from(content, "utf8");
    await new Promise<void>((resolve, reject) => {
      pack.entry({ name: entry.name, type: "file", size: buf.length }, buf, (err) =>
        err ? reject(err) : resolve()
      );
    });
  }
  pack.finalize();
  return done;
}

async function collect(source: Buffer, limits?: Parameters<typeof parseSkillTarGz>[1]) {
  const files: Array<{ path: string; content: string }> = [];
  for await (const f of parseSkillTarGz(Readable.from(source), limits)) files.push(f);
  return files;
}

test("strippea el directorio raíz común (impeccable/SKILL.md → SKILL.md)", async () => {
  const gz = await buildTarGz([
    { name: "impeccable/SKILL.md", content: "# skill" },
    { name: "impeccable/assets/a.txt", content: "a" },
  ]);
  const files = await collect(gz);
  assert.deepEqual(
    files.map((f) => f.path).sort(),
    ["SKILL.md", "assets/a.txt"]
  );
});

test("sin raíz común deja los paths tal cual", async () => {
  const gz = await buildTarGz([
    { name: "SKILL.md", content: "# skill" },
    { name: "assets/a.txt", content: "a" },
  ]);
  const files = await collect(gz);
  assert.deepEqual(
    files.map((f) => f.path).sort(),
    ["SKILL.md", "assets/a.txt"]
  );
});

test("rechaza un path que escapa el paquete", async () => {
  const gz = await buildTarGz([
    { name: "SKILL.md", content: "x" },
    { name: "../../etc/passwd", content: "x" },
  ]);
  await assert.rejects(() => collect(gz), isServiceErrorWithCode("invalid_path"));
});

test("rechaza symlink", async () => {
  const gz = await buildTarGz([
    { name: "SKILL.md", content: "x" },
    { name: "evil", type: "symlink", linkname: "/etc/passwd" },
  ]);
  await assert.rejects(() => collect(gz), isServiceErrorWithCode("unsafe_tar_entry"));
});

test("rechaza hardlink", async () => {
  const gz = await buildTarGz([
    { name: "SKILL.md", content: "x" },
    { name: "hard", type: "link", linkname: "SKILL.md" },
  ]);
  await assert.rejects(() => collect(gz), isServiceErrorWithCode("unsafe_tar_entry"));
});

test("aborta al cruzar el límite total (bomba de descompresión)", async () => {
  const gz = await buildTarGz([
    { name: "SKILL.md", content: "a".repeat(100) },
    { name: "big.txt", content: "b".repeat(200) },
  ]);
  await assert.rejects(
    () => collect(gz, { maxTotalBytes: 150, maxFileBytes: 1000, maxFiles: 50 }),
    isServiceErrorWithCode("skill_too_large")
  );
});

test("stripCommonRootPrefix no strippea si hay un archivo en la raíz junto a un dir", () => {
  const result = stripCommonRootPrefix([
    { path: "SKILL.md", content: "x", bytes: 1 },
    { path: "assets/a.txt", content: "y", bytes: 1 },
  ]);
  assert.deepEqual(
    result.map((f) => f.path),
    ["SKILL.md", "assets/a.txt"]
  );
});
