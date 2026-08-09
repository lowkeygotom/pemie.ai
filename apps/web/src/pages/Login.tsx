import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { safeNextPath, useAuth } from "../lib/auth.js";
import { api, analyticsFailureReason, ApiError } from "../lib/api.js";
import { track } from "../lib/analytics/index.js";
import { Button, ErrorText, Field, GithubIcon, Input } from "../components/ui.js";
import { AuthShell } from "./auth/AuthShell.js";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Destino tras autenticarse: lo fija quien nos mandó aquí (ruta protegida o
  // pantalla de invitación). Se propaga al OAuth para volver al mismo sitio.
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthError(params.get("error")));
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
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ACCESO"
      title="Entra a pemie.ai"
      subtitle="Continúa donde lo dejaste y vuelve a tener la operación completa a la vista."
    >
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => window.location.assign(api.auth.githubUrl(next))}
      >
        <GithubIcon />
        Continuar con GitHub
      </Button>

      <div className="my-6 flex items-center gap-3 text-caption text-ink-400">
        <div className="h-px flex-1 bg-line-100" />
        <span className="font-mono">o con email</span>
        <div className="h-px flex-1 bg-line-100" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-500">
        ¿No tienes cuenta?{" "}
        <Link
          to={next === "/app" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          Regístrate
        </Link>
      </p>
    </AuthShell>
  );
}

function oauthError(code: string | null): string | null {
  if (!code) return null;
  if (code === "oauth_state") return "La sesión de GitHub expiró. Intenta de nuevo.";
  if (code === "oauth_unconfigured")
    return "El acceso con GitHub aún no está habilitado en este servidor. Entra con tu correo y contraseña.";
  return "No se pudo iniciar sesión con GitHub.";
}
