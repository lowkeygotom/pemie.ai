import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import type { BrainstormNode } from "@pemie/shared";
import { api, ApiError } from "../../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../../lib/queryClient.js";
import { BrainstormRecorder } from "../../../lib/brainstorm/recorder.js";
import { Badge, Button, EmptyState, ErrorText, LiveDot, Modal, SkeletonBrainstorm } from "../../../components/ui.js";
import { useTheme } from "../../../lib/theme.js";

const nodeTone: Record<BrainstormNode["type"], "brand" | "warning" | "danger" | "neutral"> = {
  idea: "brand", decision: "brand", question: "warning", risk: "danger", action: "warning", data: "neutral", conclusion: "brand",
};

const NodeCard = memo(function NodeCard({ node, connections, updated }: { node: BrainstormNode; connections: string[]; updated: boolean }) {
  const tone = nodeTone[node.type];
  const border = tone === "danger" ? "border-red-600" : tone === "warning" ? "border-amber-600" : tone === "brand" ? "border-blue-600" : "border-line-200";
  return <article className={`relative animate-fade-up rounded-lg border-l-4 bg-surface-0 p-5 shadow-sm motion-reduce:animate-none ${border}`}>
    {updated ? <span aria-hidden className={`pointer-events-none absolute inset-0 animate-pulse rounded-lg border-2 motion-reduce:animate-none ${border}`} /> : null}
    <p className="font-mono text-caption uppercase tracking-wider text-ink-400">{node.type}</p>
    <h2 className="mt-2 text-h3 text-ink-900">{node.title}</h2>
    {node.detail ? <p className="mt-2 text-body-sm text-ink-500">{node.detail}</p> : null}
    {connections.map((connection) => <span key={connection} className="mt-3 inline-flex rounded-pill bg-surface-100 px-3 py-1 font-mono text-caption text-ink-600">↳ {connection}</span>)}
  </article>;
}, (left, right) => left.node.id === right.node.id && left.node.title === right.node.title && left.node.detail === right.node.detail && left.node.type === right.node.type && left.node.status === right.node.status && left.node.lastSeq === right.node.lastSeq && left.updated === right.updated && left.connections.join("|") === right.connections.join("|"));

