// Fuente de verdad de las claves de descripciones MCP (tools, campos de
// inputSchema y literales del transporte JSON-RPC). Texto copiado tal cual del
// `description` que tenía cada tool en `mcp/index.ts` (cero re-redacción);
// `en.ts` se tipa contra este archivo para que el compilador exija paridad.

export interface McpDescParams {
  name?: string;
  permission?: string;
  uri?: string;
  method?: string;
}

export const es = {
  // Props compartidas por casi todas las tools.
  project_id_prop: "ID del proyecto. Obligatorio con keys de workspace o usuario.",
  workspace_id_prop:
    "ID del workspace. Obligatorio con keys de usuario; omitible si la key ya fija proyecto o workspace.",

  // Descripciones de tools.
  tool_list_workspaces:
    "Lista workspaces accesibles con esta API key. Útil con keys workspace/user antes de list_projects.",
  tool_list_projects:
    "Lista proyectos accesibles con esta API key. Con keys amplias, pasa el projectId resultante a las demás tools.",
  tool_list_projects_workspace_id: "Filtrar por workspace (opcional)",
  tool_get_project_context: "Objetivo, stats, WIP, drift y último informe del proyecto.",
  tool_get_project_drift:
    "Alertas donde el tablero no coincide con la evidencia de commits: trabajo no reportado (HU sin arrancar con commits) y WIP estancado.",
  tool_get_project_drift_stale_days:
    "Días sin evidencia de commit tras los que un WIP se considera estancado (default 14).",
  tool_get_project_drift_coverage_threshold:
    "Cobertura mínima de commits tageados con key de HU (0-1) para confiar en alertas de ausencia (stalled_wip). Por debajo, se suprimen esas alertas (default 0.5).",
  tool_get_project_leaderboard: "Ranking de HUs cerradas por actor (persona o agente) en el proyecto.",
  tool_get_agent_reliability:
    "Proporción de movimientos y asignaciones de agente que una persona no deshizo. El cálculo vive en el servicio de dominio: misma forma que el REST.",
  tool_get_agent_reliability_window_days:
    "Días hacia atrás de acciones de agente que entran al cálculo (default 30).",
  tool_get_agent_reliability_settle_hours:
    "Horas de asentamiento: excluye acciones demasiado recientes para no inflar el score (default 2).",
  tool_report_activity:
    "Declara el tramo de trabajo actual del agente o agrega archivos al tramo abierto si omites summary.",
  tool_report_activity_summary: "Resumen concreto de la tarea actual (máximo 280 caracteres). Omítelo para seguir en lo mismo y solo agregar paths.",
  tool_report_activity_state: "working, blocked o done (default working).",
  tool_report_activity_story_id: "ID de la HU sobre la que trabajas (opcional). Debe pertenecer al proyecto.",
  tool_report_activity_card_id: "ID de la tarjeta sobre la que trabajas (opcional). Debe pertenecer al proyecto.",
  tool_report_activity_paths: "Paths de archivos o directorios que tocarás (opcional). Un directorio solapa sus archivos hijos.",
  tool_report_activity_interval_seconds: "Segundos entre latidos previstos (default 300); el tramo queda activo tres intervalos y luego idle hasta el techo de 8 horas.",
  tool_report_activity_model: "Modelo LLM que reporta el trabajo (opcional).",
  tool_list_agent_activity: "Lista tramos vivos e históricos de agentes del proyecto.",
  tool_list_agent_activity_agent_id: "Filtra por ID de agente (opcional).",
  tool_list_agent_activity_story_id: "Filtra por ID de HU (opcional).",
  tool_list_agent_activity_from: "ISO 8601: tramos vistos desde este instante (inclusive).",
  tool_list_agent_activity_to: "ISO 8601: tramos vistos hasta este instante (inclusive).",
  tool_list_commits: "Lista commits del proyecto (filtrable por dominio, contribuidor y rango de fecha).",
  tool_list_commits_since: "ISO 8601 — commits desde esta fecha (inclusive).",
  tool_list_commits_until:
    "ISO 8601 — commits antes de esta fecha (exclusive). Para 'hasta el día X inclusive', pasa la medianoche UTC del día siguiente a X.",
  tool_get_evaluation: "Últimos informes de avance del proyecto.",
  tool_publish_report: "Publica (o actualiza) un informe de avance. Idempotente por fecha+slot.",
  tool_publish_report_date: "YYYY-MM-DD para scope 'day'",
  tool_list_notes: "Lista notas/feedback del proyecto (filtrable por estado).",
  tool_answer_note: "Responde una nota y opcionalmente la asocia a un informe.",
  tool_get_objective: "Objetivo actual del proyecto.",
  tool_update_objective: "Fija o actualiza el objetivo del proyecto (guarda historial).",
  tool_list_user_stories:
    "Lista las Historias de Usuario del proyecto (filtrable por estado/épica; type=story|epic filtra por isEpic).",
  tool_list_user_stories_type: "Filtra por isEpic: 'story' solo HUs normales, 'epic' solo épicas. Omitido, trae ambas.",
  tool_create_user_story:
    "Crea una Historia de Usuario (narrativa role/want/benefit + criterios). Con isEpic=true crea una épica en vez de una HU normal: no genera tarjeta Kanban ni admite storyPoints.",
  tool_create_user_story_is_epic:
    "true para crear una épica en vez de una HU normal. Una épica no puede tener epicId ni storyPoints.",
  tool_update_user_story:
    "Actualiza una Historia de Usuario (título, estado, prioridad, narrativa…). isEpic convierte HU↔épica: normal→épica solo sin epicId propio; épica→normal solo sin HUs hijas.",
  tool_update_user_story_is_epic:
    "Convierte la HU en épica (true) o la épica en HU normal (false). Rechaza si ya tiene una épica propia (al pasar a épica) o si tiene hijas (al volver a normal).",
  tool_assign_user_story:
    "Asigna (o desasigna, con assigneeId null) una HU a un candidato de list_assignees (contributor o miembro del workspace); sincroniza la Card vinculada.",
  tool_list_contributors: "Lista los contribuidores del proyecto (candidatos a asignar HUs/tarjetas).",
  tool_list_assignees:
    "Lista candidatos asignables del proyecto: contributors reales y miembros del workspace sin contributor todavía. El campo `id` de cada candidato es el valor a pasar a assign_user_story/update_card.",
  tool_list_board: "Devuelve el tablero Kanban con columnas y tarjetas.",
  tool_create_card: "Crea una tarjeta en el tablero (opcionalmente ligada a una HU).",
  tool_move_card: "Mueve una tarjeta a otra columna del tablero.",
  tool_link_story_to_card: "Vincula una tarjeta existente del tablero a una Historia de Usuario sin tarjeta.",
  tool_get_story_commit_progress:
    "Cuenta y lista los commits del proyecto cuyo mensaje referencia la key de una HU (ej. PRJ-123).",
  tool_search:
    "Busca un texto en las HUs, commits, notas y tarjetas del proyecto. Devuelve el tipo y el id de cada resultado para poder operarlo después.",
  tool_search_query: "Texto a buscar (mínimo 2 caracteres).",
  tool_search_types: "Limita la búsqueda a estos tipos; por defecto, todos los permitidos.",
  tool_search_limit: "Máximo de resultados (20 por defecto, tope 50).",
  tool_create_note: "Deja una nota o pregunta en el proyecto.",
  tool_get_user_story:
    "Detalle de una sola HU por id, sin listar todas las del proyecto. Si es una épica, incluye sus hijas; si no, incluye su épica padre.",
  tool_delete_user_story:
    "Elimina una HU y su tarjeta del Kanban. Con keepCard=true la tarjeta se conserva desvinculada, con su actividad intacta. Una épica con HUs hijas no se puede eliminar.",
  tool_update_card:
    "Actualiza título, descripción, tipo, asignado o HU vinculada de una tarjeta. Omitir un campo lo deja igual; enviarlo en null lo desvincula.",
  tool_delete_card:
    "Elimina una tarjeta del tablero junto con su actividad. La HU vinculada no se borra: para eso está delete_user_story.",
  tool_list_card_activities:
    "Actividad de una tarjeta (creación, movimientos, asignaciones) con el nombre del actor.",
  tool_list_skills: "Lista las skills publicadas en el workspace (sin su contenido).",
  tool_get_skill:
    "Devuelve el paquete instalable de una skill. Si es grande, incluye downloadUrl/command (tar.gz); si es chica, files inline. El destino lo decide la persona; no lo asumas.",
  tool_publish_skill:
    'Paso 1 de 2: crea un ticket de upload (uploadUrl + command). NO envíes files aquí — el contenido viaja fuera del tool call. Paso 2: ejecutá el command en tu shell (`COPYFILE_DISABLE=1 tar czf - -C <dir> <slug> | curl --upload-file - "$UPLOAD_URL"`). Idempotente por hash de contenido.',
  tool_publish_skill_slug: "kebab-case, estable.",
  tool_delete_skill: "Borra una skill del workspace de forma IRREVERSIBLE (hard delete). Confirmá el slug con la persona antes de llamarla.",

  // Descripciones de resources.
  resource_project_context: "Objetivo, stats y último informe.",
  resource_commits: "Commits del proyecto.",
  resource_reports: "Informes de avance.",
  resource_notes: "Notas/feedback.",

  // Literales del transporte JSON-RPC (no pasan por ServiceError).
  rpc_unknown_tool: (p?: McpDescParams) => `Tool desconocida: ${p?.name}`,
  rpc_missing_permission: (p?: McpDescParams) => `La API key no tiene el permiso requerido: ${p?.permission}`,
  rpc_unknown_resource: (p?: McpDescParams) => `Resource desconocido: ${p?.uri}`,
  rpc_unsupported_method: (p?: McpDescParams) => `Método no soportado: ${p?.method}`,
  rpc_sse_not_supported: "Este servidor MCP no ofrece SSE; usa POST",
  rpc_unauthorized: "No autorizado",
} satisfies Record<string, string | ((params?: McpDescParams) => string)>;
