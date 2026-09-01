/** @type {import('tailwindcss').Config} */
// El tema refleja los tokens del design system de pemie.ai (src/styles/tokens/).
// Las utilidades apuntan a las CSS vars: los tokens siguen siendo la fuente de verdad.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Pasos intermedios que faltan en la escala default de Tailwind (solo trae
      // .5/1.5/2.5/3.5): la landing los usa para calzar el spacing del mockup
      // original sin caer en px sueltos.
      spacing: {
        "4.5": "1.125rem",
        "5.5": "1.375rem",
      },
      colors: {
        ink: {
          900: "var(--ink-900)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
          600: "var(--ink-600)",
          500: "var(--ink-500)",
          400: "var(--ink-400)",
          300: "var(--ink-300)",
        },
        surface: {
          0: "var(--surface-0)",
          50: "var(--surface-50)",
          100: "var(--surface-100)",
        },
        line: {
          200: "var(--line-200)",
          100: "var(--line-100)",
        },
        blue: {
          700: "var(--blue-700)",
          600: "var(--blue-600)",
          500: "var(--blue-500)",
          300: "var(--blue-300)",
          100: "var(--blue-100)",
        },
        // `green-700` expone el token --text-success: el verde legible para texto de
        // éxito sobre superficies claras (el 600 es el acento/swatch, no está pensado para texto).
        green: { 700: "var(--text-success)", 600: "var(--green-600)", 100: "var(--green-100)" },
        // `amber-700` expone el token --text-warning: el ámbar legible para texto de
        // aviso sobre superficies claras (el 600 es el acento/swatch, no está pensado para texto).
        amber: { 700: "var(--text-warning)", 600: "var(--amber-600)", 100: "var(--amber-100)" },
        // `red-700` expone el token --text-danger: el rojo legible para texto sobre
        // superficies claras (el 600 es el acento, sin contraste suficiente para leer).
        red: { 700: "var(--text-danger)", 600: "var(--red-600)", 100: "var(--red-100)" },
        // Épicas (PEM-57): acento propio del design system, no un semantic de estado
        // (success/warning/danger) — mismo patrón de 3 shades que "blue" (700 texto,
        // 600 acento/dot, 100 fondo del chip), calibrado a la misma luminosidad/croma
        // relativa que green/amber/red (oklch ~L0.62 C0.14-0.16, hue ~300).
        violet: { 700: "var(--violet-700)", 600: "var(--violet-600)", 100: "var(--violet-100)" },

        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-tint": "var(--accent-tint)",

        // On-ink: texto/superficies sobre secciones invertidas (hero, MCP, CTA final).
        "surface-ink": "var(--surface-ink)",
        "surface-ink-deep": "var(--surface-ink-deep)",
        "line-onink": "var(--line-onink)",
        "on-ink": "var(--text-on-ink)",
        "on-ink-soft": "var(--text-on-ink-soft)",
        "on-ink-muted": "var(--text-on-ink-muted)",
        "on-ink-code": "var(--text-on-ink-code)",
        "accent-onink": "var(--accent-on-ink)",
        "code-string": "var(--code-string)",
      },
      fontFamily: {
        sans: ["Sora", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        hero: ["var(--fs-hero)", { lineHeight: "0.95", letterSpacing: "var(--ls-hero)" }],
        display: ["var(--fs-display)", { lineHeight: "1.02", letterSpacing: "-0.03em" }],
        h1: ["var(--fs-h1)", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        h2: ["var(--fs-h2)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        h3: ["var(--fs-h3)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        h4: ["var(--fs-h4)", { lineHeight: "1.35", letterSpacing: "-0.02em" }],
        "body-lg": ["var(--fs-body-lg)", { lineHeight: "1.55" }],
        body: ["var(--fs-body)", { lineHeight: "1.55" }],
        "body-sm": ["var(--fs-body-sm)", { lineHeight: "1.55" }],
        caption: ["var(--fs-caption)", { lineHeight: "1.4" }],
        "mono-label": ["11px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        focus: "var(--shadow-focus)",
      },
      maxWidth: {
        container: "var(--container)",
        narrow: "var(--container-narrow)",
        focus: "var(--container-focus)",
      },
      transitionTimingFunction: {
        overshoot: "cubic-bezier(.34,1.56,.64,1)",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        letterIn: {
          "0%": { opacity: "0", transform: "translateY(80px) scale(0.85) rotate(8deg)" },
          "60%": { opacity: "1", transform: "translateY(-12px) scale(1.03) rotate(-3deg)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1) rotate(0deg)" },
        },
        caretBlink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.7s ease both",
        "letter-in": "letterIn 0.65s cubic-bezier(0.2,0.9,0.3,1.25) both",
        "caret-blink": "caretBlink 1.1s step-end infinite",
      },
    },
  },
  plugins: [],
};
