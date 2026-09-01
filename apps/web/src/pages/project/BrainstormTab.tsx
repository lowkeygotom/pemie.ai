import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api.js";
import { queryClient, queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { Badge, Button, Card, EmptyState, ErrorText, Input, Skeleton, SkeletonList } from "../../components/ui.js";

export default function BrainstormTab({ ws, proj }: { ws: string; proj: string }) {
  const { t, i18n } = useTranslation("project");
  const [title, setTitle] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.brainstorm(ws, proj),
    queryFn: () => api.brainstorm.list(ws, proj).then((result) => result.sessions),
    staleTime: STALE_TIME.moderate,
  });
  const create = useMutation({
    mutationFn: () => api.brainstorm.create(ws, proj, title),
    onSuccess: ({ session, recorderToken }) => {
      localStorage.setItem(`pemie:brainstorm:${session.id}:recorder-token`, recorderToken);
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.brainstorm(ws, proj) });
    },
  });

  const errorMessage = error instanceof ApiError
    ? error.message
    : error
      ? t("brainstormLoadError")
      : create.error instanceof ApiError
        ? create.error.message
        : create.error
          ? t("brainstormCreateError")
          : null;

  if (isLoading) return (
    <Card>
      <Skeleton className="mb-2 h-5 w-48" />
      <Skeleton className="mb-5 h-4 w-2/3" />
      <Skeleton className="mb-5 h-10 w-full" />
      <SkeletonList rows={3} />
    </Card>
  );

  const sessions = data ?? [];
  return (
    <div className="space-y-6">
      <ErrorText>{errorMessage}</ErrorText>
      <Card>
        <h3 className="text-h4 text-ink-900">{t("brainstormTitle")}</h3>
        <p className="mt-1 text-body-sm text-ink-500">{t("brainstormDescription")}</p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => { event.preventDefault(); if (title.trim().length >= 2) create.mutate(); }}
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("brainstormTitlePlaceholder")}
            aria-label={t("brainstormSessionTitle")}
          />
          <Button type="submit" disabled={title.trim().length < 2 || create.isPending}>
            {create.isPending ? t("brainstormCreating") : t("brainstormStart")}
          </Button>
        </form>

        <div className="mt-6">
          {sessions.length === 0 ? (
            <EmptyState
              title={t("brainstormEmpty")}
              description={t("brainstormEmptyDescription")}
            />
          ) : (
            <div className="divide-y divide-line-100">
              {sessions.map((session) => (
                <div key={session.id} className="-mx-6 flex flex-wrap items-center gap-3 px-6 py-4 hover:bg-surface-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold text-ink-900">{session.title}</p>
                    <p className="mt-1 text-caption text-ink-400">
                      {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.startedAt))}
                    </p>
                  </div>
                  <span className="font-mono text-caption text-ink-400">
                    {t("brainstormSegments", { count: session._count?.segments ?? session.segmentSeq })}
                  </span>
                  <Badge tone={session.status === "recording" ? "brand" : "neutral"} dot mono>
                    {t(`brainstormStatus.${session.status}`)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
