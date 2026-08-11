// Transporte de bytes de skills: autenticado por token opaco, no por sesión.
// Es lo que hace posible `tar | curl` pelado desde el shell del agente.
// Ambos content-types de upload desembocan en el mismo opCompleteSkillUpload.

import { Hono } from "hono";
import { Readable } from "node:stream";
import type { SkillFile } from "@pemie/shared";
import { badRequest } from "../services/errors.js";
import * as skills from "../services/skills.js";
import { parseSkillTarGz } from "../services/skill-archive.js";
import type { AppEnv } from "./http.js";

async function* multipartSkillFiles(form: FormData): AsyncGenerator<SkillFile> {
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") continue;
    const file = value as File;
    // El path relativo viaja en el nombre de la parte (o en webkitRelativePath
    // vía el File.name que el browser manda al construir FormData).
    const path = (file.name || name).replace(/\\/g, "/");
    const content = await file.text();
    yield { path, content };
  }
}

export function skillTransferRoutes() {
  const app = new Hono<AppEnv>();

  app.put("/:token", async (c) => {
    const token = c.req.param("token");
    const contentType = c.req.header("content-type") ?? "";

    let source: AsyncIterable<SkillFile>;
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      source = multipartSkillFiles(form);
    } else if (
      contentType.includes("application/gzip") ||
      contentType.includes("application/x-gzip") ||
      contentType.includes("application/octet-stream") ||
      contentType === ""
    ) {
      const body = c.req.raw.body;
      if (!body) throw badRequest("Cuerpo vacío", "empty_body");
      source = parseSkillTarGz(Readable.fromWeb(body as import("node:stream/web").ReadableStream));
    } else {
      throw badRequest(
        "Content-Type no soportado (usa application/gzip o multipart/form-data)",
        "unsupported_content_type"
      );
    }

    const skill = await skills.opCompleteSkillUpload(token, source);
    return c.json({
      slug: skill.slug,
      name: skill.name,
      version: skill.version,
      totalBytes: skill.totalBytes,
    });
  });

  return app;
}

export function skillDownloadRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/:token", async (c) => {
    const { slug, stream } = await skills.opBuildSkillArchiveByToken(c.req.param("token"));
    c.header("Content-Type", "application/gzip");
    c.header("Content-Disposition", `attachment; filename="${slug}.tar.gz"`);
    return c.body(Readable.toWeb(stream) as unknown as ReadableStream);
  });

  return app;
}
