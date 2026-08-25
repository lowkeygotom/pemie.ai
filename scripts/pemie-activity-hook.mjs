#!/usr/bin/env node

// Este hook es telemetría de apoyo: cualquier entrada inesperada o fallo de red
// se descarta para que jamás interfiera con la edición que intenta observar.

import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MCP_URL = process.env.PEMIE_MCP_URL?.trim() || "https://pemieai.vercel.app/mcp";
const SUMMARY = process.env.PEMIE_ACTIVITY_SUMMARY?.trim() || null;

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value ? JSON.parse(value) : null;
}

function pathsFromPatch(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((match) => match[1]?.trim());
}

function eventPaths(event) {
  const input = event?.tool_input ?? event?.toolInput ?? event?.input ?? {};
  const direct = input.file_path ?? input.filePath ?? input.path;
  if (typeof direct === "string") return [direct];
  if (typeof input.patch === "string") return pathsFromPatch(input.patch);
  return typeof input === "string" ? pathsFromPatch(input) : [];
}

function repoPath(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  const absolute = resolve(eventCwd, candidate.trim());
  const path = relative(REPO_ROOT, absolute);
  if (!path || path === ".." || path.startsWith(`..${sep}`)) return null;
  return path.split(sep).join("/");
}

let eventCwd = REPO_ROOT;

async function main() {
  const apiKey = process.env.PEMIE_MCP_API_KEY?.trim();
  if (!apiKey) return;

  const event = await readStdin();
  if (typeof event?.cwd === "string") eventCwd = event.cwd;
  const paths = [...new Set(eventPaths(event).map(repoPath).filter((path) => path !== null))];
  if (!paths.length) return;

  const projectId = process.env.PEMIE_PROJECT_ID?.trim();
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `activity-${Date.now()}`,
      method: "tools/call",
      params: {
        name: "report_activity",
        arguments: {
          paths,
          ...(SUMMARY ? { summary: SUMMARY } : {}),
          ...(projectId ? { projectId } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(2_000),
  });
}

try {
  await main();
} catch {
  // Una señal perdida es preferible a bloquear o ensuciar la herramienta editora.
}
