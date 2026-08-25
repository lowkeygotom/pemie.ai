import i18n from "../i18n/index.js";

// Formato de fechas atado al idioma ELEGIDO en la app, no al del navegador.
//
// `toLocaleDateString()` sin argumentos usa el locale del navegador: una persona
// con Chrome en inglés y pemie en español veía fechas mezcladas dentro de la
// misma pantalla. Estas funciones leen `i18n.language`, así que el selector de
// idioma manda también sobre las fechas.
//
// Se lee `i18n.language` en cada llamada (y no una constante de módulo) porque
// el cambio de idioma no recarga la página: una constante quedaría congelada
// con el idioma del arranque.

/** Solo fecha: "16/8/2026" · "8/16/2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.language);
}

/** Fecha y hora, para sellos de auditoría y actividad. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(i18n.language);
}

/** Fecha corta con mes abreviado: "16 ago 2026" · "Aug 16, 2026". */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Igual que `formatDate`, pero tolera el ausente con un guion largo. */
export function formatDateOrDash(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : "—";
}

/** Tiempo relativo compacto para estados que cambian en vivo, respetando el idioma de Pemie. */
export function formatRelativeTime(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1_000);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = Math.abs(seconds) < 60
    ? [seconds, "second"]
    : Math.abs(seconds) < 3_600
      ? [Math.round(seconds / 60), "minute"]
      : Math.abs(seconds) < 86_400
        ? [Math.round(seconds / 3_600), "hour"]
        : [Math.round(seconds / 86_400), "day"];
  return new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(value, unit);
}
