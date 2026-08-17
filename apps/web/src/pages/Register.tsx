import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { safeNextPath, useAuth } from "../lib/auth.js";
import { analyticsFailureReason, ApiError } from "../lib/api.js";
import { track } from "../lib/analytics/index.js";
import { Button, ErrorText, Field, Input } from "../components/ui.js";
import { AuthShell } from "./auth/AuthShell.js";
import { useTranslation } from "react-i18next";

export default function Register() {
  const { register } = useAuth();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Destino tras crear la cuenta (p. ej. volver a aceptar una invitación).
  const next = safeNextPath(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(email, password, name || undefined);
      track("user_signed_up");
      navigate(next, { replace: true });
    } catch (err) {
      track("user_signed_up_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : t("registerError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow={t("registerEyebrow")} title={t("registerTitle")} subtitle={t("registerSubtitle")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("optional")} />
        </Field>
        <Field label={t("email")}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("password")}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder={t("minPassword")}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("creatingAccount") : t("createAccount")}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-500">
        {t("haveAccount")} {" "}
        <Link
          to={next === "/app" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {t("login")}
        </Link>
      </p>
    </AuthShell>
  );
}
