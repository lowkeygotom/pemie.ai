import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatNarrative } from "@pemie/shared";
import { api, analyticsFailureReason, ApiError, type AssignmentNotification, type UserStory } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  ErrorText,
  Input,
  Modal,
  PencilIcon,
  Select,
  TrashIcon,
  Notice,
} from "../../components/ui.js";
import StoryDetailModal from "./StoryDetailModal.js";
import InvitePersonModal from "../../components/InvitePersonModal.js";

const STATUSES = ["backlog", "ready", "in_progress", "review", "done"];
const PRIORITIES = ["low", "medium", "high", "critical"];

const STATUS_TONE: Record<string, BadgeTone> = {
  backlog: "neutral",
  ready: "brand",
  in_progress: "brand",
  review: "warning",
  done: "success",
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "brand",
  high: "warning",
  critical: "danger",
};

export default function StoriesTab({ ws, proj, canManage }: { ws: string; proj: string; canManage: boolean }) {
  const { t } = useTranslation("project");
  const queryClient = useQueryClient();
  const storiesQuery = useQuery({
    queryKey: queryKeys.stories(ws, proj),
    queryFn: () => api.stories.list(ws, proj).then((r) => r.userStories),
    staleTime: STALE_TIME.live,
  });
  const epicsQuery = useQuery({
    queryKey: queryKeys.epics(ws, proj),
    queryFn: () => api.epics.list(ws, proj).then((r) => r.epics),
    staleTime: STALE_TIME.live,
  });
  const stories = storiesQuery.data ?? [];
  const epics = epicsQuery.data ?? [];
  const loading = storiesQuery.isLoading || epicsQuery.isLoading;
  const loadError = storiesQuery.error ?? epicsQuery.error;
  const [actionError, setActionError] = useState<string | null>(null);
  const error =
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : t("storiesLoadError")) : null);

  /** HU + board comparten tarjeta (una HU nueva crea su card): invalidar ambas. */
  function invalidateAfterStoryChange() {
    queryClient.invalidateQueries({ queryKey: queryKeys.stories(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.epics(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.board(ws, proj) });
  }

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [role, setRole] = useState("");
  const [want, setWant] = useState("");
  const [benefit, setBenefit] = useState("");

  const [editingStory, setEditingStory] = useState<UserStory | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<{ story: UserStory; notification: AssignmentNotification } | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const storyParam = searchParams.get("story");

  // Deep link (PEM-38): `?story=<KEY>` abre el detalle de esa HU en cuanto la
  // lista carga. Una key que no resuelve (HU eliminada, correo viejo) deja la
  // lista visible sin error: el tab ya es el destino útil del enlace.
  useEffect(() => {
    if (!storyParam) return;
    const found = stories.find((s) => s.key.toLowerCase() === storyParam.toLowerCase());
    // No re-setear si ya se edita esa HU: un refetch en segundo plano no debe
    // reiniciar el estado del modal abierto.
    if (found) setEditingStory((prev) => (prev?.id === found.id ? prev : found));
  }, [storyParam, stories]);

  // Abrir/cerrar el detalle se refleja en la URL: cualquier HU queda enlazable
  // copiando la barra de direcciones con el modal abierto.
  function openStory(story: UserStory) {
    setEditingStory(story);
    const next = new URLSearchParams(searchParams);
    next.set("story", story.key);
    setSearchParams(next, { replace: true });
  }

  function closeStory() {
    setEditingStory(null);
    const next = new URLSearchParams(searchParams);
    next.delete("story");
    // Cerrar el detalle de una HU siempre deja al usuario en el tab de historias:
    // fijarlo sin condición evita depender de que el `?tab=` entrante sea válido
    // (un enlace truncado con ?tab=bogus no debe rebotar a `commits` al cerrar).
    next.set("tab", "stories");
    setSearchParams(next, { replace: true });
  }

  const [pendingDelete, setPendingDelete] = useState<UserStory | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Marcado por defecto: la tarjeta nace con la HU, así que lo esperable es que
  // se vaya con ella. Quien quiera conservarla lo desmarca (PEM-19).
  const [deleteCard, setDeleteCard] = useState(true);

  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setActionError(null);
    try {
      await api.stories.create(ws, proj, {
        title: title.trim(),
        priority,
        narrative:
          role || want || benefit ? { role, want, benefit } : undefined,
      });
      track("story_created");
      setTitle("");
      setRole("");
      setWant("");
      setBenefit("");
      setPriority("medium");
      invalidateAfterStoryChange();
    } catch (e) {
      track("story_created_failed", { reason: analyticsFailureReason(e) });
      setActionError(e instanceof ApiError ? e.message : t("storyCreateError"));
    }
  }

  async function setStatus(id: string, status: string) {
    const key = queryKeys.stories(ws, proj);
    const from = stories.find((s) => s.id === id)?.status;
    // Cancelar primero los refetches en vuelo: uno que resolviera después de la
    // escritura optimista la pisaría con el estado anterior del servidor.
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<UserStory[]>(key);
    queryClient.setQueryData<UserStory[]>(key, (prev) =>
      (prev ?? []).map((s) => (s.id === id ? { ...s, status } : s))
    );
    try {
      await api.stories.update(ws, proj, id, { status });
      if (from && from !== status) track("story_status_changed", { from_status: from, to_status: status });
      // Cada tarjeta del tablero embebe el `status` de su HU: sin invalidarlo
      // el Kanban sigue mostrando el estado viejo hasta que expire su staleTime.
      queryClient.invalidateQueries({ queryKey: queryKeys.board(ws, proj) });
    } catch {
      // Corrige de inmediato con el valor anterior; no hace falta esperar el
      // round-trip de un refetch para que la UI deje de mentir.
      queryClient.setQueryData(key, previous);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.stories.remove(ws, proj, pendingDelete.id, !deleteCard);
      track("story_deleted", { card_deleted: deleteCard });
      setPendingDelete(null);
      setDeleteCard(true);
      invalidateAfterStoryChange();
    } catch (e) {
      track("story_delete_failed", { reason: analyticsFailureReason(e) });
      setDeleteError(e instanceof ApiError ? e.message : t("storyDeleteError"));
    } finally {
      setDeleting(false);
    }
  }

  if (loading)
    return (
      <div className="space-y-6">
        <SkeletonCard lines={2} />
        <Card>
          <Skeleton className="mb-4 h-5 w-32" />
          <SkeletonList rows={4} />
        </Card>
      </div>
    );

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>

      {/* Nueva HU */}
      <Card>
        {assignmentNotice ? <Notice tone={assignmentNotice.notification.notified ? (assignmentNotice.notification.contentLite ? "warning" : "success") : assignmentNotice.notification.reason === "notification_error" ? "danger" : assignmentNotice.notification.reason === "recently_notified" ? "info" : "warning"} onDismiss={() => setAssignmentNotice(null)}>
          {assignmentNotice.notification.notified
            ? <>{t("assignNotice", { key: assignmentNotice.story.key, name: assignmentNotice.story.assignee?.name ?? t("noAssignee") })}{assignmentNotice.notification.contentLite ? t("assignmentLite", { email: assignmentNotice.notification.email }) : t("assignmentSent", { email: assignmentNotice.notification.email })}{assignmentNotice.notification.contentLite && canManage && assignmentNotice.notification.email ? <Button size="sm" variant="secondary" onClick={() => setInviteEmail(assignmentNotice.notification.email!)}>{t("inviteToWorkspace")}</Button> : null}</>
            : assignmentNotice.notification.reason === "recently_notified"
              ? t("assignmentRecentlyNotified", { key: assignmentNotice.story.key })
              : assignmentNotice.notification.reason === "notification_error"
                ? t("assignmentEmailFailed", { key: assignmentNotice.story.key })
                : t("assignmentNoEmail", { key: assignmentNotice.story.key })}
        </Notice> : null}
        <h3 className="text-h4 text-ink-900">{t("newStory")}</h3>
        <form onSubmit={createStory} className="mt-4 space-y-4">
          <Field label={t("title")}>
            <Input
              placeholder={t("storyExample")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t("storyTitleAria")}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`${t("narrativeAs")} (${t("role")})`}>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label={t("role")}
              />
            </Field>
            <Field label={`${t("want")}…`}>
              <Input
                value={want}
                onChange={(e) => setWant(e.target.value)}
                aria-label={t("want")}
              />
            </Field>
            <Field label={`${t("benefit")}…`}>
              <Input
                value={benefit}
                onChange={(e) => setBenefit(e.target.value)}
                aria-label={t("benefit")}
              />
            </Field>
          </div>

          <div className="flex items-end justify-between gap-3 border-t border-line-100 pt-4">
            <div className="w-40">
              <Field label={t("priority")}>
                <Select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  aria-label={t("priority")}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit">{t("create")}</Button>
          </div>
        </form>
      </Card>

      {/* Lista */}
      <Card>
        <h3 className="text-h4 text-ink-900">{t("stories", { count: stories.length })}</h3>
        <div className="mt-4">
          {stories.length === 0 ? (
            <EmptyState
              title={t("noStories")}
              description={t("noStoriesDescription")}
            />
          ) : (
            <div className="divide-y divide-line-100">
              {stories.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start justify-between gap-3 -mx-6 px-6 py-3 hover:bg-surface-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand" mono>
                        {s.key}
                      </Badge>
                      <span className="text-body font-medium text-ink-900">{s.title}</span>
                    </div>
                    {formatNarrative(s.narrative) && (
                      <p className="mt-1 text-body-sm text-ink-500">{formatNarrative(s.narrative)}</p>
                    )}
                    <div className="mt-1.5">
                      <Badge tone={PRIORITY_TONE[s.priority] ?? "neutral"} mono>
                        {s.priority}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[s.status] ?? "neutral"} dot>
                      {s.status}
                    </Badge>
                    <Select
                      value={s.status}
                      onChange={(e) => setStatus(s.id, e.target.value)}
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-surface-100 hover:text-ink-900"
                      aria-label={t("editStory", { key: s.key, title: s.title })}
                      onClick={() => openStory(s)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-red-100 hover:text-red-600"
                      aria-label={t("deleteStoryAria", { key: s.key, title: s.title })}
                      onClick={() => setPendingDelete(s)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {epics.length > 0 && (
        <Card>
          <h3 className="text-h4 text-ink-900">{t("epics")}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {epics.map((e) => (
              <Badge key={e.id} tone="brand">
                {e.title} · {e._count.stories}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {editingStory && (
        <StoryDetailModal
          story={editingStory}
          ws={ws}
          proj={proj}
          epics={epics}
          onClose={closeStory}
          canManage={canManage}
          onSaved={(updated, notification) => {
            if (notification && notification.reason !== "self_assignment" && notification.reason !== "unassigned")
              setAssignmentNotice({ story: updated, notification });
            closeStory();
            invalidateAfterStoryChange();
          }}
        />
      )}

      {pendingDelete && (
        <Modal
          title={t("deleteStoryTitle")}
          onClose={() => {
            if (!deleting) {
              setPendingDelete(null);
              setDeleteError(null);
              setDeleteCard(true);
            }
          }}
        >
          <div className="space-y-4">
            <ErrorText>{deleteError}</ErrorText>
            <p className="text-body text-ink-700">
              {t("deleteStoryQuestion", { key: pendingDelete.key, title: pendingDelete.title })}
            </p>
            <Checkbox checked={deleteCard} onChange={setDeleteCard}>
              {t("deleteCardToo")}
            </Checkbox>
            <p className="text-body-sm text-ink-500">
              {deleteCard
                ? t("cardDeletedWithStory") : t("cardKeptWithoutStory")}
            </p>
            <div className="flex justify-end gap-2 border-t border-line-100 pt-4">
              <Button
                variant="secondary"
                disabled={deleting}
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError(null);
                  setDeleteCard(true);
                }}
              >
                {t("cancel")}
              </Button>
              <Button variant="danger" disabled={deleting} onClick={confirmDelete}>
                {deleting ? t("deleting") : t("delete")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {inviteEmail ? <InvitePersonModal ws={ws} initialEmail={inviteEmail} onClose={() => setInviteEmail(null)} /> : null}
    </div>
  );
}
