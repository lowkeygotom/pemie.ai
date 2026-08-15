import type { ApiKeyScopeLevel, ApiScope } from "./index.js";

/** Nombres de las tools MCP: el mapa de abajo es total sobre esta lista. */
export const MCP_TOOL_NAMES = [
  "list_workspaces", "list_projects", "get_project_context", "get_project_drift", "list_commits",
  "get_evaluation",
  "publish_report", "list_notes", "answer_note", "get_objective", "update_objective",
  "list_user_stories", "create_user_story", "update_user_story", "assign_user_story",
  "list_contributors", "list_assignees", "list_board", "create_card", "move_card", "link_story_to_card",
  "get_story_commit_progress", "search", "create_note", "get_user_story", "delete_user_story",
  "update_card", "list_card_activities", "delete_card", "get_project_leaderboard",
  "get_agent_reliability",
  "list_skills", "get_skill", "publish_skill", "delete_skill",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Tipos de entidad que `search` puede consultar y el permiso que los habilita. */
export const SEARCHABLE_TYPES = ["story", "commit", "note", "card"] as const;
export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export const SCOPE_BY_TYPE: Record<SearchableType, ApiScope> = {
  story: "stories:read",
  commit: "commits:read",
  note: "notes:read",
  card: "board:read",
};

/** Cada tool debe declarar explícitamente cómo se autoriza; no hay `null` ambiguo. */
export type ToolAccess =
  | { kind: "public" }
  | { kind: "scope"; scope: ApiScope }
  | { kind: "anyOf"; scopes: readonly ApiScope[] };

export type ToolGroup =
  | "Descubrimiento"
  | "Contexto y commits"
  | "Objetivo e informes"
  | "Notas"
  | "Historias de Usuario"
  | "Kanban"
  | "Skills del workspace";

export interface McpToolMeta {
  access: ToolAccess;
  summary: string;
  group: ToolGroup;
}

/**
 * Fuente única de verdad para el acceso y el texto breve de las tools MCP.
 * `Record` total hace que una tool nueva sin metadatos no compile.
 */
export const MCP_TOOLS: Record<McpToolName, McpToolMeta> = {
  list_workspaces: { access: { kind: "public" }, summary: "workspaces accesibles con tu key.", group: "Descubrimiento" },
  list_projects: { access: { kind: "public" }, summary: "proyectos accesibles (opcional: filtrar por workspaceId).", group: "Descubrimiento" },
  get_project_context: { access: { kind: "scope", scope: "commits:read" }, summary: "objetivo, stats, WIP, drift y último informe.", group: "Contexto y commits" },
  get_project_drift: { access: { kind: "scope", scope: "stories:read" }, summary: "alertas donde el tablero no coincide con la evidencia de commits.", group: "Contexto y commits" },
  list_commits: { access: { kind: "scope", scope: "commits:read" }, summary: "commits del proyecto (filtrable por dominio o contribuidor).", group: "Contexto y commits" },
  get_evaluation: { access: { kind: "scope", scope: "reports:read" }, summary: "últimos informes de avance.", group: "Objetivo e informes" },
  publish_report: { access: { kind: "scope", scope: "reports:write" }, summary: "publica o actualiza un informe (idempotente por fecha+slot).", group: "Objetivo e informes" },
  list_notes: { access: { kind: "scope", scope: "notes:read" }, summary: "notas del proyecto (filtrable por estado).", group: "Notas" },
  answer_note: { access: { kind: "scope", scope: "notes:write" }, summary: "responde una nota y opcionalmente la liga a un informe.", group: "Notas" },
  get_objective: { access: { kind: "scope", scope: "objective:read" }, summary: "lee el objetivo y su historial.", group: "Objetivo e informes" },
  update_objective: { access: { kind: "scope", scope: "objective:write" }, summary: "fija el objetivo y guarda su historial.", group: "Objetivo e informes" },
  list_user_stories: { access: { kind: "scope", scope: "stories:read" }, summary: "Historias de Usuario filtrables por estado o épica.", group: "Historias de Usuario" },
  create_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "crea una HU con narrativa y criterios.", group: "Historias de Usuario" },
  update_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "actualiza título, estado, prioridad o narrativa de una HU.", group: "Historias de Usuario" },
  assign_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "asigna o desasigna una HU y sincroniza su tarjeta.", group: "Historias de Usuario" },
  list_contributors: { access: { kind: "scope", scope: "stories:read" }, summary: "contribuidores del proyecto para asignar HUs o tarjetas.", group: "Historias de Usuario" },
  list_assignees: { access: { kind: "scope", scope: "stories:read" }, summary: "candidatos asignables: contributors + miembros del workspace sin commits todavía.", group: "Historias de Usuario" },
  list_board: { access: { kind: "scope", scope: "board:read" }, summary: "tablero Kanban con columnas y tarjetas.", group: "Kanban" },
  create_card: { access: { kind: "scope", scope: "board:write" }, summary: "crea una tarjeta, opcionalmente ligada a una HU.", group: "Kanban" },
  move_card: { access: { kind: "scope", scope: "board:write" }, summary: "mueve una tarjeta de columna.", group: "Kanban" },
  link_story_to_card: { access: { kind: "scope", scope: "board:write" }, summary: "liga una tarjeta existente a una HU.", group: "Kanban" },
  get_story_commit_progress: { access: { kind: "scope", scope: "stories:read" }, summary: "commits que referencian la key de una HU.", group: "Contexto y commits" },
  search: { access: { kind: "anyOf", scopes: Object.values(SCOPE_BY_TYPE) }, summary: "busca HUs, commits, notas y tarjetas según tus permisos.", group: "Descubrimiento" },
  create_note: { access: { kind: "scope", scope: "notes:write" }, summary: "deja una nota o pregunta en el proyecto.", group: "Notas" },
  get_user_story: { access: { kind: "scope", scope: "stories:read" }, summary: "detalle de una sola HU por id.", group: "Historias de Usuario" },
  delete_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "elimina una HU y, salvo que se pida conservarla, su tarjeta del Kanban.", group: "Historias de Usuario" },
  update_card: { access: { kind: "scope", scope: "board:write" }, summary: "actualiza título, descripción, tipo, asignado o HU de una tarjeta.", group: "Kanban" },
  list_card_activities: { access: { kind: "scope", scope: "board:read" }, summary: "actividad de una tarjeta con el nombre del actor.", group: "Kanban" },
  delete_card: { access: { kind: "scope", scope: "board:write" }, summary: "elimina una tarjeta del tablero sin borrar su HU.", group: "Kanban" },
  get_project_leaderboard: { access: { kind: "scope", scope: "board:read" }, summary: "ranking de HUs cerradas por actor (persona o agente).", group: "Kanban" },
  get_agent_reliability: { access: { kind: "scope", scope: "board:read" }, summary: "proporción de movimientos y asignaciones de agente que una persona no deshizo.", group: "Kanban" },
  list_skills: { access: { kind: "scope", scope: "skills:read" }, summary: "skills publicadas en el workspace.", group: "Skills del workspace" },
  get_skill: { access: { kind: "scope", scope: "skills:read" }, summary: "paquete instalable de una skill (inline o downloadUrl según tamaño).", group: "Skills del workspace" },
  publish_skill: { access: { kind: "scope", scope: "skills:write" }, summary: "crea un ticket de upload; el contenido viaja por tar|curl, no en el tool call.", group: "Skills del workspace" },
  delete_skill: { access: { kind: "scope", scope: "skills:write" }, summary: "borra una skill del workspace (irreversible).", group: "Skills del workspace" },
};

