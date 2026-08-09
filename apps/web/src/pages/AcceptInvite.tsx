import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, analyticsFailureReason, ApiError, type InvitationDetail } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { track } from "../lib/analytics/index.js";
import { Button, ErrorText, Spinner } from "../components/ui.js";
import { AuthShell } from "./auth/AuthShell.js";

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // Ruta a la que volver tras autenticarse, para retomar la invitación.
  const backHere = encodeURIComponent(`/invite/${token}`);
  const [detail, setDetail] = useState<InvitationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invitations
      .detail(token)
      .then((r) => setDetail(r.invitation))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Invitación inválida"));
  }, [token]);

  async function onAccept() {
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.invitations.accept(token);
      track("invite_accepted");
      navigate(`/w/${workspace.slug}`);
    } catch (err) {
      track("invite_accepted_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : "No se pudo aceptar");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <AuthShell eyebrow="INVITACIÓN" title="Invitación" subtitle="No pudimos cargar esta invitación.">
        <ErrorText>{error}</ErrorText>
      </AuthShell>
    );
  }
  if (!detail) return <Spinner />;

  return (
    <AuthShell
      eyebrow="INVITACIÓN"
      title={`Únete a ${detail.workspace.name}`}
      subtitle={`Invitación para ${detail.email} · rol ${detail.role}`}
    >
      {detail.expired ? (
        <p className="text-center text-body-sm text-ink-500">Esta invitación expiró.</p>
      ) : !user ? (
        <div className="space-y-4">
          <p className="text-center text-body-sm text-ink-500">
            Inicia sesión o regístrate con{" "}
            <span className="font-medium text-ink-900">{detail.email}</span> para aceptar la
            invitación.
          </p>
          <Button className="w-full" onClick={() => navigate(`/login?next=${backHere}`)}>
            Iniciar sesión
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => navigate(`/register?next=${backHere}`)}
          >
            Crear cuenta
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button className="w-full" onClick={onAccept} disabled={busy}>
            {busy ? "Aceptando…" : "Aceptar invitación"}
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </AuthShell>
  );
}
