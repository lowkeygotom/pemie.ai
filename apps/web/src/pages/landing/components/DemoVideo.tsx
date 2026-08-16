// Demo de producto en la landing: un teaser que se reproduce solo (muted,
// loop, sin controles) mientras está en el viewport. Puramente visual, sin
// ninguna interacción — el usuario no hace click ni pausa nada.
//
// El frame es un chrome de navegador: mismo motivo que el chrome de terminal
// de `CodeBlock`/`TerminalDemo` (tres puntos macOS + etiqueta mono), en
// versión clara porque lo que se ve es la app, no una terminal.

import { useEffect, useRef, useState } from "react";

export function DemoVideo({
  src,
  /** Contexto de la demo en la barra del navegador (ej. "app.pemie.ai · informes"). */
  label,
  /** Línea mono bajo el frame (ej. "caso real · un informe completo"). */
  caption,
  ariaLabel,
  /** La sección MCP va sobre fondo ink: solo cambia el color del caption. */
  onInk = false,
}: {
  src: string;
  label: string;
  caption: string;
  ariaLabel: string;
  onInk?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // El teaser gasta CPU/red solo mientras se ve: se pausa al salir del
  // viewport y retoma al volver. Con prefers-reduced-motion queda quieto en
  // el primer frame.
  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || reducedMotion) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 }
    );
    io.observe(frame);
    return () => io.disconnect();
  }, [reducedMotion]);

  return (
    <div className="mx-auto max-w-3xl">
      <div
        ref={frameRef}
        className="overflow-hidden rounded-lg border border-line-200 bg-surface-0 shadow-sm"
      >
        <div className="flex items-center gap-2 border-b border-line-100 px-3.5 py-2.5">
          <span className="h-2.5 w-2.5 rounded-pill bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-pill bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-pill bg-[#28c840]" />
          <span className="ml-1.5 truncate font-mono text-mono-label text-ink-400">{label}</span>
          <span className="ml-auto flex flex-none items-center gap-1.5 font-mono text-mono-label uppercase text-ink-400">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-pill bg-red-600" />
            demo
          </span>
        </div>
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="metadata"
          src={src}
          aria-label={ariaLabel}
          className="block w-full bg-surface-50 pointer-events-none"
        />
      </div>
      <p
        className={`mt-3.5 text-center font-mono text-caption ${
          onInk ? "text-on-ink-muted" : "text-ink-600"
        }`}
      >
        {caption}
      </p>
    </div>
  );
}
