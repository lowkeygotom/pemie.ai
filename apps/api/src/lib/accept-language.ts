// Parser puro de `Accept-Language`, sin lógica de negocio: el borde REST/MCP
// lo usa para resolver el locale de peticiones anónimas o pre-auth.

const SUPPORTED_LOCALES = ["es", "en"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Devuelve el locale soportado de mayor prioridad en `header` (RFC 4647
 * lookup simplificado a nuestros dos locales), o `null` si no hay match.
 * Ignora subtags de región (`en-US` → `en`) y quality values inválidos.
 */
export function parseAcceptLanguage(header: string | undefined | null): SupportedLocale | null {
  if (!header) return null;

  const tags = header
    .split(",")
    .map((part) => {
      const [rawTag, rawQ] = part.trim().split(";q=");
      const lang = rawTag?.trim().toLowerCase().split("-")[0];
      const quality = rawQ ? Number(rawQ) : 1;
      return { lang, quality: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((t): t is { lang: string; quality: number } => Boolean(t.lang))
    .sort((a, b) => b.quality - a.quality);

  for (const { lang } of tags) {
    if (isSupportedLocale(lang)) return lang;
  }
  return null;
}
