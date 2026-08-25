import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorText,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  Stat,
} from "../../components/ui.js";
import { formatDateTime, formatRelativeTime } from "../../lib/dates.js";
import type { AgentActivity } from "@pemie/shared";

function activityIdentity(activity: AgentActivity): string {
  return activity.contributor?.name || activity.contributor?.githubLogin || activity.owner?.name || activity.agent?.name || activity.ownerUserId || activity.agentId || activity.apiKeyId;
}

/** Actividad de alcance proyecto; la conexión y los agentes viven ahora en Equipo. */
export default function AgentTab({ ws, proj }: { ws: string; proj: string }) {
  const { t } = useTranslation("agents");
  const reliabilityQuery = useQuery({
    queryKey: queryKeys.agentReliability(ws, proj),
    queryFn: () => api.projects.agentReliability(ws, proj),
    staleTime: STALE_TIME.moderate,
  });
  const auditQuery = useQuery({
    queryKey: queryKeys.projectAudit(ws, proj),
    queryFn: () => api.audit.listForProject(ws, proj).then((r) => r.auditLogs),
    staleTime: STALE_TIME.moderate,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.agentActivity(ws, proj),
    queryFn: () => api.projects.activity(ws, proj),
    staleTime: STALE_TIME.moderate,
  });

  const logs = auditQuery.data ?? [];
  const reliability = reliabilityQuery.data;
  const reliabilityError =
    reliabilityQuery.error instanceof ApiError
      ? reliabilityQuery.error.message
      : reliabilityQuery.error
        ? t("reliabilityLoadFailed")
        : null;
  const auditError =
    auditQuery.error instanceof ApiError
      ? auditQuery.error.message
      : auditQuery.error
        ? t("activityLoadFailed")
        : null;
  const activityError =
    activityQuery.error instanceof ApiError
      ? activityQuery.error.message
      : activityQuery.error
        ? t("agentActivityLoadFailed")
        : null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-h4 text-ink-900">{t("standingActions")}</h3>
        <p className="mt-1 text-body-sm text-ink-500">
          {t("standingDescription")}
        </p>
        <div className="mt-4">
          <ErrorText>{reliabilityError}</ErrorText>
          {reliabilityQuery.isLoading ? (
            <SkeletonStats count={3} />
          ) : reliability && reliability.survivalRate === null ? (
            <EmptyState
              title={t("noActions")}
              description={t("noActionsDescription")}
            />
          ) : reliability && reliability.survivalRate != null ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <Stat
                  value={`${Math.round(reliability.survivalRate * 100)}%`}
                  label={t("survivalRate")}
                  delta={
                    reliability.revertedActions > 0
                      ? t("reverted", { count: reliability.revertedActions })
                      : undefined
                  }
                  deltaTone="danger"
                />
              </Card>
              <Card>
                <Stat value={reliability.agentActions} label={t("analyzedActions")} />
              </Card>
              <Card>
                <Stat value={`${reliability.windowDays}d`} label={t("window")} />
              </Card>
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <h3 className="text-h4 text-ink-900">{t("agentActivity")}</h3>
        <p className="mt-1 text-body-sm text-ink-500">{t("agentActivityDescription")}</p>
        <div className="mt-4">
          <ErrorText>{activityError}</ErrorText>
          {activityQuery.isLoading ? (
            <Card>
              <Skeleton className="mb-4 h-5 w-40" />
              <SkeletonList rows={4} />
            </Card>
          ) : activityQuery.data ? (
            <Card>
              {activityQuery.data.history.length === 0 ? (
                <EmptyState title={t("noAgentActivity")} description={t("noAgentActivityDescription")} />
              ) : (
                <>
                  <div className="divide-y divide-line-100">
                    {activityQuery.data.history.slice(0, 50).map((activity) => {
                      const identity = activityIdentity(activity);
                      const isIdle = activity.status === "idle";
                      return (
                        <div key={activity.id} className={isIdle ? "flex items-center justify-between -mx-6 bg-surface-50 px-6 py-2.5 text-ink-500" : "flex items-center justify-between -mx-6 px-6 py-2.5 hover:bg-surface-50"}>
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar label={identity} imageUrl={activity.contributor?.avatarUrl ?? activity.owner?.avatarUrl} size="sm" />
                            <Badge tone={isIdle ? "neutral" : "brand"} dot={!isIdle}>{identity}</Badge>
                            <span className={isIdle ? "truncate text-body-sm text-ink-500" : "truncate text-body-sm text-ink-700"}>{activity.summary}</span>
                            {activity.userStory ? <Badge tone="neutral" mono>{activity.userStory.key}</Badge> : null}
                            <Badge tone={activity.state === "blocked" ? "warning" : activity.state === "done" ? "success" : "neutral"}>
                              {t(`activityState.${activity.state}`)}
                            </Badge>
                            <Badge tone={activity.status === "active" ? "brand" : "neutral"} dot={activity.status === "active"}>
                              {t(`activityStatus.${activity.status}`)}
                            </Badge>
                          </span>
                          <span className="shrink-0 font-mono text-caption text-ink-400">
                            {isIdle ? t("seenAgo", { time: formatRelativeTime(activity.lastSeenAt) }) : formatDateTime(activity.lastSeenAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {activityQuery.data.history.length > 50 ? (
                    <p className="mt-3 text-caption text-ink-400">
                      {t("showing", { count: activityQuery.data.history.length })}
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          ) : null}
        </div>
      </section>

      <ErrorText>{auditError}</ErrorText>
      {auditQuery.isLoading ? (
        <Card>
          <Skeleton className="mb-4 h-5 w-48" />
          <SkeletonList rows={4} />
        </Card>
      ) : (
        <Card>
          <h3 className="text-h4 text-ink-900">{t("activity")}</h3>
          <p className="mt-2 text-body-sm text-ink-600">
            {t("activityDescription")}
          </p>
          <div className="mt-4">
            {logs.length === 0 ? (
              <EmptyState
                title={t("noActivity")}
                description={t("noActivityDescription")}
              />
            ) : (
              <>
                <div className="divide-y divide-line-100">
                  {logs.slice(0, 50).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between -mx-6 px-6 py-2.5 hover:bg-surface-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge tone={log.actorType === "agent" ? "brand" : "neutral"} dot>
                          {log.actorType}
                        </Badge>
                        <span className="truncate text-body-sm text-ink-700">{log.actorName}</span>
                        <code className="truncate font-mono text-caption text-ink-700">
                          {log.action}
                        </code>
                      </span>
                      <span className="shrink-0 font-mono text-caption text-ink-400">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
                {logs.length > 50 ? (
                  <p className="mt-3 text-caption text-ink-400">
                    {t("showing", { count: logs.length })}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