export function isToolAvailable(access: ToolAccess, scopes: readonly ApiScope[]): boolean {
  switch (access.kind) {
    case "public": return true;
    case "scope": return scopes.includes(access.scope);
    case "anyOf": return access.scopes.some((scope) => scopes.includes(scope));
  }
}

/** Texto humano consistente para una denegación y la vista previa de capacidades. */
export function describeToolAccess(access: ToolAccess): string {
  if (access.kind === "scope") return access.scope;
  if (access.kind === "anyOf") return `uno de: ${access.scopes.join(", ")}`;
  return "sin permiso adicional";
}

/** La key real, su prefijo recuperable o un marcador explícitamente no secreto. */
export type KeyRef =
  | { kind: "plaintext"; key: string }
  | { kind: "prefix"; prefix: string }
  | { kind: "placeholder"; label: string };

export type PromptTarget =
  | { scopeLevel: "project"; project: { slug: string; id: string } }
  | { scopeLevel: Exclude<ApiKeyScopeLevel, "project">; referenceProject?: { slug: string; id: string } };

export interface AgentPrompt {
  text: string;
  included: McpToolName[];
  excluded: { tool: McpToolName; needs: ToolAccess }[];
}

/** Renderizador de dominio compartido: prompt, contador y exclusiones salen del mismo cálculo. */
export function buildAgentPrompt(input: {
  workspaceSlug: string;
  target: PromptTarget;
  scopes: readonly ApiScope[];
  keyRef: KeyRef;
  mcpUrl: string;
}): AgentPrompt {
  const included = MCP_TOOL_NAMES.filter((name) => isToolAvailable(MCP_TOOLS[name].access, input.scopes));
  const excluded = MCP_TOOL_NAMES.filter((name) => !included.includes(name)).map((tool) => ({
    tool,
    needs: MCP_TOOLS[tool].access,
  }));
  const key = input.keyRef.kind === "plaintext"
    ? input.keyRef.key
    : input.keyRef.kind === "prefix"
      ? `${input.keyRef.prefix}…`
      : input.keyRef.label;
  const byGroup = new Map<ToolGroup, McpToolName[]>();
  for (const tool of included) {
    const group = MCP_TOOLS[tool].group;
    byGroup.set(group, [...(byGroup.get(group) ?? []), tool]);
  }
  const toolsSection = [...byGroup]
    .map(([group, tools]) => `${group}:\n${tools.map((tool) => `- ${tool} — ${MCP_TOOLS[tool].summary}`).join("\n")}`)
    .join("\n\n");
  const scopeInstructions = input.target.scopeLevel === "project"
    ? `## Alcance\nTu key está fijada al proyecto "${input.target.project.slug}" (id ${input.target.project.id}). Las herramientas de proyecto no tienen el parámetro projectId; el servidor lo aplica solo. Si lo mandas de todos modos con otro valor, responde 403. Las tools de skills usan el workspace del proyecto fijado.`
    : `## Alcance de tu API key (${input.target.scopeLevel})\nTu key no está fijada a un solo proyecto. Antes de operar, llama a list_workspaces y/o list_projects para descubrir IDs y pasa projectId en CADA tool de proyecto (y workspaceId en las de skills).${input.target.referenceProject ? `\nProyecto de referencia al generar esta key: "${input.target.referenceProject.slug}" (id ${input.target.referenceProject.id}).` : ""}`;

  return {
    included,
    excluded,
    text: `Eres un agente conectado a pemie.ai (workspace "${input.workspaceSlug}").\nTu trabajo es monitorear y documentar el avance del equipo: leer commits, mantener el objetivo, publicar informes, responder notas y gestionar Historias de Usuario y el tablero Kanban.\n\n${scopeInstructions}\n\n## Conexión (MCP · JSON-RPC 2.0 sobre HTTP)\n- Endpoint: ${input.mcpUrl}\n- Autenticación: cabecera "Authorization: Bearer ${key}"\n- Protocolo: envía POST con {"jsonrpc":"2.0","id":<n>,"method":<método>,"params":<obj>}.\n- Descubre las herramientas con method "tools/list"; invócalas con method "tools/call" y params {"name":"<tool>","arguments":{...}}.\n- Todo lo que haces queda auditado y está limitado por los scopes de tu API key.\n\n## Herramientas disponibles\n${toolsSection}\n\n## Cómo operar\n1. Respeta el catálogo de tools que recibes: ya está filtrado por esta key.\n2. Usa list_* para leer el estado real antes de crear o modificar nada.\n3. Sé idempotente: publish_report ya lo es por fecha+slot; evita duplicar HUs o tarjetas.\n4. Al escribir informes, fundaméntalos en list_commits y get_story_commit_progress, no inventes.\n5. Si una acción falla por scope o rol, informa qué falta en vez de reintentar a ciegas.\n6. Antes de resolver una tarea, revisa list_skills: puede haber una skill del workspace que ya cubra lo que vas a hacer. Para publicar: publish_skill (sin files) → ejecuta el command del ticket (tar|curl). Para instalar: get_skill → si hay downloadUrl/command, baja el tar; si hay files inline, escríbelos bajo install.rootPath. Pregunta a la persona el destino (project o user) — nunca lo asumas. delete_skill es irreversible: confirma el slug con la persona antes.`,
  };
}
