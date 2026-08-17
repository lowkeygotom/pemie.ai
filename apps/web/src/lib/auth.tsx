// Contexto de autenticación: carga el usuario actual (cookie de sesión) y
// expone login/register/logout al resto de la app.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api.js";
import { applyAnalyticsConsent, identifyUser, resetAnalytics, track } from "./analytics/index.js";
import { queryClient } from "./queryClient.js";
import i18n from "../i18n/index.js";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setAnalyticsPreference: (enabled: boolean) => Promise<void>;
  setLocale: (locale: User["locale"]) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Único punto donde el estado de sesión pasa a "hay usuario": aplica identify()
  // + el consentimiento hidratado ahí mismo, en vez de repetirlo en cada caller
  // (login/register/refresh comparten el mismo tránsito de estado).
  function applyUser(next: User | null) {
    setUser(next);
    if (next) {
      identifyUser(next);
      applyAnalyticsConsent(next.analyticsEnabled);
      void i18n.changeLanguage(next.locale);
    }
  }

  async function refresh() {
    const { user } = await api.auth.me();
    applyUser(user);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthState = {
    user,
    loading,
    refresh,
    login: async (email, password) => {
      const { user } = await api.auth.login({ email, password });
      // Una sesión que caducó sin pasar por logout deja su caché en memoria;
      // entrar con otra cuenta sin limpiarla mostraría datos del anterior.
      queryClient.clear();
      applyUser(user);
    },
    register: async (email, password, name) => {
      const { user } = await api.auth.register({ email, password, name });
      queryClient.clear();
      applyUser(user);
    },
    logout: async () => {
      await api.auth.logout();
      track("user_logged_out"); // antes del reset: todavía identificado como el usuario que sale
      resetAnalytics();
      // La caché de queries sobrevive al desmontaje de las vistas: sin esto,
      // tableros, historias y repos de GitHub del usuario que sale quedarían
      // disponibles para quien entre después en el mismo navegador.
      queryClient.clear();
      setUser(null);
    },
    setAnalyticsPreference: async (enabled) => {
      const { user } = await api.auth.updateAnalyticsPreference(enabled);
      applyAnalyticsConsent(enabled); // efecto inmediato en cliente, sin esperar el próximo refresh
      setUser(user);
    },
    setLocale: async (locale) => {
      const { user } = await api.auth.updateLocale(locale);
      await i18n.changeLanguage(user.locale);
      setUser(user);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Sanea la ruta de retorno tras autenticarse (`?next=`): solo rutas relativas
 * de esta app, nunca URLs absolutas (evita redirigir a un dominio ajeno).
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/app";
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/app";
  return path;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
