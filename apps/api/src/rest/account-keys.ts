// API de cuenta para keys personales: solo parsea HTTP y delega en agents.
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireUser } from "./http.js";
import { badRequest } from "../services/errors.js";
import * as agents from "../services/agents.js";

const createSchema = z.object({
  name: z.string(),
  scopes: z.array(z.string()),
  locale: z.enum(["es", "en"]).optional(),
  expiresAt: z.string().datetime().optional(),
});

const localeSchema = z.object({ locale: z.enum(["es", "en"]) });

export function accountKeyRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) =>
    c.json({ apiKeys: await agents.listPersonalApiKeys(requireUser(c).id) })
  );

  app.post("/", async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_api_key_body");
    const result = await agents.createPersonalApiKey(requireUser(c).id, {
      ...body.data,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : undefined,
    });
    return c.json(result, 201);
  });

  app.patch("/:keyId/locale", async (c) => {
    const body = localeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_api_key_body");
    const apiKey = await agents.updateApiKeyLocale(
      requireUser(c).id,
      c.req.param("keyId"),
      body.data.locale
    );
    return c.json({ apiKey });
  });

  app.delete("/:keyId", async (c) =>
    c.json(await agents.revokeApiKey(requireUser(c).id, c.req.param("keyId")))
  );

  return app;
}
