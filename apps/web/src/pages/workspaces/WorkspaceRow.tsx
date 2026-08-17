import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { WorkspaceSummary } from "../../lib/api.js";
import { Avatar, Badge, Card, Kbd } from "../../components/ui.js";
import i18n from "../../i18n/index.js";

/** "10 proyectos · desde ago 2025" — solo con los campos que ya devuelve `listWorkspaces`. */
function metaFor(ws: WorkspaceSummary, projectCount: string, sinceLabel: string): string {
  const since = new Intl.DateTimeFormat(i18n.language, { month: "short", year: "numeric" })
    .format(new Date(ws.createdAt))
    .replace(".", "");
  return `${projectCount} · ${sinceLabel} ${since}`;
}

/** Fila grande: avatar + nombre + rol + meta, con atajo de teclado a la derecha. */
export const WorkspaceRow = forwardRef<HTMLAnchorElement, { ws: WorkspaceSummary; shortcut?: number }>(
  function WorkspaceRow({ ws, shortcut }, ref) {
    const { t } = useTranslation("workspaces");
    return (
      <Link ref={ref} to={`/w/${ws.slug}`} className="block focus:outline-none focus-visible:shadow-focus rounded-lg">
        <Card interactive className="flex items-center gap-4 hover:border-blue-600">
          <Avatar label={ws.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-h4 text-ink-900">{ws.name}</span>
              <Badge tone="neutral" mono>{ws.role}</Badge>
            </div>
            <p className="mt-0.5 font-mono text-body-sm text-ink-400">{metaFor(ws, t("projectCount", { count: ws.projectCount }), t("since"))}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3.5">
            {shortcut ? <Kbd>⌘{shortcut}</Kbd> : null}
            <span className="text-body font-semibold text-blue-600">→</span>
          </div>
        </Card>
      </Link>
    );
  }
);

/** Fila compacta para el grid del directorio (2a). */
export const WorkspaceCompactRow = forwardRef<HTMLAnchorElement, { ws: WorkspaceSummary }>(
  function WorkspaceCompactRow({ ws }, ref) {
    const { t } = useTranslation("workspaces");
    return (
      <Link ref={ref} to={`/w/${ws.slug}`} className="block focus:outline-none focus-visible:shadow-focus rounded-md">
        <Card interactive padding="sm" className="flex items-center gap-3 hover:border-blue-600">
          <Avatar label={ws.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold text-ink-900">{ws.name}</p>
            <p className="truncate font-mono text-caption text-ink-400">{metaFor(ws, t("projectCount", { count: ws.projectCount }), t("since"))}</p>
          </div>
          <span className="flex-shrink-0 font-mono text-mono-label uppercase tracking-wide text-ink-400">
            {ws.role}
          </span>
        </Card>
      </Link>
    );
  }
);
