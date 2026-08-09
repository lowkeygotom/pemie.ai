import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Eyebrow, LogoMark, Wordmark } from "../../components/ui.js";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-0 lg:grid lg:grid-cols-2">
      <section className="flex min-h-screen flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-12 lg:py-10">
        <header>
          <Link
            to="/"
            aria-label="Ir al inicio de pemie.ai"
            className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:shadow-focus"
          >
            <LogoMark size={28} />
            <Wordmark />
          </Link>
        </header>

        <main className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-8">
              {eyebrow ? <Eyebrow className="mb-3 block">{eyebrow}</Eyebrow> : null}
              <h1 className="text-h2 text-ink-900 sm:text-h1">{title}</h1>
              <p className="mt-3 max-w-sm text-body text-ink-500">{subtitle}</p>
            </div>
            {children}
          </div>
        </main>

        <footer className="text-center lg:text-left">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-sm font-mono text-caption font-medium text-ink-500 transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:shadow-focus"
          >
            Conoce pemie.ai
            <span aria-hidden>↗</span>
          </Link>
        </footer>
      </section>

      <AuthSignalPanel />
    </div>
  );
}

function AuthSignalPanel() {
  return (
    <aside className="auth-signal-panel relative hidden min-h-screen overflow-hidden bg-surface-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="auth-signal-grid absolute inset-0" aria-hidden />
      <div className="auth-signal-glow absolute inset-0" aria-hidden />

      <div className="relative z-10 flex items-center justify-between">
        <span className="font-mono text-mono-label uppercase text-on-ink-muted">pemie / pulse</span>
        <span className="inline-flex items-center gap-2 rounded-pill border border-line-onink px-3 py-1.5 font-mono text-caption text-on-ink-soft">
          <span className="auth-status-dot h-2 w-2 rounded-pill bg-green-600" aria-hidden />
          Sistema activo
        </span>
      </div>

      <div className="auth-signal-art absolute inset-0" aria-hidden>
        <svg viewBox="0 0 800 900" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          <path
            className="auth-signal-path auth-signal-path-soft"
            d="M-80 600 C80 250 210 780 380 430 S680 220 880 530"
          />
          <path
            className="auth-signal-path"
            d="M-80 650 C110 270 250 760 400 410 S690 250 880 420"
          />
          <path
            className="auth-signal-path auth-signal-path-bright"
            d="M-80 700 C120 320 260 720 420 390 S700 300 880 330"
          />
          <circle cx="397" cy="414" r="7" className="auth-signal-node" />
          <circle cx="397" cy="414" r="24" className="auth-signal-ring" />
          <circle cx="640" cy="308" r="5" className="auth-signal-node auth-signal-node-soft" />
        </svg>
      </div>

      <div className="relative z-10 mt-auto max-w-lg">
        <Eyebrow className="mb-4 block text-on-ink-muted">OPERACIONES EN VIVO</Eyebrow>
        <h2 className="text-h2 text-on-ink">Tus proyectos, entendidos en tiempo real.</h2>
        <p className="mt-4 text-body-lg text-on-ink-soft">
          Historias, commits y señales del equipo conectadas en una sola vista para personas y agentes.
        </p>
        <div className="mt-8 flex items-center gap-3 border-t border-line-onink pt-5 font-mono text-caption text-on-ink-muted">
          <span>WEB</span>
          <span aria-hidden>→</span>
          <span>NÚCLEO DE NEGOCIO</span>
          <span aria-hidden>←</span>
          <span>MCP</span>
        </div>
      </div>
    </aside>
  );
}
