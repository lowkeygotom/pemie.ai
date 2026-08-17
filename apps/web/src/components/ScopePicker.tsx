import { useEffect, useState } from "react";
import { API_SCOPES, type ApiScope } from "@pemie/shared";
import { Button, ToggleChip } from "./ui.js";
import { useTranslation } from "react-i18next";

type ScopePreset = "read" | "write" | "custom";

const GROUPS: { label: string; read?: ApiScope; write?: ApiScope }[] = [
  { label: "Commits", read: "commits:read" },
  { label: "Objetivo", read: "objective:read", write: "objective:write" },
  { label: "Informes", read: "reports:read", write: "reports:write" },
  { label: "Notas", read: "notes:read", write: "notes:write" },
  { label: "Historias", read: "stories:read", write: "stories:write" },
  { label: "Kanban", read: "board:read", write: "board:write" },
  { label: "Skills", read: "skills:read", write: "skills:write" },
];

const READ_SCOPES = API_SCOPES.filter((scope) => scope.endsWith(":read"));
const READ_FOR_WRITE: Partial<Record<ApiScope, ApiScope>> = {
  "reports:write": "reports:read",
  "notes:write": "notes:read",
  "stories:write": "stories:read",
  "board:write": "board:read",
  "objective:write": "objective:read",
  "skills:write": "skills:read",
};

function presetFor(scopes: readonly ApiScope[]): ScopePreset {
  if (scopes.length === API_SCOPES.length && API_SCOPES.every((scope) => scopes.includes(scope))) return "write";
  if (scopes.length === READ_SCOPES.length && READ_SCOPES.every((scope) => scopes.includes(scope))) return "read";
  return "custom";
}

export function ScopePicker({ value, onChange }: { value: ApiScope[]; onChange: (scopes: ApiScope[]) => void }) {
  const { t } = useTranslation("configuration");
  const [preset, setPreset] = useState<ScopePreset>(() => presetFor(value));

  useEffect(() => setPreset(presetFor(value)), [value]);

  function selectPreset(next: ScopePreset) {
    setPreset(next);
    if (next === "read") onChange([...READ_SCOPES]);
    if (next === "write") onChange([...API_SCOPES]);
  }

  function toggle(scope: ApiScope) {
    setPreset("custom");
    if (value.includes(scope)) {
      const writesDependingOnScope = Object.entries(READ_FOR_WRITE)
        .filter(([, read]) => read === scope)
        .map(([write]) => write as ApiScope);
      onChange(value.filter((item) => item !== scope && !writesDependingOnScope.includes(item)));
      return;
    }
    const readScope = READ_FOR_WRITE[scope];
    onChange([...new Set([...value, scope, ...(readScope ? [readScope] : [])])]);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("scopePreset")}>
        <PresetButton active={preset === "read"} onClick={() => selectPreset("read")} label={t("readOnly")} description={t("readOnlyDescription")} />
        <PresetButton active={preset === "write"} onClick={() => selectPreset("write")} label={t("readWrite")} description={t("readWriteDescription")} recommended />
        <PresetButton active={preset === "custom"} onClick={() => selectPreset("custom")} label={t("custom")} description={t("customDescription")} />
      </div>
      {preset === "custom" ? (
        <div className="overflow-x-auto rounded-md border border-line-200">
          {/* min-w evita que los chips de scope se solapen en pantallas angostas: la tabla prefiere scroll horizontal */}
          <div className="min-w-[24.5rem]">
            <div className="grid grid-cols-[minmax(5.5rem,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-line-100 bg-surface-50 px-3 py-2 text-caption font-mono uppercase text-ink-500">
              <span>{t("domain")}</span><span>{t("read")}</span><span>{t("write")}</span>
            </div>
            {GROUPS.map(({ label, read, write }) => (
              <div key={label} className="grid grid-cols-[minmax(5.5rem,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-b border-line-100 px-3 py-2 last:border-b-0">
                <span className="text-body-sm font-medium text-ink-700">{label}</span>
                <div>{read ? <ToggleChip checked={value.includes(read)} onChange={() => toggle(read)}>{read}</ToggleChip> : <span className="text-body-sm text-ink-400">—</span>}</div>
                <div>{write ? <ToggleChip checked={value.includes(write)} onChange={() => toggle(write)}>{write}</ToggleChip> : <span className="text-body-sm text-ink-400">—</span>}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PresetButton({ active, label, description, recommended, onClick }: { active: boolean; label: string; description: string; recommended?: boolean; onClick: () => void }) {
  return (
    <Button type="button" role="radio" variant={active ? "primary" : "secondary"} wrap className="h-auto min-h-20 w-full justify-start px-3 py-3 text-left" onClick={onClick} aria-checked={active}>
      <span>
        <span className="block text-body-sm font-semibold">{label}{recommended ? " · recomendado" : ""}</span>
        <span className="mt-1 block text-caption font-normal opacity-80">{description}</span>
      </span>
    </Button>
  );
}
