// Shell de la app autenticada: header sticky con marca, navegación y menú de usuario.

import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth.js";
import { useTheme, type Theme } from "../lib/theme.js";
import { useTranslation } from "react-i18next";
import { LogoMark, MoonIcon, Notice, SunIcon, Wordmark } from "./ui.js";

const ANALYTICS_NOTICE_DISMISSED_KEY = "pemie_analytics_notice_dismissed";

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // A nivel del shell (no adentro de `{user && ...}`): así se monta/desmonta
  // junto con el layout autenticado entero, sin parpadear con el loading de
  // sesión, y su cleanup suelta data-theme si se navega a una ruta pública
  // sin recarga completa (ver theme.ts).
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-screen flex-col bg-surface-50">
      {/* Único lugar del sistema donde se usa transparencia + blur. */}
      <header className="sticky top-0 z-50 border-b border-line-200 bg-[var(--surface-header)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-container items-center gap-3 px-4 py-3.5 sm:px-8">
          <Link to="/app" className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <Wordmark />
          </Link>
          {user && (
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <AccountMenu name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
            </div>
          )}
        </div>
      </header>
      {user && <AnalyticsNotice />}
      <main className="mx-auto w-full max-w-container flex-1 px-4 py-12 sm:px-8">{children}</main>
    </div>
  );
}

/** Botón de ícono visible en el header: alterna claro/oscuro directo, sin submenú. */
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const { t } = useTranslation("common");
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? t("lightMode") : t("darkMode")}
      className="grid h-8 w-8 place-items-center rounded-pill text-ink-600 transition-colors hover:bg-surface-100 hover:text-ink-800 focus-visible:outline-none focus-visible:shadow-focus"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Aviso no bloqueante, una sola vez por navegador — dismissible, no es un gate. */
function AnalyticsNotice() {
  const { t } = useTranslation("common");
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(ANALYTICS_NOTICE_DISMISSED_KEY) === "1"
  );
  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(ANALYTICS_NOTICE_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="mx-auto w-full max-w-container px-4 pt-4 sm:px-8">
      <Notice tone="info" onDismiss={dismiss}>
        {t("analyticsNotice")} {" "}
        <Link to="/settings" onClick={dismiss} className="font-medium underline">
          {t("settings")}
        </Link>
        .
      </Notice>
    </div>
  );
}

/** Menú mínimo de cuenta: avatar como trigger, "Ajustes" (toggle de analítica) + "Salir". */
function AccountMenu({
  name,
  email,
  avatarUrl,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  const { logout } = useAuth();
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate("/login");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("accountMenu")}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-pill transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:shadow-focus"
      >
        <span className="hidden font-mono text-caption text-ink-500 sm:inline">
          {name ?? email}
        </span>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-7 w-7 rounded-pill border border-line-200" />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-pill bg-blue-100 text-caption font-semibold text-blue-700">
            {(name ?? email).charAt(0).toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-44 overflow-hidden rounded-md border border-line-200 bg-surface-0 py-1.5 shadow-md"
        >
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2 text-body-sm text-ink-800 transition-colors hover:bg-surface-50"
          >
            {t("settings")}
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={handleLogout}
            className="block w-full px-3.5 py-2 text-left text-body-sm text-ink-800 transition-colors hover:bg-surface-50"
          >
            {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
