// Parseo y empaquetado de tar.gz de skills.
// Aislado a propósito: el input del tar no es de confianza (agente/curl) y las
// reglas de rechazo (symlink, bomba de descompresión, strip de raíz) no deben
// mezclarse con la lógica de persistencia de skills.ts.

import { createGunzip, createGzip } from "node:zlib";
import { Readable, PassThrough, type Readable as NodeReadable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar-stream";
import {
  isSafeSkillFilePath,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
  type SkillFile,
} from "@pemie/shared";
import { badRequest } from "./errors.js";

const UNSAFE_TAR_TYPES = new Set([
  "symlink",
  "link", // hardlink
  "block-device",
  "character-device",
  "fifo",
  "contiguous-file",
]);

export interface SkillArchiveLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

/**
 * Extrae un tar.gz a un AsyncIterable de SkillFile.
 * Rechaza symlinks/hardlinks/devices, corta al cruzar el límite de bytes y
 * strippea el directorio raíz común (`impeccable/SKILL.md` → `SKILL.md`).
 */
export async function* parseSkillTarGz(
  source: NodeReadable | AsyncIterable<Uint8Array | Buffer>,
  limits: SkillArchiveLimits = {}
): AsyncGenerator<SkillFile> {
  const maxFiles = limits.maxFiles ?? SKILL_MAX_FILES;
  const maxFileBytes = limits.maxFileBytes ?? SKILL_MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? SKILL_MAX_TOTAL_BYTES;

  const collected = await extractTarGzEntries(source, { maxFiles, maxFileBytes, maxTotalBytes });
  const normalized = stripCommonRootPrefix(collected);

  for (const file of normalized) {
    if (!isSafeSkillFilePath(file.path)) throw badRequest("invalid_path", { path: file.path });
    yield file;
  }
}

interface RawEntry {
  path: string;
  content: string;
  bytes: number;
}

async function extractTarGzEntries(
  source: NodeReadable | AsyncIterable<Uint8Array | Buffer>,
  limits: Required<SkillArchiveLimits>
): Promise<RawEntry[]> {
  const extract = tar.extract();
  const gunzip = createGunzip();
  const entries: RawEntry[] = [];
  let totalBytes = 0;
  let aborted: Error | null = null;

  const fail = (err: Error) => {
    if (!aborted) aborted = err;
    extract.destroy(err);
    gunzip.destroy(err);
  };

  extract.on("entry", (header, stream, next) => {
    if (aborted) {
      stream.resume();
      next();
      return;
    }

    const type = header.type ?? "file";
    if (type === "directory") {
      stream.resume();
      next();
      return;
    }
    if (UNSAFE_TAR_TYPES.has(type) || type !== "file") {
      fail(badRequest("unsafe_tar_entry", { type }));
      stream.resume();
      next();
      return;
    }

    const name = (header.name ?? "").replace(/^\.\//, "").replace(/\/$/, "");
    if (!name) {
      stream.resume();
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let entryBytes = 0;

    stream.on("data", (chunk: Buffer) => {
      if (aborted) return;
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      if (entryBytes > limits.maxFileBytes) {
        fail(badRequest("file_too_large", { max: limits.maxFileBytes, path: name }));
        return;
      }
      if (totalBytes > limits.maxTotalBytes) {
        // Abortar el stream al cruzar el límite: defensa contra bomba de
        // descompresión (un .tar.gz chico puede expandirse a GB).
        fail(badRequest("skill_too_large", { max: limits.maxTotalBytes }));
        return;
      }
      chunks.push(chunk);
    });

    stream.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    stream.on("end", () => {
      if (aborted) {
        next();
        return;
      }
      if (entries.length >= limits.maxFiles) {
        fail(badRequest("too_many_files", { max: limits.maxFiles }));
        next();
        return;
      }
      const content = Buffer.concat(chunks).toString("utf8");
      entries.push({ path: name, content, bytes: Buffer.byteLength(content, "utf8") });
      next();
    });
  });

  const input = Readable.isReadable(source as NodeReadable)
    ? (source as NodeReadable)
    : Readable.from(source as AsyncIterable<Uint8Array | Buffer>);

  try {
    await pipeline(input, gunzip, extract);
  } catch (err) {
    if (aborted) throw aborted;
    if (err instanceof Error && (err as { code?: string }).code === "Z_DATA_ERROR")
      throw badRequest("invalid_archive");
    throw err;
  }
  if (aborted) throw aborted;
  return entries;
}

/**
 * Si *todas* las entradas comparten un primer segmento de path, lo strippea
 * (`impeccable/SKILL.md` → `SKILL.md`). Si no, se dejan tal cual.
 */
export function stripCommonRootPrefix(files: RawEntry[]): RawEntry[] {
  if (files.length === 0) return files;
  const firstSegments = files.map((f) => f.path.split("/")[0] ?? "");
  const root = firstSegments[0]!;
  const allShare =
    root.length > 0 &&
    firstSegments.every((s) => s === root) &&
    files.every((f) => f.path.includes("/"));
  if (!allShare) return files;
  return files.map((f) => ({
    ...f,
    path: f.path.slice(root.length + 1),
  }));
}

/**
 * Empaqueta archivos en un stream tar.gz. Lee en secuencia para no materializar
 * el gzip completo en memoria de una vez.
 */
export function packSkillTarGz(
  files: Iterable<{ path: string; content: string }> | AsyncIterable<{ path: string; content: string }>
): NodeReadable {
  const pack = tar.pack();
  const gzip = createGzip();
  const out = new PassThrough();

  pack.pipe(gzip).pipe(out);

  void (async () => {
    try {
      for await (const file of files as AsyncIterable<{ path: string; content: string }>) {
        const buf = Buffer.from(file.content, "utf8");
        await new Promise<void>((resolve, reject) => {
          pack.entry({ name: file.path, size: buf.length, type: "file" }, buf, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err instanceof Error ? err : new Error(String(err)));
      out.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return out;
}
