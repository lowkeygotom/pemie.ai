// Kit de UI de pemie.ai — implementa el design system sobre Tailwind + tokens CSS.
// Reglas del sistema: radios sm/md/lg, borde hairline, sombra fría, acento azul único,
// mono (IBM Plex) para etiquetas, comandos y métricas.

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ---------------------------------- forms --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "mono";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white border border-blue-600 shadow-xs hover:bg-blue-700 hover:border-blue-700 hover:-translate-y-px hover:shadow-md active:translate-y-0",
  secondary:
    "bg-surface-0 text-ink-900 border border-line-200 hover:bg-surface-50 hover:border-ink-300",
  ghost: "bg-transparent text-ink-800 border border-transparent hover:bg-surface-100",
  danger: "bg-surface-0 text-red-600 border border-red-100 hover:bg-red-100",
  mono: "bg-surface-100 text-ink-800 border border-line-200 font-mono font-medium hover:bg-surface-0 hover:border-ink-300",
};

const BUTTON_SIZES = {
  sm: "px-3.5 py-2 text-body-sm rounded-sm gap-1.5",
  md: "px-5 py-2.5 text-body rounded-md gap-2",
  lg: "px-6 py-3.5 text-[16px] rounded-md gap-2.5",
};

export function Button({
  variant = "primary",
  size = "md",
  wrap = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  /** Para contenido multilínea (ej. tarjetas de opción con descripción): permite romper línea en vez de desbordar sobre el elemento vecino. */
  wrap?: boolean;
}) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-[background-color,border-color,transform,box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
        wrap ? "whitespace-normal break-words leading-snug" : "whitespace-nowrap leading-none"
      } ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

// Los inputs comparten el mismo tratamiento: radio sm, borde hairline, anillo azul de 3px.
// Sin utilidad de ancho: cada control decide, para que `className` pueda sobreescribirlo.
const CONTROL =
  "rounded-sm border border-line-200 bg-surface-0 px-3.5 py-2.5 text-body text-ink-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 focus:border-blue-600 focus:shadow-focus disabled:bg-surface-50 disabled:text-ink-400";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${CONTROL} w-full min-w-0 ${className}`} {...props} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    /** Crece con el contenido en vez de scrollear (altura mínima según `rows`). */
    autoResize?: boolean;
  }
>(function Textarea({ className = "", autoResize = false, value, ...props }, ref) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!autoResize || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [autoResize, value]);

  return (
    <textarea
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      value={value}
      className={`${CONTROL} w-full min-w-0 leading-snug ${autoResize ? "resize-none overflow-hidden" : ""} ${className}`}
      {...props}
    />
  );
});

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} w-full min-w-0 max-w-full ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-body-sm font-semibold text-ink-800">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-caption text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-body-sm text-ink-800"
    >
      <span
        className={`relative h-[22px] w-[38px] rounded-pill transition-colors duration-150 ${
          checked ? "bg-blue-600" : "bg-ink-300"
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-pill bg-white shadow-xs transition-[left] duration-200 ease-overshoot ${
            checked ? "left-[19px]" : "left-[3px]"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/**
 * Chip de selección tipo checkbox (scopes, tags…). El checkbox real queda
 * `sr-only` y el pill visual vive en un `<span>` hermano marcado vía `peer`:
 * así el foco de teclado (`peer-focus-visible:shadow-focus`) es visible aunque
 * el input esté oculto — un `<label>` no puede ser objetivo de `peer-*` de su
 * propio hijo, por eso el estilo no vive directamente en el `<label>`.
 */
export function ToggleChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} />
      <span
        className={`rounded-pill border px-2.5 py-1 font-mono text-caption font-medium transition-colors peer-focus-visible:shadow-focus peer-focus-visible:outline-none ${
          checked
            ? "border-blue-600 bg-blue-100 text-blue-700"
            : "border-line-200 bg-surface-100 text-ink-600 hover:border-ink-300"
        }`}
      >
        {children}
      </span>
    </label>
  );
}

