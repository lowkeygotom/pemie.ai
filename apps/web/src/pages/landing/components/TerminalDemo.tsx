// Demo interactiva del hero: pestañas de comandos `pemie` con salida animada.
// Reutiliza el chrome de terminal de CodeBlock (mismos tres puntos, mismo tono)
// pero necesita tabs + estado propio, así que vive como su propio componente.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TERMINAL_SCRIPTS, type TerminalTone } from "../data/terminalScripts.js";
import { useTerminalPlayback } from "../hooks/useTerminalPlayback.js";

const TONE_CLASSES: Record<TerminalTone, string> = {
  default: "text-on-ink",
  accent: "text-accent-onink",
  muted: "text-on-ink-muted",
  string: "text-code-string",
};

export function TerminalDemo() {
  const { t } = useTranslation("landing");
  const [activeId, setActiveId] = useState(TERMINAL_SCRIPTS[0].id);
  const script = TERMINAL_SCRIPTS.find((s) => s.id === activeId) ?? TERMINAL_SCRIPTS[0];
  const { typed, lines } = useTerminalPlayback(script);

  return (
    <div className="mx-auto w-full max-w-[860px] overflow-hidden rounded-lg bg-surface-ink shadow-lg">
      <div className="flex items-center gap-2 border-b border-line-onink px-4.5 py-3.5">
        <span className="h-2.5 w-2.5 rounded-pill bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-pill bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-pill bg-[#28c840]" />
        <span className="ml-3 font-mono text-mono-label text-on-ink-muted">{t("terminalDemo.agentMcp")}</span>
      </div>

      <div className="flex flex-wrap gap-2 px-4.5 pt-3" role="tablist" aria-label={t("terminalDemo.exampleCommands")}>
        {TERMINAL_SCRIPTS.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(s.id)}
              className={`rounded-sm border px-3 py-1.5 font-mono text-mono-label lowercase transition-colors duration-150 ${
                active
                  ? "border-blue-600 bg-blue-600/20 text-on-ink"
                  : "border-line-onink bg-transparent text-on-ink-muted hover:border-accent-onink hover:text-on-ink"
              }`}
            >
              {s.label}
            </button>
          );
        })}
        <span className="ml-auto self-center font-mono text-caption text-on-ink-muted">{t("terminalDemo.tryIt")}</span>
      </div>

      <div
        aria-live="polite"
        className="min-h-[176px] overflow-x-auto px-6 py-4 font-mono text-body-sm leading-loose text-on-ink-code sm:text-[14px]"
      >
        <div className="whitespace-pre-wrap">
          <span className="text-accent-onink">$ </span>
          <span className="text-on-ink">{lines.length > 0 ? script.command : typed}</span>
          {lines.length === 0 ? <Caret /> : null}
        </div>
        {lines.map((segs, i) => (
          <div key={i} className="animate-fade-up whitespace-pre-wrap [animation-duration:250ms]">
            {segs.map((seg, j) => (
              <span key={j} className={TONE_CLASSES[seg.tone]}>
                {seg.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="inline-block h-[17px] w-[9px] animate-caret-blink bg-blue-600 align-text-bottom motion-reduce:hidden"
    />
  );
}
