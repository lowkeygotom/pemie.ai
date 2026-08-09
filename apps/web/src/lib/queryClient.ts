// Cliente de TanStack Query + claves de caché por proyecto.
//
// Los agentes MCP escriben datos en paralelo a lo que la persona ve en pantalla
// (mueven tarjetas, publican informes, crean HUs) sin que haya ningún evento en
// el navegador que lo anuncie. `staleTime` decide cuánto tiempo se muestra una
// respuesta cacheada antes de revalidar; `refetchOnWindowFocus` cubre el caso
// típico de volver a la pestaña después de que un agente trabajó mientras tanto.
import { QueryClient } from "@tanstack/react-query";

/** Mismo shape que el filtro de `api.commits.list`. */
type CommitsFilter = { domain?: string; contributorId?: string; limit?: number; since?: string };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

/** Tiempos de frescura por tipo de dato, según qué tan seguido lo tocan agentes. */
export const STALE_TIME = {
  /** board / stories: los agentes mueven tarjetas y crean HUs todo el tiempo. */
  live: 30_000,
  /** reports / notes / leaderboard / activity: derivados, cambian con menos frecuencia. */
  moderate: 60_000,
  /** commits / stats: solo cambian tras un sync explícito con GitHub. */
  slow: 120_000,
} as const;

/**
 * Claves de caché por proyecto. Todas empiezan con `[recurso, ws, proj]` para
 * poder invalidar por prefijo (`queryClient.invalidateQueries({ queryKey: [...] })`)
 * sin tener que enumerar cada variante (p. ej. commits con distintos filtros).
 */
export const queryKeys = {
  repos: (ws: string, proj: string) => ["repos", ws, proj] as const,
  stats: (ws: string, proj: string) => ["stats", ws, proj] as const,
  commits: (ws: string, proj: string, filter: CommitsFilter) =>
    ["commits", ws, proj, filter] as const,
  /** Prefijo de todas las variantes de commits: invalida el listado sea cual sea el filtro activo. */
  commitsAll: (ws: string, proj: string) => ["commits", ws, proj] as const,
  leaderboard: (ws: string, proj: string) => ["leaderboard", ws, proj] as const,
  search: (ws: string, proj: string, q: string) => ["search", ws, proj, q] as const,
  objective: (ws: string, proj: string) => ["objective", ws, proj] as const,
  reports: (ws: string, proj: string) => ["reports", ws, proj] as const,
  notes: (ws: string, proj: string) => ["notes", ws, proj] as const,
  epics: (ws: string, proj: string) => ["epics", ws, proj] as const,
  stories: (ws: string, proj: string) => ["stories", ws, proj] as const,
  contributors: (ws: string, proj: string) => ["contributors", ws, proj] as const,
  board: (ws: string, proj: string) => ["board", ws, proj] as const,
  cardActivities: (ws: string, proj: string, cardId: string) =>
    ["cardActivities", ws, proj, cardId] as const,
  projectAudit: (ws: string, proj: string) => ["projectAudit", ws, proj] as const,
};
