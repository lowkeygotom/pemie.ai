// Cifrado AES-256-GCM para secretos de canal (Anthropic BYOK).
// Clave: CHANNEL_SECRETS_KEY (32 bytes en base64).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";
import { badRequest } from "../services/errors.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function secretsKey(): Buffer {
  const raw = env.CHANNEL_SECRETS_KEY?.trim();
  if (!raw) throw badRequest("secrets_key_missing");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw badRequest("secrets_key_invalid");
  return buf;
}

/** Cifra texto plano. Formato: base64(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, secretsKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Descifra el payload de encryptSecret. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + 16) throw badRequest("bad_ciphertext");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, secretsKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
