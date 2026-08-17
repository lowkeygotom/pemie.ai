import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { safeNextPath, useAuth } from "../lib/auth.js";
import { api, analyticsFailureReason, ApiError } from "../lib/api.js";
import { track } from "../lib/analytics/index.js";
import { Button, ErrorText, Field, GithubIcon, Input } from "../components/ui.js";
import { AuthShell } from "./auth/AuthShell.js";
import { useTranslation } from "react-i18next";

export default function Login() {
  const { login } = useAuth();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Destino tras autenticarse: lo fija quien nos mandó aquí (ruta protegida o
  // pantalla de invitación). Se propaga al OAuth para volver al mismo sitio.
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthError(params.get("error"), t));
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      track("user_logged_in");
      navigate(next, { replace: true });
    } catch (err) {
      track("user_logged_in_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : t("loginError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow={t("access")}
      title={t("loginTitle")}
      subtitle={t("loginSubtitle")}
    >
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => window.location.assign(api.auth.githubUrl(next))}
      >
        <GithubIcon />
        {t("continueWithGithub")}
      </Button>

      <div className="my-6 flex items-center gap-3 text-caption text-ink-400">
        <div className="h-px flex-1 bg-line-100" />
        <span className="font-mono">{t("orWithEmail")}</span>
        <div className="h-px flex-1 bg-line-100" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("email")}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("password")}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("loggingIn") : t("login")}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-500">
        {t("noAccount")} {" "}
        <Link
          to={next === "/app" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {t("register")}
        </Link>
      </p>
    </AuthShell>
  );
}

function oauthError(code: string | null, t: (key: string) => string): string | null {
  if (!code) return null;
  if (code === "oauth_state") return t("oauthState");
  if (code === "oauth_unconfigured") return t("oauthUnconfigured");
  return t("oauthUnknown");
}
