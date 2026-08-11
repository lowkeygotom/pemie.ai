import type { AssigneeCandidate } from "../../lib/api.js";
import { Field, Select } from "../../components/ui.js";

function candidateLabel(c: AssigneeCandidate): string {
  const base = c.name || c.githubLogin || c.email || "—";
  return c.notify === "none" ? `${base} · sin correo` : base;
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
  const contributors = candidates.filter((c) => c.origin === "contributor");
  const members = candidates.filter((c) => c.origin === "member");
  return (
    <Field label="Asignado">
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Asignado">
        <option value="">Sin asignar</option>
        {contributors.length ? (
          <optgroup label="Colaboradores">
            {contributors.map((c) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {members.length ? (
          <optgroup label="Miembros del workspace">
            {members.map((c) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c)}
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
          Sin correo: se asignará, pero no recibirá aviso.{" "}
          {canManage ? "Agrégalo desde Colaboradores antes de guardar." : "Un owner o admin puede agregarlo desde Colaboradores."}
        </>
      ) : (
        "Recibirá un aviso sin el detalle de la HU: no tiene cuenta en el workspace."
      )}
    </div>
  );
}
