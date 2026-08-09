import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, analyticsFailureReason, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
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

export default function ReportsTab({ ws, proj }: { ws: string; proj: string }) {
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
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : "Error cargando informes") : null);

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
      setActionError(e instanceof ApiError ? e.message : "No se pudo guardar el objetivo");
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
      setActionError(e instanceof ApiError ? e.message : "No se pudo crear la nota");
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
          <h3 className="text-h4 text-ink-900">Objetivo del proyecto</h3>
          {objective && (
            <span className="font-mono text-caption text-ink-400">
              actualizado {new Date(objective.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <Textarea
          className="mt-3"
          rows={2}
          autoResize
          value={objText}
          onChange={(e) => setObjText(e.target.value)}
          placeholder="¿Qué persigue este proyecto?"
        />
        <div className="mt-3">
          <Button
            onClick={saveObjective}
            disabled={objText.trim() === (objective?.description ?? "")}
          >
            Guardar objetivo
          </Button>
        </div>
      </Card>

      {/* Informes */}
      <Card>
        <h3 className="text-h4 text-ink-900">Informes de avance</h3>
        <div className="mt-4">
          {reports.length === 0 ? (
            <EmptyState
              title="Sin informes"
              description="Los publica un agente vía MCP (o manualmente por API)."
            />
          ) : (
            <div className="divide-y divide-line-100">
              {reports.map((r) => (
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
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {r.score != null && (
                      <Stat value={Math.round(r.score)} label="score" />
                    )}
                  </div>
                  {r.comment ? (
                    <div className="rounded-md border border-line-100 bg-surface-0 p-4">
                      <MarkdownBody>{r.comment}</MarkdownBody>
                    </div>
                  ) : (
                    <p className="text-body-sm text-ink-400">Sin comentario.</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Notas */}
      <Card>
        <h3 className="text-h4 text-ink-900">Notas</h3>
        <form onSubmit={addNote} className="mt-4 flex gap-2">
          <Input
            placeholder="Escribe una nota o pregunta…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            aria-label="Nueva nota"
          />
          <Button type="submit">Agregar</Button>
        </form>
        <div className="mt-4">
          {notes.length === 0 ? (
            <EmptyState title="Sin notas" />
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
                      {n.status === "processed" ? "respondida" : "pendiente"}
                    </Badge>
                  </div>
                  {n.response ? (
                    <div className="mt-3 border-l-2 border-blue-600 pl-3 text-ink-600">
                      <MarkdownBody className="text-ink-600">{n.response}</MarkdownBody>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Input
                        placeholder="Responder…"
                        value={answers[n.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [n.id]: e.target.value }))
                        }
                      />
                      <Button variant="secondary" onClick={() => answerNote(n.id)}>
                        Responder
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
