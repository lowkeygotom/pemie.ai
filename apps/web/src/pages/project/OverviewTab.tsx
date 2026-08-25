// PEM-45 + PEM-50: vista de estado del proyecto. Responde "dónde estamos" con
// dos bloques: la carga del tablero y el drift (dónde el tablero no coincide
// con la evidencia real de commits). Objetivo e informes quedan fuera a
// propósito: viven en su propia pestaña y repetirlos acá diluía el foco.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentActivity, DriftAlert, UserStoryStatus } from "@pemie/shared";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Badge,
  Avatar,
  type BadgeTone,
  BarList,
  Card,
  Collapsible,
  EmptyState,
  ErrorText,
  Notice,
  Skeleton,
  SkeletonList,
} from "../../components/ui.js";
import { formatDateOrDash, formatRelativeTime } from "../../lib/dates.js";

/** Etiqueta y tono de cada estado: la vista nunca muestra el valor crudo del backend. */
const STATUS_META: Record<UserStoryStatus, { key: string; tone: BadgeTone }> = { backlog: { key: "statusBacklog", tone: "neutral" }, ready: { key: "statusReady", tone: "brand" }, in_progress: { key: "statusInProgress", tone: "brand" }, review: { key: "statusReview", tone: "warning" }, done: { key: "statusDone", tone: "success" } };

const fmtDate = formatDateOrDash;

function alertDescription(alert: DriftAlert, t: (key: string, options?: Record<string, unknown>) => string): string {
  const e = alert.evidence;
  switch (e.type) {
    case "unreported_work":
      return t("driftUnreported", { count: e.commitCount, suffix: e.commitCount === 1 ? "" : "s", date: fmtDate(e.lastCommitAt) });
    case "stalled_wip":
      return e.lastCommitAt
        ? t("driftStalled", { count: e.daysSince, suffix: e.daysSince === 1 ? "" : "s", date: fmtDate(e.lastCommitAt) })
        : t("driftNeverCommitted", { count: e.daysSince, suffix: e.daysSince === 1 ? "" : "s" });
  }
}

function SkeletonOverview() {
  return (
    <div className="space-y-6">
      <Card>
        <Skeleton className="mb-4 h-5 w-36" />
        <SkeletonList rows={2} />
      </Card>
      <Card>
        <Skeleton className="mb-4 h-4 w-32" />
        <SkeletonList rows={5} />
      </Card>
      <Card>
        <Skeleton className="mb-4 h-4 w-40" />
        <SkeletonList rows={3} />
      </Card>
    </div>
  );
}

function activityIdentity(activity: AgentActivity): string {
  return activity.contributor?.name || activity.contributor?.githubLogin || activity.owner?.name || activity.agent?.name || activity.ownerUserId || activity.agentId || activity.apiKeyId;
}

function activitiesOverlap(left: AgentActivity, right: AgentActivity): boolean {
  if (left.userStoryId && left.userStoryId === right.userStoryId) return true;
  if (left.cardId && left.cardId === right.cardId) return true;
  return left.paths.some((path) => right.paths.some((otherPath) => {
    const a = path.replace(/\/$/, "");
    const b = otherPath.replace(/\/$/, "");
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  }));
}