/** Confirmación puntual con el mismo foco visible que el resto del sistema. */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-body-sm text-ink-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-sm border text-white transition-colors peer-focus-visible:shadow-focus ${
          checked ? "border-blue-600 bg-blue-600" : "border-line-200 bg-surface-0"
        }`}
      >
        {checked ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m1.8 5.2 2 2 4.4-4.4" />
          </svg>
        ) : null}
      </span>
      <span>{children}</span>
    </label>
  );
}

/* --------------------------------- display -------------------------------- */

const CARD_PADDING = { sm: "p-3", md: "p-6", none: "" };

// `forwardRef` + spread de `rest` para que primitivas como drag-and-drop (dnd-kit)
// puedan adjuntar su `ref`/`style`/listeners sin envolver Card en un div extra.
export const Card = forwardRef<
  HTMLDivElement,
  Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
    className?: string;
    interactive?: boolean;
    padding?: keyof typeof CARD_PADDING;
    children: ReactNode;
  }
>(function Card({ className = "", interactive = false, padding = "md", children, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={`rounded-lg border border-line-200 bg-surface-0 shadow-xs transition-[box-shadow,border-color,transform] duration-150 ${
        CARD_PADDING[padding]
      } ${
        interactive ? "cursor-pointer hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-md" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-body-sm text-red-700">{children}</p>;
}

export type NoticeTone = "success" | "warning" | "danger" | "info";

// Shades -50/-200 no están en la escala del proyecto (solo -100/-600/-700):
// como "blue"/"green"/"red"/"amber" son nombres de color que Tailwind ya trae
// de stock, esas shades existían igual pero apuntaban al hex fijo de Tailwind,
// no al token — por eso no se adaptaban a dark mode.
const NOTICE_TONES: Record<NoticeTone, string> = {
  success: "border-green-600 bg-green-100 text-green-700",
  warning: "border-amber-600 bg-amber-100 text-amber-700",
  danger: "border-red-600 bg-red-100 text-red-700",
  info: "border-blue-600 bg-blue-100 text-blue-700",
};

/**
 * Aviso en bloque para el resultado de una acción (a diferencia de `ErrorText`,
 * que es una línea suelta bajo un campo). `onDismiss` lo hace descartable.
 */
export function Notice({
  children,
  tone = "info",
  onDismiss,
}: {
  children: ReactNode;
  tone?: NoticeTone;
  onDismiss?: () => void;
}) {
  if (!children) return null;
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-body-sm ${NOTICE_TONES[tone]}`}
    >
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Descartar aviso"
          className="shrink-0 rounded-sm px-1 leading-none opacity-60 transition-opacity hover:opacity-100 focus:shadow-focus focus:outline-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

const BADGE_TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-surface-100 text-ink-700", dot: "bg-ink-400" },
  brand: { chip: "bg-blue-100 text-blue-700", dot: "bg-blue-600" },
  success: { chip: "bg-green-100 text-green-700", dot: "bg-green-600" },
  warning: { chip: "bg-amber-100 text-amber-700", dot: "bg-amber-600" },
  danger: { chip: "bg-red-100 text-red-700", dot: "bg-red-600" },
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  mono = false,
  wrap = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  mono?: boolean;
  /** Para contenido de longitud libre (ej. un verdict de texto libre): permite que rompa línea en vez de desbordar. */
  wrap?: boolean;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 leading-snug ${
        wrap ? "max-w-full whitespace-normal break-words text-left" : "whitespace-nowrap"
      } ${t.chip} ${mono ? "font-mono text-mono-label font-medium uppercase" : "text-caption font-semibold"}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-pill ${t.dot}`} /> : null}
      {children}
    </span>
  );
}

const AVATAR_SIZES = {
  sm: "h-8 w-8 rounded-md text-body-sm",
  md: "h-[52px] w-[52px] rounded-lg text-h4",
};

