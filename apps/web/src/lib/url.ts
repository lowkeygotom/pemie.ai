// Saneo de URLs de origen no confiable antes de pintarlas como `href`.

import { isSafeHttpUrl } from "@pemie/shared";

/**
 * Devuelve la URL solo si es http(s); `undefined` en cualquier otro caso, que
 * deja el enlace sin destino en vez de darle uno peligroso.
 *
 * React escapa el *contenido* de un elemento, no el esquema de un atributo: un
 * `href="javascript:…"` guardado en la base se ejecutaría en el origen de Pemie
 * con la sesión de quien haga clic. El backend ya rechaza esos valores al
 * guardarlos (linkRepoSchema); esto cubre los que entraron antes y cualquier
 * campo de URL que se sume después.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  return isSafeHttpUrl(raw) ? raw.trim() : undefined;
}