export default function TableMode() {
  const { slug = "", projectSlug = "", sessionId = "" } = useParams();
  const { t } = useTranslation("project");
  const navigate = useNavigate();
  // La mesa salta el <Layout> (ProtectedBare), así que nadie más aplica el tema acá:
  // sin este hook, el cleanup de Layout borra data-theme de <html> al desmontarse y
  // la mesa se ve siempre clara, sin importar lo que el usuario tenía elegido.
  useTheme();
  const [recording, setRecording] = useState(false);
  // El consentimiento se pide una vez por sesión y se recuerda: un aviso que reaparece
  // después de finalizar se lee como algo pendiente y bloquea sin motivo.
  const consentKey = `pemie:brainstorm:${sessionId}:consent`;
  const [consented, setConsented] = useState(() => { try { return localStorage.getItem(consentKey) === "1"; } catch { return false; } });
  function acceptConsent() {
    try { localStorage.setItem(consentKey, "1"); } catch { /* modo privado: vale por esta vista */ }
    setConsented(true);
  }
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const recorder = useRef<BrainstormRecorder | null>(null);
  const previousLastSeq = useRef(new Map<string, number>());
  const recorderToken = localStorage.getItem(`pemie:brainstorm:${sessionId}:recorder-token`);
  // Contexto de a qué proyecto pertenece la mesa: sin esto, una persona que entra a
  // una sesión proyectada en pantalla no tiene forma de saber de qué proyecto es.
  const projectQuery = useQuery({
    queryKey: queryKeys.project(slug, projectSlug),
    queryFn: () => api.projects.get(slug, projectSlug).then((result) => result.project),
    staleTime: STALE_TIME.slow,
  });
  const project = projectQuery.data;
  const sessionQuery = useQuery({
    queryKey: [...queryKeys.brainstorm(slug, projectSlug), sessionId],
    queryFn: () => api.brainstorm.get(slug, projectSlug, sessionId).then((result) => result.session),
    refetchInterval: 10_000,
  });
  const byId = useMemo(() => new Map((sessionQuery.data?.nodes ?? []).map((node) => [node.id, node])), [sessionQuery.data?.nodes]);
  const updatedIds = new Set((sessionQuery.data?.nodes ?? []).filter((node) => {
    const previous = previousLastSeq.current.get(node.id);
    return previous !== undefined && previous !== node.lastSeq;
  }).map((node) => node.id));

  useEffect(() => {
    if (!sessionQuery.data) return;
    previousLastSeq.current = new Map(sessionQuery.data.nodes.map((node) => [node.id, node.lastSeq]));
  }, [sessionQuery.data]);

  useEffect(() => () => { if (recording) void recorder.current?.stop(); }, [recording]);
  if (sessionQuery.isLoading) return <SkeletonBrainstorm />;
  if (sessionQuery.error || !sessionQuery.data) return <div className="grid h-screen place-items-center"><ErrorText>{sessionQuery.error instanceof ApiError ? sessionQuery.error.message : t("brainstormLoadError")}</ErrorText></div>;
  const session = sessionQuery.data;
  const conclusions = session.nodes.filter((node) => node.type === "conclusion" || node.type === "decision" || node.status === "resolved");
  const open = session.nodes.filter((node) => !conclusions.includes(node));
  const connectionsFor = (node: BrainstormNode) => session.edges.filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id).slice(0, 2).flatMap((edge) => {
    const other = byId.get(edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId);
    return other ? [`${edge.type} «${other.title}»`] : [];
  });

  async function startRecording() {
    if (!recorderToken) return;
    try {
      setRecorderError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new BrainstormRecorder({
        token: () => api.brainstorm.sttToken(slug, projectSlug, sessionId),
        appendSegments: (segments) => api.brainstorm.appendSegments(slug, projectSlug, sessionId, recorderToken, segments),
        extract: () => api.brainstorm.extract(slug, projectSlug, sessionId),
        onError: setRecorderError,
      });
      recorder.current = next;
      await next.start(stream);
      setRecording(true);
    } catch (error) { setRecorderError(error instanceof Error ? error.message : t("brainstormRecordingError")); }
  }
  async function stopRecording() {
    try {
      await recorder.current?.stop();
    } catch (error) {
      setRecorderError(error instanceof Error ? error.message : t("brainstormRecordingError"));
    }
    try { await api.brainstorm.close(slug, projectSlug, sessionId); }
    catch (error) { setRecorderError(error instanceof Error ? error.message : t("brainstormRecordingError")); }
    setRecording(false);
  }

  return <main data-mesa className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-surface-50 text-ink-900">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line-200 bg-surface-0 px-6 py-4">
      <div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-caption text-ink-400">{recording ? <LiveDot label={t("brainstormRecording")} /> : t("brainstormTableMode")}</p>{project ? <Badge tone="neutral" mono>{project.key}</Badge> : null}{project ? <span className="font-mono text-caption text-ink-400">{project.name}</span> : null}</div><h1 className="mt-1 text-h2">{session.title}</h1></div>
      <div className="flex items-center gap-3">{recording ? <Button variant="danger" onClick={() => void stopRecording()}>{t("brainstormStop")}</Button> : recorderToken && consented ? <Button onClick={() => void startRecording()}>{t("brainstormStartRecording")}</Button> : recorderToken ? null : <span className="font-mono text-caption text-ink-400">{t("brainstormWatching")}</span>}<Button variant="secondary" onClick={() => navigate(`/w/${slug}/p/${projectSlug}?tab=brainstorm`)}>{t("brainstormExit")}</Button></div>
    </header>
    <div className="grid min-h-0 grid-cols-2 divide-x divide-line-200">
      <section className="min-h-0 overflow-y-auto p-6"><h2 className="text-h3">{t("brainstormSaying")}</h2><p className="mt-2 text-body-sm text-ink-500">{t("brainstormSayingHint")}</p><div className="mt-6 space-y-5">{session.nodes.length ? session.nodes.map((node) => <NodeCard key={node.id} node={node} connections={connectionsFor(node)} updated={updatedIds.has(node.id)} />) : <EmptyState title={t("brainstormWaitingTitle")} description={t("brainstormWaitingDescription")} />}</div></section>
      <aside className="min-h-0 overflow-y-auto bg-surface-0 p-6"><h2 className="text-h3">{t("brainstormConclusions")}</h2><div className="mt-6 space-y-5">{conclusions.length ? conclusions.map((node) => <NodeCard key={node.id} node={node} connections={connectionsFor(node)} updated={updatedIds.has(node.id)} />) : <EmptyState title={t("brainstormConclusionsEmpty")} description={t("brainstormConclusionsEmptyDescription")} />}<div className="border-t border-line-200 pt-6"><h2 className="text-h3">{t("brainstormOpen")}</h2><div className="mt-5 space-y-5">{open.length ? open.map((node) => <NodeCard key={node.id} node={node} connections={connectionsFor(node)} updated={updatedIds.has(node.id)} />) : <EmptyState title={t("brainstormOpenEmpty")} description={t("brainstormOpenEmptyDescription")} />}</div></div></div></aside>
    </div>
    {recorderToken && !consented ? <Modal title={t("brainstormConsentTitle")} onClose={() => {}} dismissible={false}><p className="text-body text-ink-600">{t("brainstormConsentDescription")}</p><Button className="mt-4 w-full" wrap onClick={acceptConsent}>{t("brainstormConsentAccept")}</Button></Modal> : null}
    {recorderError ? <div className="absolute bottom-5 right-5"><ErrorText>{recorderError}</ErrorText></div> : null}
  </main>;
}