function LiveActivityCard({ activities }: { activities: AgentActivity[] }) {
  const { t } = useTranslation("agents");
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-h4 text-ink-900">{t("now")}</h3>
        <span className="font-mono text-caption text-ink-400">{t("liveCount", { count: activities.length })}</span>
      </div>
      <div className="mt-4">
        {activities.length === 0 ? (
          <EmptyState title={t("noLiveActivity")} description={t("noLiveActivityDescription")} />
        ) : (
          <div className="divide-y divide-line-100">
            {activities.map((activity) => {
              const overlap = activities.some((other) => other.id !== activity.id && activitiesOverlap(activity, other));
              const identity = activityIdentity(activity);
              return (
                <div key={activity.id} className="flex items-start gap-3 py-3.5">
                  <Avatar label={identity} imageUrl={activity.contributor?.avatarUrl ?? activity.owner?.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={activity.state === "blocked" ? "warning" : "brand"} dot>
                        {activity.state === "blocked" ? t("blocked") : t("working")}
                      </Badge>
                      <span className="truncate text-body-sm font-medium text-ink-900">{identity}</span>
                      {activity.userStory ? <Badge tone="neutral" mono>{activity.userStory.key}</Badge> : null}
                    </div>
                    <p className="mt-1 text-body-sm text-ink-500">{activity.summary}</p>
                    <p className="mt-1 font-mono text-caption text-ink-400">{formatRelativeTime(activity.lastSeenAt)}</p>
                    {overlap ? (
                      <div className="mt-2">
                        <Notice tone="warning">{t("overlapWarning")}</Notice>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function OverviewTab({ ws, proj }: { ws: string; proj: string }) {
  const { t } = useTranslation("project");
  const alertMeta = { unreported_work: { label: t("driftUnreportedLabel"), tone: "danger" as const }, stalled_wip: { label: t("driftStalledLabel"), tone: "warning" as const } };
  const overviewQuery = useQuery({
    queryKey: queryKeys.overview(ws, proj),
    queryFn: () => api.projects.overview(ws, proj),
    staleTime: STALE_TIME.live,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.agentActivity(ws, proj),
    queryFn: () => api.projects.activity(ws, proj),
    staleTime: STALE_TIME.live,
    // Es el único polling del producto: esta franja evita pisadas mientras la
    // persona mira el proyecto; React Query deja de refrescar en pestaña oculta.
    refetchInterval: 20_000,
  });

  if (overviewQuery.isLoading || activityQuery.isLoading) return <SkeletonOverview />;

  if (overviewQuery.error || activityQuery.error) {
    const error = overviewQuery.error ?? activityQuery.error;
    return (
      <Card>
        <ErrorText>
          {error instanceof ApiError ? error.message : t("overviewLoadError")}
        </ErrorText>
      </Card>
    );
  }
  if (!overviewQuery.data || !activityQuery.data) return null;

  // `objective` y `latestReport` llegan en la respuesta pero no se pintan acá:
  // ya tienen su lugar en la pestaña "Objetivo e informes" y repetirlos diluía
  // el foco de esta vista. El servicio los sigue devolviendo porque
  // get_project_context los necesita para armar el contexto del agente.
  const { stats, wip, drift } = overviewQuery.data;
  const totalWip = wip.reduce((sum, col) => sum + col.cardCount, 0);

  return (
    <div className="space-y-6">
      <LiveActivityCard activities={activityQuery.data.live} />

      {/* WIP por columna */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-h4 text-ink-900">{t("boardLoad")}</h3>
          <span className="font-mono text-caption text-ink-400">
            {t("totalCards", { count: totalWip, suffix: totalWip === 1 ? "" : "s" })}
          </span>
        </div>
        {/* Las columnas van en el orden del tablero, no por tamaño: la vista
            tiene que leerse como el flujo Backlog → Hecho. */}
        <div className="mt-4">
          <BarList
            items={wip
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((col) => ({ label: col.name, value: col.cardCount }))}
            emptyLabel={t("boardLoadEmpty")}
          />
        </div>
        <p className="mt-4 text-caption text-ink-400">
          {t("commitsInRepos", { commits: stats.totalCommits, commitSuffix: stats.totalCommits === 1 ? "" : "s", repos: stats.repoCount, repoSuffix: stats.repoCount === 1 ? "" : "s" })}
        </p>
      </Card>

      {/* Drift (PEM-50 + PEM-51) */}
      <Collapsible
        title={t("driftAlerts")}
        badge={
          drift.correlationAvailable ? (
            <>
              <Badge tone={drift.alerts.length > 0 ? "danger" : "neutral"} mono>
                {t("alerts", { count: drift.alerts.length, suffix: drift.alerts.length === 1 ? "" : "s" })}
              </Badge>
              <Badge tone="neutral" mono>
                {t("coverage", { value: (drift.correlationCoverage * 100).toFixed(0) })}
              </Badge>
            </>
          ) : null
        }
      >
        {!drift.correlationAvailable ? (
          <Notice tone="info">
            {t("noCorrelation")}
          </Notice>
        ) : (
          <>
            <p className="mb-4 font-mono text-caption text-ink-400">
              {t("threshold", { days: drift.staleDaysThreshold })}
            </p>
            {drift.coverageBelowThreshold ? (
              <div className="mb-4">
                <Notice tone="info">
                  {t("lowCoverage", { coverage: (drift.correlationCoverage * 100).toFixed(0), threshold: (drift.coverageThreshold * 100).toFixed(0) })}
                </Notice>
              </div>
            ) : null}
            {drift.alerts.length === 0 ? (
              <EmptyState
                title={t("noAlerts")}
                description={t("noAlertsDescription")}
              />
            ) : (
              <div className="divide-y divide-line-100">
                {drift.alerts.map((alert) => {
                  const meta = alertMeta[alert.evidence.type];
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
                            {t(STATUS_META[alert.story.status].key)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-body-sm text-ink-500">{alertDescription(alert, t)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Collapsible>
    </div>
  );
}
