import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, analyticsFailureReason, ApiError, type InvitationDetail } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { track } from "../lib/analytics/index.js";
import { Button, ErrorText, Spinner } from "../components/ui.js";
import { AuthShell } from "./auth/AuthShell.js";
import { useTranslation } from "react-i18next";

export default function AcceptInvite() {
  const { t } = useTranslation("collaboration");
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
      .catch((e) => setError(e instanceof ApiError ? e.message : t("invalidInvite")));
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
      setError(err instanceof ApiError ? err.message : t("acceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <AuthShell eyebrow={t("invitation").toUpperCase()} title={t("invitation")} subtitle={t("inviteLoadFailed")}>
        <ErrorText>{error}</ErrorText>
      </AuthShell>
    );
  }
  if (!detail) return <Spinner />;

  return (
    <AuthShell
      eyebrow={t("invitation").toUpperCase()}
      title={t("join", { workspace: detail.workspace.name })}
      subtitle={t("inviteFor", { email: detail.email, role: detail.role })}
    >
      {detail.expired ? (
        <p className="text-center text-body-sm text-ink-500">{t("inviteExpired")}</p>
      ) : !user ? (
        <div className="space-y-4">
          <p className="text-center text-body-sm text-ink-500">
            {t("signInToAccept", { email: detail.email })}
          </p>
          <Button className="w-full" onClick={() => navigate(`/login?next=${backHere}`)}>
            {t("signIn")}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => navigate(`/register?next=${backHere}`)}
          >
            {t("createAccount")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button className="w-full" onClick={onAccept} disabled={busy}>
            {busy ? t("accepting") : t("acceptInvite")}
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </AuthShell>
  );
}
