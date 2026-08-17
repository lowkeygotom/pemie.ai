// REST del canal Telegram: status, link-token, llm-key, default project, disconnect.

import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireUser } from "./http.js";
import { badRequest } from "../services/errors.js";
import * as channels from "../services/channels.js";

const llmKeySchema = z.object({
  apiKey: z.string().min(20),
  provider: z.enum(["anthropic", "openai", "deepseek"]).optional(),
  model: z.string().optional(),
});

const defaultProjectSchema = z.object({
  projectId: z.string().nullable(),
});

const linkTokenSchema = z.object({
  projectId: z.string().optional(),
});

export function channelRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/telegram", async (c) => {
    const user = requireUser(c);
    return c.json({ channel: await channels.getChannelStatus(user.id) });
  });

  app.post("/telegram/link-token", async (c) => {
    const user = requireUser(c);
    const body = linkTokenSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("invalid_request_body");
    const result = await channels.createLinkToken(user.id, user.analyticsEnabled, body.data.projectId);
    return c.json(result, 201);
  });

  app.put("/telegram/llm-key", async (c) => {
    const user = requireUser(c);
    const body = llmKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_llm_key_body");
    await channels.setLlmKey(user.id, user.analyticsEnabled, body.data.apiKey, {
      provider: body.data.provider,
      model: body.data.model,
    });
    return c.json({ channel: await channels.getChannelStatus(user.id) });
  });

  app.delete("/telegram/llm-key/:provider", async (c) => {
    const user = requireUser(c);
    await channels.deleteLlmKey(user.id, c.req.param("provider"));
    return c.json({ channel: await channels.getChannelStatus(user.id) });
  });

  app.put("/telegram/default-project", async (c) => {
    const user = requireUser(c);
    const body = defaultProjectSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest("invalid_request_body");
    await channels.setDefaultProject(user.id, user.analyticsEnabled, body.data.projectId);
    return c.json({ channel: await channels.getChannelStatus(user.id) });
  });

  app.post("/telegram/disconnect", async (c) => {
    const user = requireUser(c);
    return c.json(await channels.disconnectChannel(user.id, user.analyticsEnabled));
  });

  return app;
}