/** Inicial sobre tinte de marca, mismo tratamiento que el avatar de `AccountMenu` (sin variar por entidad). */
export function Avatar({
  label,
  size = "md",
}: {
  label: string;
  size?: keyof typeof AVATAR_SIZES;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center bg-blue-100 font-bold text-blue-700 ${AVATAR_SIZES[size]}`}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** Chip mono de atajo de teclado (`⌘1`, `⌘N`, `/`). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-line-200 bg-surface-50 px-2 py-1 font-mono text-caption text-ink-400">
      {children}
    </span>
  );
}

// Métricas siempre en mono: es la convención de "proof points" del sistema.
export function Stat({
  value,
  label,
  delta,
  deltaTone = "success",
}: {
  value: ReactNode;
  label: string;
  delta?: string;
  deltaTone?: "success" | "danger" | "neutral";
}) {
  const tone = {
    success: "text-[#0d7a51]",
    danger: "text-[#b8353a]",
    neutral: "text-ink-400",
  }[deltaTone];
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[30px] font-semibold leading-none tracking-[-0.01em] text-ink-900">
          {value}
        </span>
        {delta ? <span className={`font-mono text-caption font-medium ${tone}`}>{delta}</span> : null}
      </div>
      <div className="mt-1.5 text-body-sm text-ink-500">{label}</div>
    </div>
  );
}

// El panel de terminal es el motivo firma de pemie: chrome macOS, prompt azul, copiar.
export function CodeBlock({
  children,
  command,
  title = "bash",
  copyable = true,
  onCopy,
  className = "",
}: {
  children?: ReactNode;
  command?: string;
  title?: string;
  copyable?: boolean;
  onCopy?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = command ?? (typeof children === "string" ? children : "");

  function copy() {
    void navigator.clipboard?.writeText(text);
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    // Ventana de terminal: siempre oscura por diseño (tokens on-ink, ver colors.css),
    // sin importar el tema activo. Con ink-900/ink-800 se invertía en dark mode y el
    // texto quedaba casi blanco sobre un fondo que también pasaba a casi blanco.
    <div
      className={`overflow-hidden rounded-md border border-line-onink bg-surface-ink font-mono ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line-onink px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-pill bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-pill bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-pill bg-[#28c840]" />
        <span className="ml-1.5 text-mono-label text-on-ink-muted">{title}</span>
        {copyable && text ? (
          <button
            type="button"
            onClick={copy}
            aria-label={`Copiar ${title}`}
            className={`ml-auto text-mono-label transition-colors ${
              copied ? "text-accent-onink" : "text-on-ink-muted hover:text-on-ink"
            }`}
          >
            {copied ? "copied" : "copy"}
          </button>
        ) : null}
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-body-sm leading-relaxed text-on-ink-code">
        <code>
          {command ? (
            <>
              <span className="select-none text-accent-onink">$ </span>
              {command}
            </>
          ) : (
            children
          )}
        </code>
      </pre>
    </div>
  );
}

/* -------------------------------- navigation ------------------------------ */

export type TabItem = { id: string; label: string; count?: number };

export function Tabs({
  items,
  value,
  onChange,
  className = "",
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex flex-nowrap gap-1 overflow-x-auto border-b border-line-200 ${className}`}
    >
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap px-3.5 pb-3 pt-2.5 text-[14px] transition-colors duration-150 ${
              on ? "font-semibold text-ink-900" : "font-medium text-ink-500 hover:text-ink-800"
            }`}
          >
            {it.label}
            {it.count != null ? (
              <span
                className={`rounded-pill px-1.5 py-px font-mono text-mono-label ${
                  on ? "bg-blue-100 text-blue-600" : "bg-surface-100 text-ink-400"
                }`}
              >
                {it.count}
              </span>
            ) : null}
            <span
              className={`absolute inset-x-0 -bottom-px h-0.5 rounded-sm ${
                on ? "bg-blue-600" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

/** Panel plegable: cabecera siempre visible; el cuerpo se muestra u oculta. */
export function Collapsible({
  title,
  description,
  defaultOpen = false,
  open: openControlled,
  onOpenChange,
  badge,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openControlled ?? uncontrolled;

  function toggle() {
    const next = !open;
    if (openControlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }

  return (
    <Card padding="none" className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-6 py-4 text-left transition-colors hover:bg-surface-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
      >
        <span
          aria-hidden
          className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center text-ink-400 transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M3.2 1.2a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5A.75.75 0 1 1 3.2 8.2L6.05 5.35 3.2 2.5a.75.75 0 0 1 0-1.3Z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-h4 text-ink-900">{title}</span>
            {badge}
          </span>
          {description && open ? (
            <span className="mt-1 block text-body-sm text-ink-500">{description}</span>
          ) : null}
        </span>
        <span className="mt-0.5 shrink-0 font-mono text-caption uppercase text-ink-400">
          {open ? "Ocultar" : "Mostrar"}
        </span>
      </button>
      {open ? <div className="border-t border-line-100 px-6 py-5">{children}</div> : null}
    </Card>
  );
}

/* --------------------------------- utility -------------------------------- */

// Eyebrow mono en mayúsculas — la etiqueta de sección del sistema.
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`eyebrow ${className}`}>{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <Eyebrow className="mb-2 block">{eyebrow}</Eyebrow> : null}
        <h1 className="text-h2 text-ink-900">{title}</h1>
        {description ? <p className="mt-2 text-body text-ink-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  // `compact` para huecos estrechos (columnas de tablero), donde el bloque completo pesa demasiado.
  if (compact) {
    return (
      <p className="rounded-md border border-dashed border-ink-300 px-3 py-5 text-center text-body-sm text-ink-400">
        {title}
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-line-200 bg-surface-50 px-6 py-12 text-center">
      <p className="text-h4 text-ink-900">{title}</p>
      {description ? <p className="mx-auto mt-2 max-w-md text-body-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

// Las acciones irreversibles se agrupan aparte y con el tono de peligro del sistema:
// nadie debe poder destruir algo por inercia mientras completa un formulario normal.
export function DangerZone({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-red-100 bg-surface-0 shadow-xs">
      <h3 className="border-b border-red-100 bg-red-100 px-6 py-3.5 text-h4 text-red-700">
        {title}
      </h3>
      <div className="p-6">
        {description ? <div className="mb-5 text-body-sm text-ink-600">{description}</div> : null}
        {children}
      </div>
    </section>
  );
}

// Overlay centrado reutilizable (picker de repos, detalle de tarjeta, etc.).
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  size,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  size?: "md" | "lg" | "xl";
  dismissible?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dismissible && e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!dialogRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissible, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-label={title}
        className={`max-h-[85vh] w-full min-w-0 overflow-hidden rounded-xl border border-line-200 bg-surface-0 shadow-lg ${
          size === "xl" ? "max-w-3xl" : size === "lg" || wide ? "max-w-2xl" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line-100 p-4">
          <h3 className="min-w-0 truncate text-h4 text-ink-900">{title}</h3>
          {dismissible ? (
            <button
              type="button"
              className="shrink-0 text-body text-ink-400 transition-colors hover:text-ink-900"
              onClick={onClose}
            >
              Cerrar
            </button>
          ) : null}
        </div>
        <div className="max-h-[calc(85vh-3.5rem)] overflow-y-auto overflow-x-hidden p-4">
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Affordance de arrastre: seis puntos, mismo peso visual en cualquier fondo del sistema.
// Primitiva pensada para listas reordenables (tablero Kanban, backlog, etc.).
export function DragHandle({ className = "" }: { className?: string }) {
  return (
    <svg
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {[2, 8].flatMap((x) =>
        [2, 8, 14].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />)
      )}
    </svg>
  );
}

export function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.75A.75.75 0 0 1 6.25 2h3.5a.75.75 0 0 1 .75.75V4" />
      <path d="M4 4l.6 8.4A1.5 1.5 0 0 0 6.1 13.8h3.8a1.5 1.5 0 0 0 1.5-1.4L12 4" />
      <path d="M6.5 7v4" />
      <path d="M9.5 7v4" />
    </svg>
  );
}

export function PencilIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M11.05 2.55a1.5 1.5 0 0 1 2.12 0l.28.28a1.5 1.5 0 0 1 0 2.12L5.6 12.8l-3 .8.8-3 7.65-7.65Z" />
      <path d="M10 3.6 12.4 6" />
    </svg>
  );
}

