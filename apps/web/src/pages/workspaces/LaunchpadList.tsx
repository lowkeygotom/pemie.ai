import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceSummary } from "../../lib/api.js";
import { Button, ErrorText, Eyebrow, Field, Input, Kbd } from "../../components/ui.js";
import { greetingFor, stampFor } from "./greeting.js";
import { WorkspaceRow } from "./WorkspaceRow.js";
import { useWorkspaceKeys } from "./useWorkspaceKeys.js";

/** Variante 1b: pocos workspaces — saludo, columna centrada, filas grandes con atajo ⌘N. */
export function LaunchpadList({
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
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const now = new Date();

  useWorkspaceKeys(workspaces, rowRefs, { onCreate: () => onToggleCreate(true) });

  return (
    <div className="relative mx-auto flex max-w-focus flex-col">
      <div className="launchpad-glow" />
      <div className="relative mb-11 flex flex-col items-center gap-2.5 text-center">
        <Eyebrow>{stampFor(now)}</Eyebrow>
        <h1 className="text-h1 text-ink-900">{t(greetingFor(now))}{userName ? `, ${userName}` : ""}</h1>
        <p className="text-body-lg text-ink-600">{t("launchpadSubtitle")}</p>
      </div>

      <div className="relative flex flex-col gap-3.5">
        <Eyebrow className="mb-1 block">{t("yourWorkspaces")}</Eyebrow>
        {workspaces.map((ws, i) => (
          <WorkspaceRow
            key={ws.id}
            ws={ws}
            shortcut={i < 9 ? i + 1 : undefined}
            ref={(el) => (rowRefs.current[i] = el)}
          />
        ))}

        {creating ? (
          <div className="rounded-lg border border-line-200 bg-surface-0 p-6">
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
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onToggleCreate(true)}
            className="flex items-center gap-4.5 rounded-lg border border-dashed border-ink-300 px-6 py-4.5 text-left transition-colors duration-150 hover:border-blue-600 hover:bg-blue-100/40"
          >
            <span className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-300 text-h3 text-ink-400">
              +
            </span>
            <span className="flex-1 text-body font-semibold text-ink-700">{t("newWorkspace")}</span>
            <Kbd>⌘N</Kbd>
          </button>
        )}
      </div>

      <span className="relative mt-7 text-center font-mono text-caption text-ink-300">
        {t("keyboardNavigate")}
      </span>
    </div>
  );
}
