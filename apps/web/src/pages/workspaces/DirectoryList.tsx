import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceSummary } from "../../lib/api.js";
import { Button, Card, EmptyState, ErrorText, Eyebrow, Field, Input } from "../../components/ui.js";
import { greetingFor } from "./greeting.js";
import { readRecents } from "./recents.js";
import { WorkspaceCompactRow, WorkspaceRow } from "./WorkspaceRow.js";
import { useWorkspaceKeys } from "./useWorkspaceKeys.js";

// eslint-disable-next-line no-misleading-character-class -- rango explícito de marcas diacríticas combinantes (NFD)
const DIACRITICS = /[̀-ͯ]/g;

function normalize(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

const MAX_RECENT_ROWS = 3;

/** Variante 2a: muchos workspaces — filtro, recientes y grid compacto. */
export function DirectoryList({
  workspaces,
  userName,
  creating,
  onToggleCreate,
  name,
  onNameChange,
  onCreate,
  busy,
  error,
}: {
  workspaces: WorkspaceSummary[];
  userName?: string | null;
  creating: boolean;
  onToggleCreate: (next: boolean) => void;
  name: string;
  onNameChange: (v: string) => void;
  onCreate: (e: React.FormEvent) => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useTranslation("workspaces");
  const [filter, setFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const filtered = useMemo(() => {
    const q = normalize(filter.trim());
    if (!q) return workspaces;
    return workspaces.filter((ws) => normalize(ws.name).includes(q) || normalize(ws.slug).includes(q));
  }, [workspaces, filter]);

  const recents = useMemo(() => {
    if (filter.trim()) return [];
    const bySlug = new Map(workspaces.map((ws) => [ws.slug, ws]));
    return readRecents()
      .map((slug) => bySlug.get(slug))
      .filter((ws): ws is WorkspaceSummary => Boolean(ws))
      .slice(0, MAX_RECENT_ROWS);
  }, [workspaces, filter]);

  useWorkspaceKeys(filtered, rowRefs, { filterInputRef, onCreate: () => onToggleCreate(true) });

  return (
    <div className="mx-auto flex max-w-narrow flex-col">
      <div className="mb-7 flex flex-col items-center gap-2 text-center">
        <h1 className="text-h2 text-ink-900">{t(greetingFor(new Date()))}{userName ? `, ${userName}` : ""}</h1>
        <p className="text-body text-ink-600">{t("launchpadSubtitle")}</p>
      </div>

      <div className="mb-8 flex gap-2.5">
        <Input
          ref={filterInputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("filterPlaceholder")}
          className="flex-1"
        />
        <Button onClick={() => onToggleCreate(!creating)} className="whitespace-nowrap">
          {t("newWorkspace")}
        </Button>
      </div>

      <Eyebrow className="mb-3 block">{t("yourWorkspaces")}</Eyebrow>

      {creating && (
        <Card className="mb-8">
          <form onSubmit={onCreate} className="flex items-end gap-3">
            <div className="flex-1">
              <Field label={t("workspaceName")}>
                <Input value={name} onChange={(e) => onNameChange(e.target.value)} required autoFocus />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? t("creating") : t("create")}
            </Button>
          </form>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </Card>
      )}

      {recents.length > 0 && (
        <div className="mb-8 flex flex-col gap-3">
          <Eyebrow>{t("recent")}</Eyebrow>
          <div className="flex flex-col gap-3">
            {recents.map((ws) => (
              <WorkspaceRow key={ws.id} ws={ws} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Eyebrow>{t("all", { count: filtered.length })}</Eyebrow>
        {filtered.length === 0 ? (
          <EmptyState compact title={t("noMatch")} />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {filtered.map((ws, i) => (
              <WorkspaceCompactRow key={ws.id} ws={ws} ref={(el) => (rowRefs.current[i] = el)} />
            ))}
          </div>
        )}
      </div>

      <span className="mt-6 text-center font-mono text-caption text-ink-300">
        {t("directoryKeyboardHint")}
      </span>
    </div>
  );
}
