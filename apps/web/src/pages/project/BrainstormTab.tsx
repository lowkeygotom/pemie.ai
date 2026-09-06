import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { BrainstormSessionDetail } from "@pemie/shared";
import { api, ApiError } from "../../lib/api.js";
import { queryClient, queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { Badge, Button, Card, Collapsible, EmptyState, ErrorText, Input, Skeleton, SkeletonText } from "../../components/ui.js";
import { describeExtractionFailure } from "../../lib/brainstorm/extraction-messages.js";

function GraphMap({ session }: { session: BrainstormSessionDetail }) {
  const layers = ["data", "idea", "question", "risk", "decision", "action", "conclusion"];
  const positions = new Map(session.nodes.map((node) => {
    const layer = Math.max(0, layers.indexOf(node.type));
    const rank = session.nodes.filter((candidate) => layers.indexOf(candidate.type) === layer).indexOf(node);
    return [node.id, { x: 95 + layer * 145, y: 62 + rank * 84 }];
  }));
  const height = Math.max(280, ...Array.from(positions.values()).map((point) => point.y + 58));
  return <div className="overflow-x-auto rounded-md border border-line-200 bg-surface-50 p-3"><svg className="min-w-[900px]" width="1120" height={height} role="img" aria-label="Mapa del grafo de la sesión"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7z" className="fill-ink-400" /></marker></defs>{session.edges.map((edge) => { const from = positions.get(edge.fromNodeId); const to = positions.get(edge.toNodeId); return from && to ? <line key={edge.id} x1={from.x + 92} y1={from.y + 22} x2={to.x - 8} y2={to.y + 22} className="stroke-line-200" strokeWidth="2" markerEnd="url(#arrow)" /> : null; })}{layers.map((layer, index) => <text key={layer} x={95 + index * 145} y="24" className="fill-ink-400 font-mono text-[11px] uppercase">{layer}</text>)}{session.nodes.map((node) => { const point = positions.get(node.id)!; return <g key={node.id}><rect x={point.x - 8} y={point.y} width="116" height="48" rx="8" className="fill-surface-0 stroke-line-200" /><text x={point.x + 4} y={point.y + 19} className="fill-ink-900 text-[12px] font-semibold">{node.title.slice(0, 16)}</text><text x={point.x + 4} y={point.y + 36} className="fill-ink-400 font-mono text-[10px]">{node.key} · {node.status}</text></g>; })}</svg></div>;
}

/** mm:ss desde el arranque de la sesión: ubica la frase sin exponer la hora real. */
function stamp(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Lo que se dijo, tal cual, detrás de cada idea del grafo. */
function Highlights({ session }: { session: BrainstormSessionDetail }) {
  const { t } = useTranslation("project");
  const quoted = session.nodes
    .map((node) => ({ node, citations: (node.citations ?? []).filter((citation) => citation.verbatim) }))
    .filter((entry) => entry.citations.length > 0);
  if (!quoted.length) return <EmptyState title={t("brainstormHighlightsEmpty")} description={t("brainstormHighlightsEmptyDescription")} />;
  return (
    <div className="space-y-4">
      {quoted.map(({ node, citations }) => (
        <article key={node.id} className="border-l-2 border-line-200 pl-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <Badge tone="neutral" mono>{node.key}</Badge>
            <h4 className="text-body font-semibold text-ink-900">{node.title}</h4>
          </div>
          {citations.map((citation) => (
            <blockquote key={citation.id} className="mt-2 text-body text-ink-700">
              <span className="mr-2 font-mono text-caption text-ink-400">s{citation.segmentSeq}</span>
              “{citation.quote}”
            </blockquote>
          ))}
        </article>
      ))}
    </div>
  );
}

/** Transcripción completa, paginada aparte del detalle para no traer miles de filas en cada poll. */
function Transcript({ ws, proj, id, session }: { ws: string; proj: string; id: string; session: BrainstormSessionDetail }) {
  const { t } = useTranslation("project");
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...queryKeys.brainstorm(ws, proj), id, "segments"],
    queryFn: () => api.brainstorm.segments(ws, proj, id, { limit: 500 }).then((value) => value.segments),
    enabled: open,
    staleTime: STALE_TIME.moderate,
  });
  const speakerLabel = (tag: number | null) => {
    if (tag === null) return null;
    const speaker = session.speakers.find((candidate) => candidate.speakerTag === tag);
    return speaker?.label ?? t("brainstormSpeakerFallback", { tag: tag + 1 });
  };
  return (
    <Collapsible
      title={t("brainstormTranscript")}
      description={t("brainstormTranscriptHint")}
      badge={<Badge tone="neutral" mono>{session._count?.segments ?? session.segmentSeq}</Badge>}
      open={open}
      onOpenChange={setOpen}
    >
      {query.isLoading ? <SkeletonText lines={6} /> : null}
      {query.error ? <ErrorText>{query.error instanceof ApiError ? query.error.message : t("brainstormTranscriptError")}</ErrorText> : null}
      {query.data ? (
        query.data.length ? (
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-2">
            {query.data.map((segment) => (
              <p key={segment.id} className="text-body leading-relaxed text-ink-700">
                <span className="mr-2 font-mono text-caption text-ink-400">{stamp(segment.startMs)}</span>
                {speakerLabel(segment.speakerTag) ? <span className="mr-2 font-semibold text-ink-900">{speakerLabel(segment.speakerTag)}:</span> : null}
                {segment.text}
              </p>
            ))}
          </div>
        ) : <EmptyState compact title={t("brainstormTranscriptEmpty")} />
      ) : null}
    </Collapsible>
  );
}

