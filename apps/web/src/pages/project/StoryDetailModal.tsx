import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api, analyticsFailureReason, ApiError, type AssignmentNotification, type Epic, type UserStory } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  TrashIcon,
} from "../../components/ui.js";
import { AssigneeNotice, AssigneeSelect } from "./AssigneeField.js";

const STATUSES = ["backlog", "ready", "in_progress", "review", "done"];
const PRIORITIES = ["low", "medium", "high", "critical"];

interface CriterionRow {
  given: string;
  when: string;
  then: string;
}

// Blindado contra HUs con acceptanceCriteria guardado como string serializado
// (bug de escritura ya corregido en el server, pero pueden quedar filas viejas
// así): sin esto, `.map` sobre un string tira y deja el modal en blanco.
function criteriaFromStory(story: UserStory): CriterionRow[] {
  const raw = story.acceptanceCriteria as unknown;
  const list = typeof raw === "string" ? tryParseJson(raw) : raw;
  return Array.isArray(list) ? list.map((c) => ({ ...c })) : [];
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function StoryDetailModal({
  story,
  ws,
  proj,
  epics,
  onClose,
  onSaved,
  canManage,
}: {
  story: UserStory;
  ws: string;
  proj: string;
  epics: Epic[];
  onClose: () => void;
  onSaved: (story: UserStory, notification?: AssignmentNotification) => void;
  canManage: boolean;
}) {
  const { t } = useTranslation("project");
  const [title, setTitle] = useState(story.title);
  const [status, setStatus] = useState(story.status);
  const [priority, setPriority] = useState(story.priority);
  const [role, setRole] = useState(story.narrative?.role ?? "");
  const [want, setWant] = useState(story.narrative?.want ?? "");
  const [benefit, setBenefit] = useState(story.narrative?.benefit ?? "");
  const [criteria, setCriteria] = useState<CriterionRow[]>(criteriaFromStory(story));
  const [epicId, setEpicId] = useState(story.epicId ?? "");
  const [assigneeId, setAssigneeId] = useState(story.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Candidatos asignables no viajan con la lista de HUs (StoriesTab no los
  // necesita para otra cosa): se piden acá, con el mismo caché que usa CardDetailModal.
  const assigneesQuery = useQuery({
    queryKey: queryKeys.assignees(ws, proj),
    queryFn: () => api.assignees.list(ws, proj).then((r) => r.assignees),
    staleTime: STALE_TIME.live,
  });
  const assigneeCandidates = assigneesQuery.data ?? [];

  function updateCriterion(index: number, patch: Partial<CriterionRow>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeCriterion(index: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  }

  function addCriterion() {
    setCriteria((prev) => [...prev, { given: "", when: "", then: "" }]);
  }

  async function save() {
    if (title.trim().length < 2) {
      setActionError(t("shortTitle"));
      return;
    }
    setSaving(true);
    setActionError(null);
    // Solo criterios con los tres campos completos; una fila a medias no es un
    // Given-When-Then válido.
    const cleanCriteria = criteria
      .map((c) => ({ given: c.given.trim(), when: c.when.trim(), then: c.then.trim() }))
      .filter((c) => c.given && c.when && c.then);
    const nextNarrative = role || want || benefit ? { role, want, benefit } : null;

    // Patch parcial: el backend solo toca los campos presentes, y una HU puede
    // seguir cambiando por MCP mientras el modal está abierto (status, prioridad,
    // narrativa, etc.). Mandar un snapshot completo pisaría esos cambios
    // concurrentes con lo que había al abrir el modal.
    const patch: Parameters<typeof api.stories.update>[3] = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle !== story.title) patch.title = trimmedTitle;
    if (status !== story.status) patch.status = status;
    if (priority !== story.priority) patch.priority = priority;
    // `null` explícito borra la narrativa; `undefined` significa "no tocar".
    // Comparación campo a campo, no JSON.stringify: postgres/jsonb no garantiza
    // el orden de claves, así que un objeto con los mismos valores podría
    // serializar distinto y disparar un falso "cambió".
    const narrativeChanged =
      (story.narrative?.role ?? "") !== (nextNarrative?.role ?? "") ||
      (story.narrative?.want ?? "") !== (nextNarrative?.want ?? "") ||
      (story.narrative?.benefit ?? "") !== (nextNarrative?.benefit ?? "");
    if (narrativeChanged) patch.narrative = nextNarrative;

    const originalCriteria = story.acceptanceCriteria ?? [];
    const criteriaChanged =
      cleanCriteria.length !== originalCriteria.length ||
      cleanCriteria.some(
        (c, i) =>
          c.given !== originalCriteria[i]?.given ||
          c.when !== originalCriteria[i]?.when ||
          c.then !== originalCriteria[i]?.then
      );
    if (criteriaChanged) patch.acceptanceCriteria = cleanCriteria;
    const nextEpicId = epicId || null;
    if (nextEpicId !== (story.epicId ?? null)) patch.epicId = nextEpicId;
    const nextAssigneeId = assigneeId || null;
    if (nextAssigneeId !== (story.assigneeId ?? null)) patch.assigneeId = nextAssigneeId;

    if (Object.keys(patch).length === 0) {
      onSaved(story);
      setSaving(false);
      return;
    }

    try {
      const { userStory: updated } = await api.stories.update(ws, proj, story.id, patch);
      track("story_updated");
      onSaved(updated, updated.assignmentNotification);
    } catch (e) {
      track("story_update_failed", { reason: analyticsFailureReason(e) });
      setActionError(e instanceof ApiError ? e.message : t("saveStoryError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("storyDetailTitle", { key: story.key })} onClose={onClose} dismissible={!saving} wide>
      <div className="min-w-0 space-y-4">
        <ErrorText>{actionError}</ErrorText>

        <Field label={t("title")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("title")} />
        </Field>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label={t("status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("status")}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("priority")}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={t("priority")}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <Field label={`Como… (${t("role")})`}>
            <Input value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol" />
          </Field>
          <Field label={`${t("want")}…`}>
            <Input value={want} onChange={(e) => setWant(e.target.value)} aria-label="Quiero" />
          </Field>
          <Field label={`${t("benefit")}…`}>
            <Input value={benefit} onChange={(e) => setBenefit(e.target.value)} aria-label="Beneficio" />
          </Field>
        </div>

        {assigneesQuery.isLoading ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div>
              <Skeleton className="mb-1.5 h-4 w-16" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <div>
              <Skeleton className="mb-1.5 h-4 w-16" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </div>
        ) : (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field label={t("epics")}>
              <Select value={epicId} onChange={(e) => setEpicId(e.target.value)} aria-label={t("epics")}>
                <option value="">{t("noEpic")}</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.title}
                  </option>
                ))}
              </Select>
            </Field>
            <AssigneeSelect value={assigneeId} onChange={setAssigneeId} candidates={assigneeCandidates} />
          </div>
        )}

        {assigneeId && assigneesQuery.data ? (
          <AssigneeNotice
            candidate={assigneeCandidates.find((c) => c.id === assigneeId)}
            canManage={canManage}
          />
        ) : null}

        <div className="min-w-0 border-t border-line-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-body-sm font-semibold text-ink-800">{t("acceptanceCriteria")}</h4>
            <Button type="button" variant="secondary" size="sm" onClick={addCriterion}>
              {t("addCriterion")}
            </Button>
          </div>
          {criteria.length === 0 ? (
            <p className="text-body-sm text-ink-400">{t("noCriteria")}</p>
          ) : (
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="flex min-w-0 items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                    <Input
                      placeholder="Given…"
                      value={c.given}
                      onChange={(e) => updateCriterion(i, { given: e.target.value })}
                      aria-label={t("criterionAria", { kind: "Given", number: i + 1 })}
                    />
                    <Input
                      placeholder="When…"
                      value={c.when}
                      onChange={(e) => updateCriterion(i, { when: e.target.value })}
                      aria-label={t("criterionAria", { kind: "When", number: i + 1 })}
                    />
                    <Input
                      placeholder="Then…"
                      value={c.then}
                      onChange={(e) => updateCriterion(i, { then: e.target.value })}
                      aria-label={t("criterionAria", { kind: "Then", number: i + 1 })}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-red-100 hover:text-red-600"
                    aria-label={t("removeCriterion", { number: i + 1 })}
                    onClick={() => removeCriterion(i)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
