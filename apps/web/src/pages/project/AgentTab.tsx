import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  EmptyState,
  ErrorText,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  Stat,
} from "../../components/ui.js";

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
                        {new Date(log.createdAt).toLocaleString()}
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
