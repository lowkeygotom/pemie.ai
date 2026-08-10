// Regla única de correlación commit ↔ Historia de Usuario (PEM-22).
//
// La consumen `stories.opGetStoryCommitProgress` (avance por HU) y
// `drift.opDetectDrift` (alertas de desalineación). Vive acá y no en uno de
// esos servicios porque dos definiciones de "este commit es de esta HU" se
// separan con el tiempo, y entonces la misma HU muestra un avance en Stories y
// otro en las alertas.

import { Prisma } from "@prisma/client";

/**
 * ¿El commit pertenece a la HU? Solo cuenta el **asunto** del commit —su primera
 * línea—, no el cuerpo.
 *
 * El cuerpo es prosa: ahí las keys aparecen como referencias cruzadas
 * («ese dato va como cobertura agregada (PEM-46)») o como texto de ejemplo
 * («un enlace truncado ?tab=bogus&story=PEM-40»). Contarlas como avance
 * marcaba HUs que nadie había tocado, y una alerta que se equivoca se deja de
 * mirar. El asunto, en cambio, es donde conventional commits pone la key de lo
 * que el commit efectivamente hace.
 *
 * El match va por regex y no por `contains`: como substring, «PEM-1» también
 * aparece dentro de «PEM-19», así que cada HU de un dígito se quedaba con el
 * avance de todas sus vecinas de dos. `\y` es la frontera de palabra de
 * Postgres — exige que la key termine donde termina su número, y deja pasar
 * paréntesis, dos puntos o fin de línea alrededor. `~*` hace el match sin
 * distinguir mayúsculas.
 *
 * @param messageExpr expresión SQL del mensaje completo del commit
 * @param keyExpr     expresión SQL (o parámetro) con la key de la HU
 */
export function commitSubjectMatchesKey(
  messageExpr: Prisma.Sql,
  keyExpr: Prisma.Sql
): Prisma.Sql {
  // Las barras van dobles a propósito: esto es un template literal de JS, así que
  // `\n` se convertiría en un salto de línea real y `\y` perdería la barra y
  // quedaría en una `y` suelta — el patrón dejaría de exigir frontera de palabra
  // y no matchearía nada. Lo que tiene que llegar a Postgres son los dos
  // caracteres `\n` y `\y`, no sus versiones interpretadas por JS.
  return Prisma.sql`split_part(${messageExpr}, E'\\n', 1) ~* ('\\y' || ${keyExpr} || '\\y')`;
}
