import i18n from "../../i18n/index.js";

// Saludo por franja horaria y sello de fecha del launchpad de workspaces.

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  return hour < 6 ? "earlyGreeting" : hour < 12 ? "morningGreeting" : hour < 20 ? "afternoonGreeting" : "eveningGreeting";
}

/** "DOM 2 AGO · 21:49" — armado a partir de partes para no depender de cómo el locale ordena la puntuación. */
export function stampFor(date: Date): string {
  const locale = i18n.language;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date).replace(/\./g, "");
  const day = new Intl.DateTimeFormat(locale, { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(date).replace(/\./g, "");
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${weekday} ${day} ${month} · ${time}`.toUpperCase();
}