function HarvestDetail({ ws, proj, id }: { ws: string; proj: string; id: string }) {
  const { t } = useTranslation("project");
  const detail = useQuery({ queryKey: [...queryKeys.brainstorm(ws, proj), id], queryFn: () => api.brainstorm.get(ws, proj, id).then((value) => value.session) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [...queryKeys.brainstorm(ws, proj), id] });
  const decide = useMutation({ mutationFn: ({ proposalId, decision }: { proposalId: string; decision: "accept" | "reject" }) => decision === "accept" ? api.brainstorm.acceptProposal(ws, proj, id, proposalId) : api.brainstorm.rejectProposal(ws, proj, id, proposalId), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => api.brainstorm.retryExtraction(ws, proj, id), onSuccess: refresh });
  if (detail.isLoading) return <Card><Skeleton className="h-8 w-2/5" /><Skeleton className="mt-4 h-24 w-full" /><Skeleton className="mt-6 h-72 w-full" /><Skeleton className="mt-6 h-28 w-full" /></Card>;
  if (detail.error || !detail.data) return <ErrorText>{detail.error instanceof ApiError ? detail.error.message : t("brainstormDetailError")}</ErrorText>;
  const session = detail.data;
  if (!session.summary && !session.nodes.length) return <EmptyState title={t("brainstormHarvestEmptyTitle")} description={t("brainstormHarvestEmptyDescription")} />;
  return <div className="space-y-6"><Card><p className="font-mono text-caption uppercase tracking-wider text-ink-400">{t("brainstormMinutes")}</p><div className="mt-3 whitespace-pre-line text-body leading-relaxed text-ink-700">{session.summary ?? t("brainstormHarvestPending")}</div></Card><Card><div className="mb-5 flex items-baseline justify-between gap-3"><div><h3 className="text-h4 text-ink-900">{t("brainstormHighlights")}</h3><p className="mt-1 text-body-sm text-ink-500">{t("brainstormHighlightsHint")}</p></div></div><Highlights session={session} /></Card><Card><Transcript ws={ws} proj={proj} id={id} session={session} /></Card><Card><div className="mb-5 flex items-baseline justify-between gap-3"><div><h3 className="text-h4 text-ink-900">{t("brainstormGraph")}</h3><p className="mt-1 text-body-sm text-ink-500">{t("brainstormGraphHint")}</p></div><Badge tone="neutral" mono>{session.nodes.length}</Badge></div>{session.nodes.length ? <GraphMap session={session} /> : <EmptyState title={t("brainstormGraphEmpty")} description={t("brainstormGraphEmptyDescription")} action={session.status !== "recording" ? <Button size="sm" variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? t("brainstormRetryExtractionPending") : t("brainstormRetryExtraction")}</Button> : undefined} />}{retry.error ? <ErrorText>{retry.error instanceof ApiError ? retry.error.message : t("brainstormRetryError")}</ErrorText> : null}{retry.data && !retry.data.ok ? <ErrorText>{describeExtractionFailure(retry.data.reason)}{retry.data.reason ? ` (${retry.data.reason})` : ""}</ErrorText> : null}</Card><Card><h3 className="text-h4 text-ink-900">{t("brainstormProposals")}</h3><p className="mt-1 text-body-sm text-ink-500">{t("brainstormProposalsHint")}</p><div className="mt-5 space-y-3">{session.proposals.length ? session.proposals.map((proposal) => <article key={proposal.id} className="rounded-md border border-line-200 bg-surface-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-body font-semibold text-ink-900">{proposal.title}</h4><p className="mt-1 font-mono text-caption text-ink-500">{proposal.priority} · {proposal.status}</p></div>{proposal.status === "pending" ? <div className="flex gap-2"><Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ proposalId: proposal.id, decision: "accept" })}>{t("brainstormAccept")}</Button><Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ proposalId: proposal.id, decision: "reject" })}>{t("brainstormReject")}</Button></div> : null}</div></article>) : <EmptyState title={t("brainstormProposalsEmpty")} description={t("brainstormProposalsEmptyDescription")} />}</div></Card>{decide.error ? <ErrorText>{decide.error instanceof ApiError ? decide.error.message : t("brainstormDecisionError")}</ErrorText> : null}</div>;
}

