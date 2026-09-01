import { env } from "../env.js";
import { serviceUnavailable } from "../services/errors.js";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";

export function isDeepgramConfigured() {
  return Boolean(env.DEEPGRAM_API_KEY?.trim());
}

/** Emite un JWT corto: la key larga nunca sale del servidor. */
export async function grantListenToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const apiKey = env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw serviceUnavailable("deepgram_not_configured");

  const response = await fetch(GRANT_URL, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  const data = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!response.ok || typeof data?.access_token !== "string" || typeof data.expires_in !== "number") {
    throw serviceUnavailable("deepgram_token_unavailable");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
