import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { Avatar, Badge, Card, EmptyState, ErrorText, SkeletonList } from "../../components/ui.js";

export default function LeaderboardTab({ ws, proj }: { ws: string; proj: string }) {
  const { t } = useTranslation("project");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.leaderboard(ws, proj),
    queryFn: () => api.leaderboard.get(ws, proj).then((r) => r.leaderboard),
    staleTime: STALE_TIME.moderate,
  });
  const entries = data ?? [];
  const errorMessage = error instanceof ApiError ? error.message : error ? t("storiesLoadError") : null;

  if (isLoading)
    return (
      <Card>
        <SkeletonList rows={4} />
      </Card>
    );

  return (
    <div className="space-y-6">
      <ErrorText>{errorMessage}</ErrorText>

      <Card>
        <h3 className="text-h4 text-ink-900">{t("leaderboard")}</h3>
        <p className="mt-1 text-body-sm text-ink-500">
          {t("leaderboardDescription")}
        </p>

        <div className="mt-4">
          {entries.length === 0 ? (
            <EmptyState
              title={t("leaderboardEmpty")}
              description={t("leaderboardEmptyDescription")}
            />
          ) : (
            <div className="divide-y divide-line-100">
              {entries.map((entry) => (
                <div
                  key={`${entry.actorType}:${entry.actorId}`}
                  className="flex items-center gap-3 -mx-6 px-6 py-3 hover:bg-surface-50"
                >
                  <Avatar label={entry.actorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body font-semibold text-ink-900">
                        {entry.actorName}
                      </span>
                      <Badge tone={entry.actorType === "agent" ? "brand" : "neutral"} dot mono>
                        {entry.actorType === "agent" ? t("agent") : t("person")}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-4 font-mono text-caption text-ink-400">
                    <span>{entry.storiesClosed} {entry.storiesClosed === 1 ? t("storiesClosed") : t("storiesClosedPlural")}</span>
                    <span>{entry.pointsDelivered} pts</span>
                    <span>{entry.avgDaysToClose != null ? `${entry.avgDaysToClose}${t("averageDays")}` : "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
