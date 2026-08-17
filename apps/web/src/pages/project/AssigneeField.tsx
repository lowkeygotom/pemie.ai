import type { AssigneeCandidate } from "../../lib/api.js";
import { useTranslation } from "react-i18next";
import { Field, Select } from "../../components/ui.js";

function candidateLabel(c: AssigneeCandidate, noEmail: string): string {
  const base = c.name || c.githubLogin || c.email || "—";
  return c.notify === "none" ? `${base} · ${noEmail}` : base;
}

/** Select de "Asignado": contributors del proyecto + miembros del workspace sin contributor todavía. */
export function AssigneeSelect({
  value,
  onChange,
  candidates,
}: {
  value: string;
  onChange: (id: string) => void;
  candidates: AssigneeCandidate[];
}) {
  const { t } = useTranslation("project");
  const contributors = candidates.filter((c) => c.origin === "contributor");
  const members = candidates.filter((c) => c.origin === "member");
  return (
    <Field label={t("noAssignee")}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("noAssignee")}>
        <option value="">{t("noAssignee")}</option>
        {contributors.length ? (
          <optgroup label={t("contributors")}>
            {contributors.map((c) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c, t("noEmail"))}
              </option>
            ))}
          </optgroup>
        ) : null}
        {members.length ? (
          <optgroup label={t("workspaceMembers")}>
            {members.map((c) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c, t("noEmail"))}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </Field>
  );
}

/** Aviso condicional según cómo se le va a notificar al asignado (mismo texto/tokens en HU y Card). */
export function AssigneeNotice({
  candidate,
  canManage,
}: {
  candidate: AssigneeCandidate | undefined;
  canManage: boolean;
}) {
  const { t } = useTranslation("project");
  if (!candidate || candidate.notify === "member") return null;
  return (
    <div
      className={
        candidate.notify === "none"
          ? "rounded-md border border-amber-600 bg-amber-100 p-3 text-body-sm text-amber-700"
          : "rounded-md border border-blue-600 bg-blue-100 p-3 text-body-sm text-blue-700"
      }
    >
      {candidate.notify === "none" ? (
        <>
          {t("noEmailNotice")} {canManage ? t("addFromCollaborators") : t("adminCanAdd")}
        </>
      ) : (
        t("externalNotice")
      )}
    </div>
  );
}
