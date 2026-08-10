// PEM-45 + PEM-50: vista de estado del proyecto. Responde "dónde estamos" con
// dos bloques: la carga del tablero y el drift (dónde el tablero no coincide
// con la evidencia real de commits). Objetivo e informes quedan fuera a
// propósito: viven en su propia pestaña y repetirlos acá diluía el foco.

import { useQuery } from "@tanstack/react-query";
import type { DriftAlert, DriftAlertType, UserStoryStatus } from "@pemie/shared";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Badge,
  type BadgeTone,
  Card,
  EmptyState,
  ErrorText,
  Notice,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  Stat,
} from "../../components/ui.js";

const ALERT_META: Record<DriftAlertType, { label: string; tone: BadgeTone }> = {
  unreported_work: { label: "Trabajo no reportado", tone: "danger" },
  stalled_wip: { label: "Estancada", tone: "warning" },
};

/** Etiqueta y tono de cada estado: la vista nunca muestra el valor crudo del backend. */
const STATUS_META: Record<UserStoryStatus, { label: string; tone: BadgeTone }> = {
  backlog: { label: "Backlog", tone: "neutral" },
  ready: { label: "Por hacer", tone: "brand" },
  in_progress: { label: "En progreso", tone: "brand" },
  review: { label: "Revisión", tone: "warning" },
  done: { label: "Hecho", tone: "success" },
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

const plural = (n: number, singular: string) => `${n} ${singular}${n === 1 ? "" : "s"}`;

function alertDescription(alert: DriftAlert): string {
  const e = alert.evidence;
  switch (e.type) {
    case "unreported_work":
      return `${plural(e.commitCount, "commit")} sin que la HU haya salido del backlog (último el ${fmtDate(e.lastCommitAt)}).`;
    case "stalled_wip":
      return e.lastCommitAt
        ? `Sin commits nuevos hace ${plural(e.daysSince, "día")} (último el ${fmtDate(e.lastCommitAt)}).`
        : `Sin ningún commit desde que entró en curso, hace ${plural(e.daysSince, "día")}.`;
  }
}

function SkeletonOverview() {
  return (
    <div className="space-y-6">
      <Card>
        <Skeleton className="mb-4 h-4 w-32" />
        <SkeletonStats count={5} />
      </Card>
      <Card>
        <Skeleton className="mb-4 h-4 w-40" />
        <SkeletonList rows={3} />
      </Card>
    </div>
  );
}

export default function OverviewTab({ ws, proj }: { ws: string; proj: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.overview(ws, proj),
    queryFn: () => api.projects.overview(ws, proj),
    staleTime: STALE_TIME.live,
  });

  if (isLoading) return <SkeletonOverview />;

  if (error) {
    return (
      <Card>
        <ErrorText>
          {error instanceof ApiError ? error.message : "No se pudo cargar el estado del proyecto"}
        </ErrorText>
      </Card>
    );
  }
  if (!data) return null;

  // `objective` y `latestReport` llegan en la respuesta pero no se pintan acá:
  // ya tienen su lugar en la pestaña "Objetivo e informes" y repetirlos diluía
  // el foco de esta vista. El servicio los sigue devolviendo porque
  // get_project_context los necesita para armar el contexto del agente.
  const { stats, wip, drift } = data;
  const totalWip = wip.reduce((sum, col) => sum + col.cardCount, 0);

  return (
    <div className="space-y-6">
      {/* WIP por columna */}
      <Card>
        <h3 className="text-h4 text-ink-900">Carga del tablero</h3>
        {wip.length === 0 ? (
          <div className="mt-4">
            <EmptyState compact title="El tablero todavía no tiene columnas" />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat value={totalWip} label="Tarjetas en total" />
            {wip
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((col) => (
                <Stat key={col.name} value={col.cardCount} label={col.name} />
              ))}
          </div>
        )}
        <p className="mt-4 text-caption text-ink-400">
          {stats.totalCommits} commit{stats.totalCommits === 1 ? "" : "s"} ingestados de{" "}
          {stats.repoCount} repo{stats.repoCount === 1 ? "" : "s"}.
        </p>
      </Card>

      {/* Drift (PEM-50) */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-h4 text-ink-900">Alertas de drift</h3>
          {drift.correlationAvailable ? (
            <span className="font-mono text-caption text-ink-400">
              umbral: {drift.staleDaysThreshold}d sin commits
            </span>
          ) : null}
        </div>

        {!drift.correlationAvailable ? (
          <div className="mt-4">
            <Notice tone="info">
              Este proyecto no referencia keys de HU (ej. "PRJ-123") en sus commits, así que no
              podemos comparar el tablero contra la evidencia real. El resto del resumen es igual
              de confiable.
            </Notice>
          </div>
        ) : drift.alerts.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Sin alertas"
              description="El tablero coincide con la evidencia de commits: nada parece fuera de sincronía."
            />
          </div>
        ) : (
          <div className="mt-4 divide-y divide-line-100">
            {drift.alerts.map((alert) => {
              const meta = ALERT_META[alert.evidence.type];
              return (
                <div key={`${alert.evidence.type}:${alert.story.id}`} className="flex items-start gap-3 py-3.5">
                  <Badge tone={meta.tone} dot>
                    {meta.label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-caption text-ink-400">{alert.story.key}</span>
                      <span className="truncate text-body-sm font-medium text-ink-900">
                        {alert.story.title}
                      </span>
                      <Badge tone={STATUS_META[alert.story.status].tone}>
                        {STATUS_META[alert.story.status].label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-body-sm text-ink-500">{alertDescription(alert)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
