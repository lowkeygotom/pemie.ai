import { useState } from "react";
import { api, ApiError, type Invitation } from "../lib/api.js";
import { Button, ErrorText, Field, Input, Modal } from "./ui.js";

export default function InvitePersonModal({ ws, initialEmail, onClose }: { ws: string; initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true); setError(null);
    try { setInvite((await api.workspaces.invite(ws, email)).invitation); }
    catch (e) { setError(e instanceof ApiError ? e.message : "No se pudo crear la invitación"); }
    finally { setSaving(false); }
  }
  return <Modal title="Invitar al workspace" onClose={onClose} dismissible={!saving}>
    <div className="space-y-4">
      {invite ? <div className="rounded-md border border-blue-600 bg-blue-100 p-3">
        <p className="text-body-sm text-ink-700">{invite.emailDelivered ? `Invitación enviada por correo a ${invite.email}.` : invite.emailPreviewUrl ? `Invitación enviada al buzón de prueba. Puedes ver el correo enviado:` : `Invitación creada para ${invite.email}.`}</p>
        {invite.emailPreviewUrl ? <a href={invite.emailPreviewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-body-sm font-medium text-blue-600 underline">Ver correo enviado →</a> : null}
        {invite.acceptUrl ? <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 font-mono text-caption text-ink-700">{invite.acceptUrl}</code><Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(invite.acceptUrl!)}>copiar link</Button></div> : null}
      </div> : <><Field label="Correo" hint="Aceptará cuando quiera. Mientras tanto, sus avisos de asignación siguen llegando sin el detalle de la HU."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field><ErrorText>{error}</ErrorText><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving ? "Enviando…" : "Invitar"}</Button></div></>}
    </div>
  </Modal>;
}
