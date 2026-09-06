/**
 * `reason` es el código crudo que devuelve `opRunExtraction` (brainstorm-extract.ts)
 * cuando una pasada de extracción falla. "locked" es una colisión transitoria entre
 * dos llamadas (se resuelve sola en la próxima ventana) y no se reporta como error.
 */
export function describeExtractionFailure(reason: string | undefined): string {
  if (reason === "anthropic_not_configured") return "Falta configurar la clave de Anthropic en el servidor: la extracción no puede correr.";
  if (reason === "anthropic_429") return "Se alcanzó el límite de uso (cuota) de la API de Anthropic: la extracción está pausada.";
  if (reason === "anthropic_401" || reason === "anthropic_403") return "La clave de Anthropic fue rechazada: la extracción no puede correr.";
  if (reason?.startsWith("anthropic_")) return "El servicio de Anthropic no respondió: se reintentará en la próxima ventana.";
  return "No se pudo extraer el grafo de esta ventana: se reintentará automáticamente.";
}
