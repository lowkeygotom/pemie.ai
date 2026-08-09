import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNarrative } from "@pemie/shared";
import { api, analyticsFailureReason, ApiError, type UserStory } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  ErrorText,
  Input,
  Modal,
  PencilIcon,
  Select,
  TrashIcon,
} from "../../components/ui.js";
import StoryDetailModal from "./StoryDetailModal.js";

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

export default function StoriesTab({ ws, proj }: { ws: string; proj: string }) {
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
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : "Error cargando historias") : null);

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
      setActionError(e instanceof ApiError ? e.message : "No se pudo crear la HU");
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
      setDeleteError(e instanceof ApiError ? e.message : "No se pudo eliminar la HU");
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
        <h3 className="text-h4 text-ink-900">Nueva historia de usuario</h3>
        <form onSubmit={createStory} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Título (ej: Login con GitHub)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Título de historia"
            />
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Prioridad"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Button type="submit">Crear</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Como… (rol)"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Rol"
            />
            <Input
              placeholder="quiero… (want)"
              value={want}
              onChange={(e) => setWant(e.target.value)}
              aria-label="Quiero"
            />
            <Input
              placeholder="para… (beneficio)"
              value={benefit}
              onChange={(e) => setBenefit(e.target.value)}
              aria-label="Beneficio"
            />
          </div>
        </form>
      </Card>

      {/* Lista */}
      <Card>
        <h3 className="text-h4 text-ink-900">Historias ({stories.length})</h3>
        <div className="mt-4">
          {stories.length === 0 ? (
            <EmptyState
              title="Aún no hay historias"
              description="Crea la primera historia de usuario para comenzar a organizar el trabajo."
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
                      aria-label={`Editar ${s.key} — ${s.title}`}
                      onClick={() => openStory(s)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-red-100 hover:text-red-600"
                      aria-label={`Eliminar ${s.key} — ${s.title}`}
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
          <h3 className="text-h4 text-ink-900">Épicas</h3>
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
          onSaved={() => {
            closeStory();
            invalidateAfterStoryChange();
          }}
        />
      )}

      {pendingDelete && (
        <Modal
          title="Eliminar historia de usuario"
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
              ¿Eliminar{" "}
              <Badge tone="brand" mono>
                {pendingDelete.key}
              </Badge>{" "}
              — <span className="font-medium text-ink-900">{pendingDelete.title}</span>? Esta
              acción no se puede deshacer.
            </p>
            <Checkbox checked={deleteCard} onChange={setDeleteCard}>
              Eliminar también su tarjeta del Kanban
            </Checkbox>
            <p className="text-body-sm text-ink-500">
              {deleteCard
                ? "La tarjeta y su actividad se eliminan con la historia."
                : "La tarjeta se conserva en el tablero, pero queda sin HU vinculada."}
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
                Cancelar
              </Button>
              <Button variant="danger" disabled={deleting} onClick={confirmDelete}>
                {deleting ? "Eliminando…" : "Eliminar"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
