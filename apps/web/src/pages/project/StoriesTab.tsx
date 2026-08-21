import { Fragment, useEffect, useState } from "react";
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
  ListRow,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  ErrorText,
  Input,
  Modal,
  PencilIcon,
  Select,
  Switch,
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

/** Sentinel de `?epic=` para "HUs sin épica" (distinto de una key real de proyecto). */
const NO_EPIC_FILTER = "none";

export default function StoriesTab({ ws, proj, canManage }: { ws: string; proj: string; canManage: boolean }) {
  const { t } = useTranslation("project");
  const queryClient = useQueryClient();
  // PEM-57: épicas y HUs viven en la misma tabla — una sola query trae todo.
  const storiesQuery = useQuery({
    queryKey: queryKeys.stories(ws, proj),
    queryFn: () => api.stories.list(ws, proj).then((r) => r.userStories),
    staleTime: STALE_TIME.live,
  });
  const stories = storiesQuery.data ?? [];
  const loading = storiesQuery.isLoading;
  const loadError = storiesQuery.error;
  const [actionError, setActionError] = useState<string | null>(null);
  const error =
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : t("storiesLoadError")) : null);

  // Derivado localmente: épicas, sus hijas agrupadas por epicId, y HUs sueltas.
  const epics = stories.filter((s) => s.isEpic);
  const childrenByEpicId = new Map<string, UserStory[]>();
  const orphanStories: UserStory[] = [];
  for (const s of stories) {
    if (s.isEpic) continue;
    if (s.epicId) {
      const arr = childrenByEpicId.get(s.epicId) ?? [];
      arr.push(s);
      childrenByEpicId.set(s.epicId, arr);
    } else {
      orphanStories.push(s);
    }
  }
  function childCountFor(epic: UserStory): number {
    return epic._count?.children ?? childrenByEpicId.get(epic.id)?.length ?? 0;
  }

  /** HU + board comparten tarjeta (una HU nueva crea su card): invalidar ambas. */
  function invalidateAfterStoryChange() {
    queryClient.invalidateQueries({ queryKey: queryKeys.stories(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.board(ws, proj) });
  }

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [role, setRole] = useState("");
  const [want, setWant] = useState("");
  const [benefit, setBenefit] = useState("");
  const [isEpic, setIsEpic] = useState(false);

  // Plegado por defecto: una épica con varias hijas no las vuelca todas en la
  // lista de entrada. `selectedEpic` (filtro por épica) fuerza el despliegue
  // de esa épica puntual — es exactamente lo que se pidió al filtrar por ella.
  const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(new Set());
  function toggleEpic(id: string) {
    setExpandedEpicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [editingStory, setEditingStory] = useState<UserStory | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<{ story: UserStory; notification: AssignmentNotification } | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const storyParam = searchParams.get("story");
  const epicParam = searchParams.get("epic");

  // Filtro por épica (AC3), persistido en la URL igual que el deep link `?story=`:
  // "" = todas, "none" = solo HUs sin épica, o la key de una épica puntual.
  function setEpicFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("epic", value);
    else next.delete("epic");
    setSearchParams(next, { replace: true });
  }

  const selectedEpicKey = epicParam && epicParam !== NO_EPIC_FILTER ? epicParam : null;
  // Una key inválida (deep link viejo) no rompe el filtro: cae de vuelta a "todas",
  // igual que el deep link de `?story=` ignora una key que no resuelve.
  const selectedEpic = selectedEpicKey
    ? (epics.find((e) => e.key.toLowerCase() === selectedEpicKey.toLowerCase()) ?? null)
    : null;
  const showOnlyOrphans = epicParam === NO_EPIC_FILTER;
  const visibleEpics = showOnlyOrphans ? [] : selectedEpic ? [selectedEpic] : epics;
  const visibleOrphans = selectedEpic ? [] : orphanStories;
  const hasVisibleContent = visibleEpics.length > 0 || visibleOrphans.length > 0;

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
  // Distinto de `deleteError`: solo se setea cuando el borrado falló porque la
  // épica tiene hijas (carrera con un agente que las creó después de abrir el
  // modal) — habilita el botón que lleva directo al filtro de esa épica.
  const [deleteBlockedEpicKey, setDeleteBlockedEpicKey] = useState<string | null>(null);

  function resetDeleteState() {
    setPendingDelete(null);
    setDeleteError(null);
    setDeleteCard(true);
    setDeleteBlockedEpicKey(null);
  }

  // Guarda preventiva (AC6): conteo de hijas de la épica a borrar, para
  // deshabilitar el botón de confirmar antes de siquiera intentar el request.
  const pendingDeleteChildCount = pendingDelete?.isEpic ? childCountFor(pendingDelete) : 0;

  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setActionError(null);
    try {
      await api.stories.create(ws, proj, {
        title: title.trim(),
        priority,
        isEpic,
        narrative:
          role || want || benefit ? { role, want, benefit } : undefined,
      });
      track("story_created", { is_epic: isEpic });
      setTitle("");
      setRole("");
      setWant("");
      setBenefit("");
      setPriority("medium");
      setIsEpic(false);
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

  /** Asigna/reasigna/desvincula (`epicId: null`) la épica de una HU directo
   *  desde la fila — mismo mecanismo que ya usaba el buscador de la épica,
   *  ahora también disponible desde el lado de la HU. */
  async function setEpic(id: string, epicId: string | null) {
    const key = queryKeys.stories(ws, proj);
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<UserStory[]>(key);
    queryClient.setQueryData<UserStory[]>(key, (prev) =>
      (prev ?? []).map((s) => (s.id === id ? { ...s, epicId } : s))
    );
    try {
      await api.stories.update(ws, proj, id, { epicId });
    } catch {
      queryClient.setQueryData(key, previous);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlockedEpicKey(null);
    try {
      await api.stories.remove(ws, proj, pendingDelete.id, !deleteCard);
      track("story_deleted", { card_deleted: deleteCard, is_epic: pendingDelete.isEpic });
      resetDeleteState();
      invalidateAfterStoryChange();
    } catch (e) {
      track("story_delete_failed", { reason: analyticsFailureReason(e) });
      // Reactiva (AC6): la guarda preventiva ya cubre el caso normal, pero un
      // agente puede haber vinculado una HU a esta épica entre que se abrió el
      // modal y se confirmó el borrado. En vez del texto crudo, se ofrece un
      // atajo directo al filtro de esa épica.
      if (e instanceof ApiError && e.code === "epic_has_children") {
        setDeleteError(e.message);
        setDeleteBlockedEpicKey(pendingDelete.key);
      } else {
        setDeleteError(e instanceof ApiError ? e.message : t("storyDeleteError"));
      }
    } finally {
      setDeleting(false);
    }
  }

  function renderRow(s: UserStory, opts: { indent?: boolean; expanded?: boolean; onToggle?: () => void } = {}) {
    const count = s.isEpic ? childCountFor(s) : 0;
    return (
      <ListRow
        key={s.id}
        indent={opts.indent}
        actions={
          <>
            <Badge tone={STATUS_TONE[s.status] ?? "neutral"} dot>
              {s.status}
            </Badge>
            <Select value={s.status} onChange={(e) => setStatus(s.id, e.target.value)} aria-label={t("status")}>
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
            {/* Asignar/reasignar/desvincular ("Sin épica") directo desde la fila,
                sin abrir el detalle — mismo control que ya existía para status. */}
            {!s.isEpic && (
              <Select
                value={s.epicId ?? ""}
                onChange={(e) => setEpic(s.id, e.target.value || null)}
                aria-label={t("epic")}
              >
                <option value="">{t("noEpic")}</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.key} · {ep.title}
                  </option>
                ))}
              </Select>
            )}
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
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Opción A: la key de una épica usa el chip morado, el resto de la fila no cambia. */}
          <Badge tone={s.isEpic ? "epic" : "brand"} mono>
            {s.key}
          </Badge>
          <span className="text-body font-medium text-ink-900">{s.title}</span>
          {s.isEpic && count > 0 && (
            <button
              type="button"
              onClick={opts.onToggle}
              aria-expanded={opts.expanded}
              className="rounded-pill focus-visible:outline-none focus-visible:shadow-focus"
              aria-label={t("toggleChildStories", { count })}
            >
              <Badge tone="epic">
                <span
                  aria-hidden
                  className={`mr-0.5 inline-block transition-transform duration-150 ${opts.expanded ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
                {t("epicBadge", { count, suffix: count === 1 ? "" : "s" })}
              </Badge>
            </button>
          )}
        </div>
        {formatNarrative(s.narrative) && (
          <p className="mt-1 text-body-sm text-ink-500">{formatNarrative(s.narrative)}</p>
        )}
        <div className="mt-1.5">
          <Badge tone={PRIORITY_TONE[s.priority] ?? "neutral"} mono>
            {s.priority}
          </Badge>
        </div>
      </ListRow>
    );
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

          <div>
            <Switch checked={isEpic} onChange={setIsEpic} label={t("isEpicToggle")} />
            {isEpic && <p className="mt-1.5 text-caption text-ink-400">{t("epicHint")}</p>}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-h4 text-ink-900">{t("stories", { count: stories.length })}</h3>
          {epics.length > 0 && (
            <div className="w-56">
              <Select
                value={epicParam ?? ""}
                onChange={(e) => setEpicFilter(e.target.value)}
                aria-label={t("filterByEpic")}
              >
                <option value="">{t("allEpics")}</option>
                <option value={NO_EPIC_FILTER}>{t("noEpic")}</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.key}>
                    {ep.key} · {ep.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="mt-4">
          {stories.length === 0 ? (
            <EmptyState
              title={t("noStories")}
              description={t("noStoriesDescription")}
            />
          ) : !hasVisibleContent ? (
            <EmptyState title={t("noStories")} description={t("noStoriesDescription")} />
          ) : (
            <div className="divide-y divide-line-100">
              {visibleEpics.map((epic) => {
                // Filtrar a una épica puntual ya es pedir ver sus hijas: no
                // tiene sentido que además queden plegadas detrás de un click.
                const expanded = expandedEpicIds.has(epic.id) || selectedEpic?.id === epic.id;
                return (
                  <Fragment key={epic.id}>
                    {renderRow(epic, { expanded, onToggle: () => toggleEpic(epic.id) })}
                    {expanded &&
                      (childrenByEpicId.get(epic.id) ?? []).map((child) => renderRow(child, { indent: true }))}
                  </Fragment>
                );
              })}
              {visibleOrphans.map((s) => renderRow(s))}
            </div>
          )}
        </div>
      </Card>

      {editingStory && (
        <StoryDetailModal
          story={editingStory}
          ws={ws}
          proj={proj}
          epics={epics}
          childStories={editingStory.isEpic ? (childrenByEpicId.get(editingStory.id) ?? []) : []}
          unlinkedStories={editingStory.isEpic ? orphanStories : []}
          onOpenStory={openStory}
          onClose={closeStory}
          canManage={canManage}
          onSaved={(updated, notification) => {
            if (notification && notification.reason !== "self_assignment" && notification.reason !== "unassigned")
              setAssignmentNotice({ story: updated, notification });
            closeStory();
            invalidateAfterStoryChange();
          }}
          onLinkStory={async (childId) => {
            await api.stories.update(ws, proj, childId, { epicId: editingStory.id });
            invalidateAfterStoryChange();
          }}
        />
      )}

      {pendingDelete && (
        <Modal
          title={t("deleteStoryTitle")}
          onClose={() => {
            if (!deleting) resetDeleteState();
          }}
        >
          <div className="space-y-4">
            <ErrorText>{deleteError}</ErrorText>
            {deleteBlockedEpicKey && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const key = deleteBlockedEpicKey;
                    resetDeleteState();
                    setEpicFilter(key);
                  }}
                >
                  {t("filterByEpic")}
                </Button>
              </div>
            )}
            <p className="text-body text-ink-700">
              {t("deleteStoryQuestion", { key: pendingDelete.key, title: pendingDelete.title })}
            </p>
            {pendingDeleteChildCount > 0 && (
              <Notice tone="warning">
                {t("epicHasChildrenWarning", { count: pendingDeleteChildCount })}
              </Notice>
            )}
            {!pendingDelete.isEpic && (
              <>
                <Checkbox checked={deleteCard} onChange={setDeleteCard}>
                  {t("deleteCardToo")}
                </Checkbox>
                <p className="text-body-sm text-ink-500">
                  {deleteCard
                    ? t("cardDeletedWithStory") : t("cardKeptWithoutStory")}
                </p>
              </>
            )}
            <div className="flex justify-end gap-2 border-t border-line-100 pt-4">
              <Button
                variant="secondary"
                disabled={deleting}
                onClick={() => resetDeleteState()}
              >
                {t("cancel")}
              </Button>
              <Button variant="danger" disabled={deleting || pendingDeleteChildCount > 0} onClick={confirmDelete}>
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
