// Servicio F8: búsqueda transversal del proyecto. Un único punto de entrada
// para localizar una HU, un commit, una nota, una tarjeta o los hallazgos de
// brainstorming sin listar la
// colección entera — y sin necesitar una tool distinta por tipo de entidad.

import type { ApiKey } from "@prisma/client";
import { SCOPE_BY_TYPE, SEARCHABLE_TYPES, type ApiScope, type SearchableType } from "@pemie/shared";
import { prisma } from "../db.js";
import { badRequest } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY = 2;

export interface SearchHit {
  type: SearchableType;
  id: string;
  /** Identificador legible propio del tipo: key de la HU, sha corto del commit. */
  ref: string | null;
  title: string;
  createdAt: Date;
}

/**
 * Tipos que esta API key puede leer. La búsqueda respeta los scopes en vez de
 * esquivarlos: lo que la key no puede listar con su tool tampoco aparece aquí.
 * Lista vacía = la key no tiene ningún scope de lectura y no puede buscar.
 */
export function searchableTypesForKey(key: ApiKey): SearchableType[] {
  const scopes = key.scopes as ApiScope[];
  return SEARCHABLE_TYPES.filter((type) => scopes.includes(SCOPE_BY_TYPE[type]));
}

/** Scope de lectura de un tipo — el transporte lo usa para autorizar el proyecto. */
export function scopeForType(type: SearchableType): ApiScope {
  return SCOPE_BY_TYPE[type];
}

export interface SearchInput {
  query: string;
  types?: SearchableType[];
  limit?: number;
}

/** Busca en el proyecto (viewer+). */
export async function search(userId: string, projectId: string, input: SearchInput) {
  await projectWithAccess(userId, projectId);
  return opSearch(projectId, input, [...SEARCHABLE_TYPES]);
}

/**
 * Operación (ya autorizada): busca `query` en los tipos permitidos.
 *
 * `allowed` es lo que el llamador *puede* leer; `input.types` es lo que
 * *quiere* mirar. Se intersectan, así que pedir un tipo sin permiso no lo
 * revela — simplemente no aparece.
 */
export async function opSearch(
  projectId: string,
  input: SearchInput,
  allowed: SearchableType[]
): Promise<{ query: string; types: SearchableType[]; hits: SearchHit[] }> {
  const query = input.query.trim();
  if (query.length < MIN_QUERY) throw badRequest("query_too_short", { min: MIN_QUERY });

  const requested = input.types?.length ? input.types : allowed;
  const types = SEARCHABLE_TYPES.filter((t) => requested.includes(t) && allowed.includes(t));
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  // Se pide `limit` por tipo y luego se recorta el total: acota el trabajo de
  // la DB a 5×limit filas en el peor caso, sin que un tipo con muchas
  // coincidencias desplace por completo a los demás.
  const match = { contains: query, mode: "insensitive" as const };
  const hits: SearchHit[] = [];

  await Promise.all([
    types.includes("story")
      ? prisma.userStory
          .findMany({
            where: { projectId, OR: [{ key: match }, { title: match }] },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, key: true, title: true, createdAt: true },
          })
          .then((rows) =>
            hits.push(
              ...rows.map((r) => ({
                type: "story" as const,
                id: r.id,
                ref: r.key,
                title: r.title,
                createdAt: r.createdAt,
              }))
            )
          )
      : null,
    types.includes("commit")
      ? prisma.commit
          .findMany({
            where: { projectId, message: match },
            orderBy: { committedAt: "desc" },
            take: limit,
            select: { id: true, sha: true, message: true, committedAt: true },
          })
          .then((rows) =>
            hits.push(
              ...rows.map((r) => ({
                type: "commit" as const,
                id: r.id,
                ref: r.sha.slice(0, 7),
                title: r.message.split("\n")[0] ?? "",
                createdAt: r.committedAt,
              }))
            )
          )
      : null,
    types.includes("note")
      ? prisma.note
          .findMany({
            where: { projectId, OR: [{ message: match }, { response: match }] },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, message: true, createdAt: true },
          })
          .then((rows) =>
            hits.push(
              ...rows.map((r) => ({
                type: "note" as const,
                id: r.id,
                ref: null,
                title: r.message,
                createdAt: r.createdAt,
              }))
            )
          )
      : null,
    types.includes("card")
      ? prisma.card
          .findMany({
            // Card cuelga del Board, no del proyecto: se filtra por la relación.
            where: { board: { projectId }, OR: [{ title: match }, { description: match }] },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, title: true, createdAt: true },
          })
          .then((rows) =>
            hits.push(
              ...rows.map((r) => ({
                type: "card" as const,
                id: r.id,
                ref: null,
                title: r.title,
                createdAt: r.createdAt,
              }))
            )
          )
      : null,
    types.includes("brainstorm")
      ? prisma.brainstormNode
          .findMany({
            // Solo los hallazgos que forman la memoria útil de la mesa; las
            // decisiones, preguntas y riesgos quedan disponibles en el detalle.
            where: {
              type: { in: ["idea", "conclusion"] },
              session: { projectId },
              OR: [{ title: match }, { detail: match }, { session: { title: match } }],
            },
            orderBy: { session: { startedAt: "desc" } },
            take: limit,
            select: { id: true, key: true, title: true, session: { select: { startedAt: true } } },
          })
          .then((rows) =>
            hits.push(
              ...rows.map((r) => ({
                type: "brainstorm" as const,
                id: r.id,
                ref: r.key,
                title: r.title,
                createdAt: r.session.startedAt,
              }))
            )
          )
      : null,
  ]);

  hits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { query, types, hits: hits.slice(0, limit) };
}
