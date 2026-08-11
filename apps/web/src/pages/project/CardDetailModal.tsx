import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNarrative } from "@pemie/shared";
import {
  api,
  analyticsFailureReason,
  ApiError,
  type AssignmentNotification,
  type Card as CardData,
  type CardActivity,
  type Column,
} from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "../../components/ui.js";
import { AssigneeNotice, AssigneeSelect } from "./AssigneeField.js";

function activityLabel(a: CardActivity): string {
  switch (a.action) {
    case "created":
      return `Creada en ${a.toValue ?? "columna"}`;
    case "moved":
      return `Movida de ${a.fromValue ?? "?"} a ${a.toValue ?? "?"}`;
    case "assigned":
      return a.toValue ? `Asignada` : `Sin asignar`;
    case "linked_story":
      return `HU vinculada`;
    case "unlinked_story":
      return `HU desvinculada`;
    case "updated":
      return `Actualizada: ${a.fromValue ?? "?"} → ${a.toValue ?? "?"}`;
    default:
      return a.action;
  }
}

/** Skeleton con la forma de los selects assignee/HU + timeline de actividad. */
function CardDetailMetaSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Skeleton className="mb-1.5 h-4 w-16" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div>
          <Skeleton className="mb-1.5 h-4 w-28" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
      <div className="border-t border-line-100 pt-4">
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CardDetailModal({
  card,
  columns,
  ws,
  proj,
  onClose,
  onChanged,
  onDeleted,
  canManage,
}: {
  card: CardData;
  columns: Column[];
  ws: string;
  proj: string;
  onClose: () => void;
  onChanged: (card: CardData, notification?: AssignmentNotification) => void;
  onDeleted: (cardId: string) => void;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(card.title);
  const [type, setType] = useState(card.type);
  // Sin description propia, arranca con la narrativa de la HU vinculada como
  // punto de partida editable: si la persona la deja tal cual o la retoca y
  // guarda, queda fijada como description de la tarjeta (deja de seguir a la HU).
  const [description, setDescription] = useState(
    card.description ?? formatNarrative(card.userStory?.narrative) ?? ""
  );
  const [assigneeId, setAssigneeId] = useState(card.assigneeId ?? "");
  const [userStoryId, setUserStoryId] = useState(card.userStoryId ?? "");
  const [columnId, setColumnId] = useState(card.columnId);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Confirmación inline en vez de un segundo Modal encima: el mismo gesto que
  // ya usan las filas de Equipo para borrar.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Candidatos asignables y stories comparten caché con StoriesTab: si esa
  // pestaña ya se visitó, el modal abre sin esperar un round-trip.
  const assigneesQuery = useQuery({
    queryKey: queryKeys.assignees(ws, proj),
    queryFn: () => api.assignees.list(ws, proj).then((r) => r.assignees),
    staleTime: STALE_TIME.live,
  });
  const storiesQuery = useQuery({
    queryKey: queryKeys.stories(ws, proj),
    queryFn: () => api.stories.list(ws, proj).then((r) => r.userStories),
    staleTime: STALE_TIME.live,
  });
  const activitiesQueryKey = queryKeys.cardActivities(ws, proj, card.id);
  const activitiesQuery = useQuery({
    queryKey: activitiesQueryKey,
    queryFn: () => api.board.activities(ws, proj, card.id).then((r) => r.activities),
    staleTime: STALE_TIME.live,
  });
  const assigneeCandidates = assigneesQuery.data ?? [];
  const stories = storiesQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];
  const metaLoading = assigneesQuery.isLoading || storiesQuery.isLoading || activitiesQuery.isLoading;
  const loadError = assigneesQuery.error ?? storiesQuery.error ?? activitiesQuery.error;
  const error =
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : "No se pudieron cargar los datos") : null);

  // Stories disponibles: sin tarjeta, o la vinculada a esta card.
  const storyOptions = useMemo(() => {
    const linkedIds = new Set(
      columns.flatMap((col) => col.cards.map((c) => c.userStoryId).filter(Boolean) as string[])
    );
    return stories.filter((s) => s.id === card.userStoryId || !linkedIds.has(s.id));
  }, [stories, columns, card.userStoryId]);

  async function save() {
    if (title.trim().length < 1) {
      setActionError("El título no puede estar vacío");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const { card: updated } = await api.board.updateCard(ws, proj, card.id, {
        title: title.trim(),
        type,
        description: description.trim() || null,
        assigneeId: assigneeId || null,
        userStoryId: userStoryId || null,
      });
      // Si la columna cambió, mover aparte.
      let finalCard = { ...updated, columnId };
      if (columnId !== card.columnId) {
        await api.board.moveCard(ws, proj, card.id, columnId);
        finalCard = { ...finalCard, columnId };
      }
      queryClient.invalidateQueries({ queryKey: activitiesQueryKey });
      onChanged(finalCard, updated.assignmentNotification);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo guardar la tarjeta");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setActionError(null);
    try {
      await api.board.removeCard(ws, proj, card.id);
      track("board_card_deleted", { had_story: card.userStoryId !== null });
      onDeleted(card.id);
    } catch (e) {
      track("board_card_deleted_failed", { reason: analyticsFailureReason(e) });
      setActionError(e instanceof ApiError ? e.message : "No se pudo eliminar la tarjeta");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <Modal title="Detalle de tarjeta" onClose={onClose} wide>
      <ErrorText>{error}</ErrorText>

      <div className="min-w-0 space-y-4">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" />
        </Field>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
              <option value="task">task</option>
              <option value="story">story</option>
              <option value="bug">bug</option>
            </Select>
          </Field>
          <Field label="Columna">
            <Select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              aria-label="Columna"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Descripción">
          <Textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles de la tarjeta…"
            aria-label="Descripción"
          />
        </Field>

        {metaLoading ? (
          <CardDetailMetaSkeleton />
        ) : (
          <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <AssigneeSelect value={assigneeId} onChange={setAssigneeId} candidates={assigneeCandidates} />
              <Field label="Historia de usuario">
                <Select
                  value={userStoryId}
                  onChange={(e) => setUserStoryId(e.target.value)}
                  aria-label="Historia de usuario"
                >
                  <option value="">Sin HU</option>
                  {storyOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.key} — {s.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {assigneeId && assigneesQuery.data ? (
              <AssigneeNotice
                candidate={assigneeCandidates.find((c) => c.id === assigneeId)}
                canManage={canManage}
              />
            ) : null}

            <div className="min-w-0 border-t border-line-100 pt-4">
              <h4 className="mb-2 text-body-sm font-semibold text-ink-800">Actividad</h4>
              {activities.length === 0 ? (
                <p className="text-body-sm text-ink-400">Sin actividad todavía.</p>
              ) : (
                <ul className="space-y-2">
                  {activities.map((a) => (
                    <li key={a.id} className="flex min-w-0 items-start justify-between gap-3 text-body-sm">
                      <span className="min-w-0 break-words text-ink-700">
                        <span className="mr-2 inline-block">
                          <Badge tone="neutral" mono>
                            {a.actorType}
                          </Badge>
                        </span>
                        <span className="mr-2 text-body-sm text-ink-700">{a.actorName}</span>
                        {activityLabel(a)}
                      </span>
                      <time className="shrink-0 font-mono text-caption text-ink-400">
                        {new Date(a.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {confirmingDelete ? (
          <div className="space-y-3 border-t border-line-100 pt-4">
            <p className="text-body-sm text-ink-700">
              ¿Eliminar <span className="font-medium text-ink-900">{card.title}</span> del
              tablero? Se pierde también su actividad y no se puede deshacer.
            </p>
            <p className="text-body-sm text-ink-500">
              {card.userStoryId
                ? "Su Historia de Usuario NO se elimina: sigue en el listado, sin tarjeta."
                : "Esta tarjeta no tiene ninguna Historia de Usuario vinculada."}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button variant="danger" onClick={remove} disabled={deleting}>
                {deleting ? "Eliminando…" : "Eliminar tarjeta"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-100 pt-4">
            <Button
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
              aria-label={`Eliminar tarjeta ${card.title}`}
            >
              Eliminar
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={saving || metaLoading}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
