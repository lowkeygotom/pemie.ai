import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayMetrics } from "@pemie/shared";
import { api, analyticsFailureReason, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Input,
  MarkdownBody,
  SkeletonCard,
  SkeletonList,
  Stat,
  Textarea,
} from "../../components/ui.js";
import { formatDate, formatDateTime } from "../../lib/dates.js";

/** Informes antiguos o scope general pueden traer metrics null / incompleto. */
function dayMetricsForDisplay(metrics: DayMetrics | null): DayMetrics | null {
  if (!metrics || typeof metrics.commits !== "number") return null;
  return {
    commits: metrics.commits,
    contributors: metrics.contributors ?? 0,
    byDomain: metrics.byDomain ?? {},
    cardMoves: metrics.cardMoves ?? 0,
    storyStatusChanges: metrics.storyStatusChanges ?? 0,
  };
}

export default function ReportsTab({ ws, proj }: { ws: string; proj: string }) {
  const { t } = useTranslation("reports");
  const queryClient = useQueryClient();
  const objectiveQuery = useQuery({
    queryKey: queryKeys.objective(ws, proj),
    queryFn: () => api.objective.get(ws, proj).then((r) => r.objective),
    staleTime: STALE_TIME.moderate,
  });
  const reportsQuery = useQuery({
    queryKey: queryKeys.reports(ws, proj),
    queryFn: () => api.reports.list(ws, proj).then((r) => r.reports),
    staleTime: STALE_TIME.moderate,
  });
  const notesQuery = useQuery({
    queryKey: queryKeys.notes(ws, proj),
    queryFn: () => api.notes.list(ws, proj).then((r) => r.notes),
    staleTime: STALE_TIME.moderate,
  });
  const objective = objectiveQuery.data ?? null;
  const reports = reportsQuery.data ?? [];
  const notes = notesQuery.data ?? [];
  const loading = objectiveQuery.isLoading || reportsQuery.isLoading || notesQuery.isLoading;
  const loadError = objectiveQuery.error ?? reportsQuery.error ?? notesQuery.error;
  const [actionError, setActionError] = useState<string | null>(null);
  const error =
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : t("loadError")) : null);

  const [objText, setObjText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Sincroniza el textarea con el objetivo del servidor solo al entrar al
  // proyecto (o la primera vez que llega la respuesta) — nunca en una
  // revalidación en segundo plano: si no, un refetch por window focus
  // borraría lo que la persona está escribiendo en ese momento.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${ws}/${proj}`;
    if (objectiveQuery.isSuccess && syncedFor.current !== key) {
      syncedFor.current = key;
      setObjText(objective?.description ?? "");
    }
  }, [ws, proj, objectiveQuery.isSuccess, objective]);

  async function saveObjective() {
    if (objText.trim().length < 3) return;
    setActionError(null);
    try {
      await api.objective.set(ws, proj, objText.trim());
      track("report_objective_set");
      queryClient.invalidateQueries({ queryKey: queryKeys.objective(ws, proj) });
    } catch (e) {
      track("report_objective_set_failed", { reason: analyticsFailureReason(e) });
      setActionError(e instanceof ApiError ? e.message : t("saveObjectiveFailed"));
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setActionError(null);
    try {
      await api.notes.create(ws, proj, noteText.trim());
      track("report_note_created");
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(ws, proj) });
    } catch (e) {
      track("report_note_created_failed", { reason: analyticsFailureReason(e) });
      setActionError(e instanceof ApiError ? e.message : t("createNoteFailed"));
    }
  }

  async function answerNote(id: string) {
    const resp = (answers[id] ?? "").trim();
    if (!resp) return;
    await api.notes
      .answer(ws, proj, id, resp)
      .then(() => track("report_note_answered"))
      .catch((e) => track("report_note_answered_failed", { reason: analyticsFailureReason(e) }));
    setAnswers((a) => ({ ...a, [id]: "" }));
    // La respuesta puede quedar linkeada a un informe (`_count.notes` cambia).
    queryClient.invalidateQueries({ queryKey: queryKeys.notes(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.reports(ws, proj) });
  }

  if (loading)
    return (
      <div className="space-y-6">
        <SkeletonCard lines={2} />
        <SkeletonList rows={4} />
      </div>
    );

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>

      {/* Objetivo */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-h4 text-ink-900">{t("objective")}</h3>
          {objective && (
            <span className="font-mono text-caption text-ink-400">
              {t("updated")} {formatDate(objective.updatedAt)}
            </span>
          )}
        </div>
        <Textarea
          className="mt-3"
          rows={2}
          autoResize
          value={objText}
          onChange={(e) => setObjText(e.target.value)}
          placeholder={t("objectivePlaceholder")}
        />
        <div className="mt-3">
          <Button
            onClick={saveObjective}
            disabled={objText.trim() === (objective?.description ?? "")}
          >
            {t("saveObjective")}
          </Button>
        </div>
      </Card>

      {/* Informes */}
      <Card>
        <h3 className="text-h4 text-ink-900">{t("progressReports")}</h3>
        <div className="mt-4">
          {reports.length === 0 ? (
            <EmptyState
              title={t("noReports")}
              description={t("noReportsDescription")}
            />
          ) : (
            <div className="divide-y divide-line-100">
              {reports.map((r) => {
                const metrics = r.scope === "day" ? dayMetricsForDisplay(r.metrics) : null;
                return (
                <article
                  key={r.id}
                  className="-mx-6 space-y-3 px-6 py-4 hover:bg-surface-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-body">
                        <span className="font-mono text-ink-600">{r.date}</span>
                        {r.slot && (
                          <Badge tone="neutral" mono>
                            {r.slot}
                          </Badge>
                        )}
                        <Badge tone="neutral" mono>
                          {r.scope}
                        </Badge>
                        {r.verdict && (
                          <Badge tone="brand" mono wrap>
                            {r.verdict}
                          </Badge>
                        )}
                        {r.agent && (
                          <span className="text-body-sm text-ink-400">· {r.agent.name}</span>
                        )}
                      </p>
                      <p className="mt-1 font-mono text-caption text-ink-400">
                        {formatDateTime(r.createdAt)}
                      </p>
                    </div>
                    {r.score != null && (
                      <Stat value={Math.round(r.score)} label="score" />
                    )}
                  </div>
                  {metrics && (
                    <div className="flex flex-wrap gap-6">
                      <Stat value={metrics.commits} label={t("metricCommits")} />
                      <Stat value={metrics.contributors} label={t("metricContributors")} />
                      <Stat value={metrics.cardMoves} label={t("metricCardMoves")} />
                      <Stat value={metrics.storyStatusChanges} label={t("storyChanges")} />
                    </div>
                  )}
                  {r.comment ? (
                    <div className="rounded-md border border-line-100 bg-surface-0 p-4">
                      <MarkdownBody>{r.comment}</MarkdownBody>
                    </div>
                  ) : (
                    <p className="text-body-sm text-ink-400">{t("noComment")}</p>
                  )}
                </article>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Notas */}
      <Card>
        <h3 className="text-h4 text-ink-900">{t("notes")}</h3>
        <form onSubmit={addNote} className="mt-4 flex gap-2">
          <Input
            placeholder={t("notePlaceholder")}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            aria-label={t("newNoteAria")}
          />
          <Button type="submit">{t("addNote")}</Button>
        </form>
        <div className="mt-4">
          {notes.length === 0 ? (
            <EmptyState title={t("noNotes")} />
          ) : (
            <div className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg border border-line-200 bg-surface-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-body text-ink-900">
                      <MarkdownBody className="text-body">{n.message}</MarkdownBody>
                    </div>
                    <Badge
                      tone={n.status === "processed" ? "success" : "warning"}
                      dot
                    >
                      {n.status === "processed" ? t("noteAnswered") : t("notePending")}
                    </Badge>
                  </div>
                  {n.response ? (
                    <div className="mt-3 border-l-2 border-blue-600 pl-3 text-ink-600">
                      <MarkdownBody className="text-ink-600">{n.response}</MarkdownBody>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Input
                        placeholder={t("replyPlaceholder")}
                        value={answers[n.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [n.id]: e.target.value }))
                        }
                      />
                      <Button variant="secondary" onClick={() => answerNote(n.id)}>
                        {t("reply")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