export function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.72 3.28l-1.06 1.06M4.34 11.66l-1.06 1.06M12.72 12.72l-1.06-1.06M4.34 4.34 3.28 3.28" />
    </svg>
  );
}

export function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M13.5 9.35A5.75 5.75 0 1 1 6.65 2.5a4.6 4.6 0 0 0 6.85 6.85Z" />
    </svg>
  );
}

export function Spinner() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <span className="eyebrow animate-pulse">cargando</span>
    </div>
  );
}

// ─── Skeletons ──────────────────────────────────────────────────────────────
// Placeholders con la FORMA del contenido final (no un spinner). Ver CLAUDE.md:
// toda carga asíncrona de contenido usa skeletons que imitan el layout para
// evitar saltos cuando llegan los datos.

/** Primitiva base: caja con pulso. Ajusta tamaño/forma vía className. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-sm bg-line-100 ${className}`}
    />
  );
}

/** Líneas de texto simuladas; la última sale más corta. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** Una tarjeta skeleton (título + cuerpo) dentro de un Card real. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <Skeleton className="mb-4 h-5 w-40" />
      <SkeletonText lines={lines} />
    </Card>
  );
}

/** Lista de filas skeleton (para listas de commits, HUs, informes, keys…). */
export function SkeletonList({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`divide-y divide-line-100 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3.5">
          <Skeleton className="h-9 w-9 rounded-pill" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-pill" />
        </div>
      ))}
    </div>
  );
}

/** Fila de stats skeleton (para dashboards con Stat). */
export function SkeletonStats({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-line-200 bg-surface-0 p-4">
          <Skeleton className="mb-3 h-3 w-20" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Tablero Kanban skeleton (columnas con tarjetas). */
export function SkeletonBoard({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="w-72 shrink-0 rounded-md border border-line-200 bg-surface-50 p-3">
          <Skeleton className="mb-3 h-4 w-24" />
          <div className="space-y-2.5">
            {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
              <div key={j} className="rounded-sm border border-line-100 bg-surface-0 p-3">
                <Skeleton className="mb-2 h-3.5 w-full" />
                <Skeleton className="mb-2 h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Marca: apertura azul + wordmark en Sora 700, siempre en minúsculas, ".ai" en acento.
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label="pemie.ai">
      <defs>
        <mask id="pemie-aperture">
          <rect width="72" height="72" fill="#fff" />
          <circle cx="47" cy="25" r="20" fill="#000" />
        </mask>
      </defs>
      <circle cx="36" cy="36" r="28" fill="var(--blue-600)" mask="url(#pemie-aperture)" />
      <circle cx="49" cy="23" r="6" fill="var(--blue-600)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="text-[19px] font-bold tracking-[-0.02em] text-ink-900">
      pemie<span className="text-blue-600">.ai</span>
    </span>
  );
}

/* -------------------------------- MarkdownBody ------------------------------- */

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: ReactNode } };
  return el.props ? textOf(el.props.children) : "";
}

/**
 * Renderiza markdown de contenido que no escribimos nosotros: informes y notas los
 * publica un agente por MCP. Sin `rehype-raw` a propósito — el default de
 * react-markdown no interpreta HTML crudo, así que un `<script>` en un informe sale
 * como texto. Las imágenes también quedan fuera (origen no confiable y saltos de
 * layout).
 *
 * La escala vive entre el cuerpo de la tarjeta (`text-body-sm`) y su título
 * (`text-h4`): un `##` del informe nunca compite con el encabezado de la sección.
 * El peso y el tamaño se declaran explícitos porque el base global pone `font-bold`
 * a todo `h1`–`h4` (index.css).
 */
export function MarkdownBody({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div
      className={`text-body-sm leading-relaxed text-ink-800 [&>*+*]:mt-3 [&>h1+*]:mt-2 [&>h2+*]:mt-2 [&>h3+*]:mt-2 [&>*:first-child]:mt-0 ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h4 className="mt-4 text-body font-semibold text-ink-900">{children}</h4>,
          h2: ({ children }) => <h5 className="mt-4 text-body font-semibold text-ink-900">{children}</h5>,
          h3: ({ children }) => <h6 className="mt-4 text-body-sm font-semibold text-ink-900">{children}</h6>,
          h4: ({ children }) => <h6 className="mt-4 text-body-sm font-semibold text-ink-900">{children}</h6>,
          h5: ({ children }) => <h6 className="mt-4 text-body-sm font-semibold text-ink-900">{children}</h6>,
          h6: ({ children }) => <h6 className="mt-4 text-body-sm font-semibold text-ink-900">{children}</h6>,
          p: ({ children }) => <p className="text-body-sm leading-relaxed text-ink-800">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
          hr: () => <hr className="border-line-200" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-line-200 pl-3 text-ink-600">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {children}
            </a>
          ),
          // Las imágenes no se renderizan: el contenido es de origen no confiable.
          img: () => null,
          code: ({ children }) => (
            <code className="rounded-sm border border-line-200 bg-surface-100 px-1 font-mono text-caption text-ink-900">
              {children}
            </code>
          ),
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children;
            const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
            const lang = /language-(\w+)/.exec(cls)?.[1];
            return (
              <CodeBlock title={lang ?? "code"}>
                {textOf(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-line-200 px-2.5 py-1.5 text-left font-semibold text-ink-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-line-200 px-2.5 py-1.5 align-top">{children}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