export default function BrainstormTab({ ws, proj }: { ws: string; proj: string }) {
  const { t, i18n } = useTranslation("project"); const [title, setTitle] = useState(""); const [selected, setSelected] = useState<string | null>(null); const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null); const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: queryKeys.brainstorm(ws, proj), queryFn: () => api.brainstorm.list(ws, proj), staleTime: STALE_TIME.moderate });
  const create = useMutation({ mutationFn: () => api.brainstorm.create(ws, proj, title), onSuccess: ({ session, recorderToken }) => { localStorage.setItem(`pemie:brainstorm:${session.id}:recorder-token`, recorderToken); void queryClient.invalidateQueries({ queryKey: queryKeys.brainstorm(ws, proj) }); navigate(`/w/${ws}/p/${proj}/mesa/${session.id}`); } });
  const remove = useMutation({ mutationFn: (id: string) => api.brainstorm.remove(ws, proj, id), onSuccess: (_result, id) => { setConfirmingDeleteId(null); if (selected === id) setSelected(null); void queryClient.invalidateQueries({ queryKey: queryKeys.brainstorm(ws, proj) }); } });
  const sessions = data?.sessions ?? []; const selectedId = useMemo(() => selected ?? sessions.find((session) => session.status === "closed")?.id ?? null, [selected, sessions]);
  if (isLoading) return <Card><Skeleton className="h-6 w-48" /><Skeleton className="mt-5 h-10 w-full" /><Skeleton className="mt-5 h-20 w-full" /></Card>;
  if (error) return <ErrorText>{error instanceof ApiError ? error.message : t("brainstormLoadError")}</ErrorText>;
  return <div className="space-y-6"><Card><h3 className="text-h4 text-ink-900">{t("brainstormTitle")}</h3><p className="mt-1 text-body-sm text-ink-500">{t("brainstormDescription")}</p>{data?.deepgramConfigured ? <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (title.trim().length >= 2) create.mutate(); }}><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("brainstormTitlePlaceholder")} aria-label={t("brainstormSessionTitle")} /><Button type="submit" disabled={title.trim().length < 2 || create.isPending}>{create.isPending ? t("brainstormCreating") : t("brainstormStart")}</Button></form> : <div className="mt-5"><EmptyState title={t("brainstormUnavailableTitle")} description={t("brainstormUnavailableDescription")} /></div>}</Card><Card><h3 className="text-h4 text-ink-900">{t("brainstormHistory")}</h3><div className="mt-4 divide-y divide-line-100">{sessions.length ? sessions.map((session) => <div key={session.id} className="flex w-full items-center gap-3 py-4"><button type="button" onClick={() => setSelected(session.id)} className="flex min-w-0 flex-1 items-center gap-3 px-1 text-left hover:opacity-80"><span className="min-w-0 flex-1"><span className="block truncate text-body font-semibold text-ink-900">{session.title}</span><span className="mt-1 block text-caption text-ink-400">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.startedAt))}</span></span><Badge tone={session.status === "recording" ? "brand" : "neutral"} mono>{t(`brainstormStatus.${session.status}`)}</Badge></button>{confirmingDeleteId === session.id ? <div className="flex shrink-0 items-center gap-2"><Button size="sm" variant="secondary" onClick={() => setConfirmingDeleteId(null)} disabled={remove.isPending}>{t("cancel")}</Button><Button size="sm" variant="danger" onClick={() => remove.mutate(session.id)} disabled={remove.isPending}>{remove.isPending ? t("deleting") : t("delete")}</Button></div> : <Button size="sm" variant="secondary" onClick={() => setConfirmingDeleteId(session.id)} aria-label={t("brainstormDeleteAria", { title: session.title })}>{t("delete")}</Button>}</div>) : <EmptyState title={t("brainstormEmpty")} description={t("brainstormEmptyDescription")} />}</div>{confirmingDeleteId ? <p className="mt-3 text-body-sm text-ink-500">{t("brainstormDeleteQuestion")}</p> : null}{remove.error ? <ErrorText>{remove.error instanceof ApiError ? remove.error.message : t("brainstormDeleteError")}</ErrorText> : null}</Card>{selectedId ? <HarvestDetail ws={ws} proj={proj} id={selectedId} /> : null}</div>;
}
