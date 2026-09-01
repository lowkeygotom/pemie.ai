// Cliente deliberadamente pequeño para los trabajos server-side de Anthropic.
// Telegram conserva su cliente BYOK: unificar ambos sería un refactor distinto.
import { env } from "../env.js";

export interface CompleteJsonInput {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface CompleteJsonResult {
  json: unknown;
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export async function completeJson(input: CompleteJsonInput): Promise<CompleteJsonResult> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("anthropic_not_configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: input.maxTokens,
      system: input.system,
      tools: [{
        name: "emit_graph_ops",
        description: "Emite las operaciones validadas del grafo.",
        input_schema: { type: "object", additionalProperties: true },
      }],
      tool_choice: { type: "tool", name: "emit_graph_ops" },
      messages: [{ role: "user", content: input.user }],
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) throw new Error(`anthropic_${response.status}`);

  const body = await response.json() as {
    stop_reason?: string;
    content?: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  };
  if (body.stop_reason === "max_tokens") throw new Error("anthropic_truncated");
  const toolUse = body.content?.find((part) => part.type === "tool_use" && part.name === "emit_graph_ops");
  if (!toolUse?.input) throw new Error("anthropic_invalid_json");
  return {
    json: toolUse.input,
    model: "claude-sonnet-4-5-20250929",
    inputTokens: body.usage?.input_tokens,
    cachedInputTokens: body.usage?.cache_read_input_tokens,
    outputTokens: body.usage?.output_tokens,
  };
}
