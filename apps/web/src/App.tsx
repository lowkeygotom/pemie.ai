import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { safeNextPath, useAuth } from "./lib/auth.js";
import { track } from "./lib/analytics/index.js";
import { Layout } from "./components/Layout.js";
import { Spinner } from "./components/ui.js";
import Landing from "./pages/landing/Landing.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import Workspaces from "./pages/Workspaces.js";
import Workspace from "./pages/Workspace.js";
import WorkspaceSettings from "./pages/workspace/Settings.js";
import WorkspaceSkills from "./pages/workspace/Skills.js";
import Project from "./pages/Project.js";
import AcceptInvite from "./pages/AcceptInvite.js";
import Settings from "./pages/Settings.js";

export default function App() {
  const { loading, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // El callback de GitHub OAuth (rest/auth.ts) nunca pasa por el submit de
  // Login.tsx, así que `user_logged_in` no se dispara ahí. El backend marca el
  // redirect de éxito con `?oauth=github`; acá, ya con el usuario identificado
  // (AuthProvider ya corrió identify()), se dispara una sola vez y se limpia la URL.
  useEffect(() => {
    if (loading || !user) return;
    const params = new URLSearchParams(location.search);
    if (params.get("oauth") !== "github") return;
    track("user_logged_in");
    params.delete("oauth");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, location.pathname, location.search]);

  if (loading) return <Spinner />;

  return (
    <Routes>
      <Route path="/" element={<PublicLanding />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/invite/:token" element={<AcceptInvite />} />

      <Route path="/app" element={<Protected><Workspaces /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/w/:slug" element={<Protected><Workspace /></Protected>} />
      <Route path="/w/:slug/settings" element={<Protected><WorkspaceSettings /></Protected>} />
      <Route path="/w/:slug/skills" element={<Protected><WorkspaceSkills /></Protected>} />
      <Route path="/w/:slug/agents" element={<Protected><LegacyAgentsRedirect /></Protected>} />
      <Route path="/w/:slug/p/:projectSlug" element={<Protected><Project /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LegacyAgentsRedirect() {
  const { slug = "" } = useParams();
  return <Navigate to={`/w/${slug}/settings`} replace />;
}

/** `/` es la landing pública; con sesión activa redirige directo al dashboard. */
function PublicLanding() {
  const { user } = useAuth();
  if (user) return <Navigate to="/app" replace />;
  return <Landing />;
}

/**
 * Envuelve rutas que requieren sesión; redirige a /login recordando el destino
 * en `?next=` (no en el state del router: así sobrevive a un recargar de página
 * y al viaje redondo del OAuth de GitHub).
 */
function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Layout>{children}</Layout>;
}

/** Rutas solo para invitados (login/register); redirige a la app si ya hay sesión. */
function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user) return <Navigate to={safeNextPath(params.get("next"))} replace />;
  return <>{children}</>;
}
