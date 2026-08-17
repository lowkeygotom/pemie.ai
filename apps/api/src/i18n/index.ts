// Traducción de catálogos backend (errores, y en B5 descripciones MCP). Nunca
// lanza: una clave ausente en ambos idiomas no puede tumbar una respuesta ni
// dejar un JSON-RPC en `undefined`.

import { isProd } from "../env.js";

export type CatalogEntry<Params> = string | ((params?: Params) => string);
export type Catalog<Params> = Record<string, CatalogEntry<Params>>;
export type Catalogs<Params> = Record<string, Catalog<Params>>;

/**
 * Resuelve `key` en `locale`, con fallback de 3 pasos: locale pedido → "es" →
 * la clave cruda (con warning en dev). Así ni la web ni el JSON-RPC ven un
 * `undefined` si una clave se desincroniza entre catálogos.
 */
export function translate<Params>(
  catalogs: Catalogs<Params>,
  locale: string,
  key: string,
  params?: Params
): string {
  const entry = catalogs[locale]?.[key] ?? catalogs.es?.[key];

  if (entry === undefined) {
    if (!isProd) console.warn(`[i18n] clave sin traducción en ningún catálogo: "${key}"`);
    return key;
  }

  return typeof entry === "function" ? entry(params) : entry;
}
