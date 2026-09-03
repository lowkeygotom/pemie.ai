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
  "report_activity", "list_agent_activity",
  "list_skills", "get_skill", "publish_skill", "delete_skill",
  "list_brainstorms", "get_brainstorm",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Tipos de entidad que `search` puede consultar y el permiso que los habilita. */
export const SEARCHABLE_TYPES = ["story", "commit", "note", "card", "brainstorm"] as const;
export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export const SCOPE_BY_TYPE: Record<SearchableType, ApiScope> = {
  story: "stories:read",
  commit: "commits:read",
  note: "notes:read",
  card: "board:read",
  brainstorm: "brainstorm:read",
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
  | "Actividad de agentes"
  | "Skills del workspace"
  | "Brainstorming";

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
  list_user_stories: { access: { kind: "scope", scope: "stories:read" }, summary: "Historias de Usuario filtrables por estado, épica o tipo (isEpic).", group: "Historias de Usuario" },
  create_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "crea una HU con narrativa y criterios (isEpic=true crea una épica).", group: "Historias de Usuario" },
  update_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "actualiza título, estado, prioridad, narrativa o isEpic (convierte HU↔épica) de una HU.", group: "Historias de Usuario" },
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
  get_user_story: { access: { kind: "scope", scope: "stories:read" }, summary: "detalle de una sola HU por id (con sus hijas si es épica, o su épica padre si no).", group: "Historias de Usuario" },
  delete_user_story: { access: { kind: "scope", scope: "stories:write" }, summary: "elimina una HU y, salvo que se pida conservarla, su tarjeta del Kanban (una épica con hijas no se puede eliminar).", group: "Historias de Usuario" },
  update_card: { access: { kind: "scope", scope: "board:write" }, summary: "actualiza título, descripción, tipo, asignado o HU de una tarjeta.", group: "Kanban" },
  list_card_activities: { access: { kind: "scope", scope: "board:read" }, summary: "actividad de una tarjeta con el nombre del actor.", group: "Kanban" },
  delete_card: { access: { kind: "scope", scope: "board:write" }, summary: "elimina una tarjeta del tablero sin borrar su HU.", group: "Kanban" },
  get_project_leaderboard: { access: { kind: "scope", scope: "board:read" }, summary: "ranking de HUs cerradas por actor (persona o agente).", group: "Kanban" },
  get_agent_reliability: { access: { kind: "scope", scope: "board:read" }, summary: "proporción de movimientos y asignaciones de agente que una persona no deshizo.", group: "Kanban" },
  report_activity: { access: { kind: "scope", scope: "board:write" }, summary: "declara el tramo de trabajo actual y avisa si pisa HU, tarjeta o paths de otro agente.", group: "Actividad de agentes" },
  list_agent_activity: { access: { kind: "scope", scope: "board:read" }, summary: "actividad viva e histórica de agentes, filtrable por agente, HU y rango.", group: "Actividad de agentes" },
  list_skills: { access: { kind: "scope", scope: "skills:read" }, summary: "skills publicadas en el workspace.", group: "Skills del workspace" },
  get_skill: { access: { kind: "scope", scope: "skills:read" }, summary: "paquete instalable de una skill (inline o downloadUrl según tamaño).", group: "Skills del workspace" },
  publish_skill: { access: { kind: "scope", scope: "skills:write" }, summary: "crea un ticket de upload; el contenido viaja por tar|curl, no en el tool call.", group: "Skills del workspace" },
  delete_skill: { access: { kind: "scope", scope: "skills:write" }, summary: "borra una skill del workspace (irreversible).", group: "Skills del workspace" },
  list_brainstorms: { access: { kind: "scope", scope: "brainstorm:read" }, summary: "sesiones de brainstorming del proyecto, filtrables por estado.", group: "Brainstorming" },
  get_brainstorm: { access: { kind: "scope", scope: "brainstorm:read" }, summary: "detalle de una sesión: acta, participantes, ideas, conclusiones y propuestas.", group: "Brainstorming" },
};

/** Traducción operativa de las descripciones: mantiene los nombres de tools y parámetros. */
const MCP_TOOL_SUMMARIES_EN: Record<McpToolName, string> = {
  list_workspaces: "workspaces accessible with your key.",
  list_projects: "accessible projects (optionally filter by workspaceId).",
  get_project_context: "objective, stats, WIP, drift, and latest report.",
  get_project_drift: "alerts where the board does not match commit evidence.",
  list_commits: "project commits (filterable by domain or contributor).",
  get_evaluation: "latest progress reports.",
  publish_report: "publishes or updates a report (idempotent by date+slot).",
  list_notes: "project notes (filterable by status).",
  answer_note: "answers a note and can optionally link it to a report.",
  get_objective: "reads the objective and its history.",
  update_objective: "sets the objective and stores its history.",
  list_user_stories: "User Stories filterable by status, epic, or type (isEpic).",
  create_user_story: "creates a User Story with narrative and criteria (isEpic=true creates an epic).",
  update_user_story: "updates a User Story's title, status, priority, narrative, or isEpic (converts story↔epic).",
  assign_user_story: "assigns or unassigns a User Story and syncs its card.",
  list_contributors: "project contributors for assigning User Stories or cards.",
  list_assignees: "assignable candidates: contributors plus workspace members without commits yet.",
  list_board: "Kanban board with columns and cards.",
  create_card: "creates a card, optionally linked to a User Story.",
  move_card: "moves a card between columns.",
  link_story_to_card: "links an existing card to a User Story.",
  get_story_commit_progress: "commits that reference a User Story key.",
  search: "searches User Stories, commits, notes, and cards according to your permissions.",
  create_note: "leaves a note or question in the project.",
  get_user_story: "details for one User Story by id (with its children if it's an epic, or its parent epic if not).",
  delete_user_story: "deletes a User Story and, unless requested otherwise, its Kanban card (an epic with children can't be deleted).",
  update_card: "updates a card's title, description, type, assignee, or User Story.",
  list_card_activities: "a card's activity with the actor's name.",
  delete_card: "deletes a board card without deleting its User Story.",
  get_project_leaderboard: "ranking of closed User Stories by actor (person or agent).",
  get_agent_reliability: "share of agent moves and assignments that a person did not undo.",
  report_activity: "reports the current work segment and warns about overlapping stories, cards, or paths.",
  list_agent_activity: "live and historical agent activity, filterable by agent, story, and range.",
  list_skills: "skills published in the workspace.",
  get_skill: "an installable skill package (inline or downloadUrl depending on size).",
  publish_skill: "creates an upload ticket; content travels through tar|curl, not in the tool call.",
  delete_skill: "deletes a workspace skill (irreversible).",
  list_brainstorms: "brainstorming sessions for the project, filterable by status.",
  get_brainstorm: "details for one session: minutes, participants, ideas, conclusions, and proposals.",
};

export function isToolAvailable(access: ToolAccess, scopes: readonly ApiScope[]): boolean {
  switch (access.kind) {
    case "public": return true;
    case "scope": return scopes.includes(access.scope);
    case "anyOf": return access.scopes.some((scope) => scopes.includes(scope));
  }
}

/** Texto humano consistente para una denegación y la vista previa de capacidades. */
export function describeToolAccess(access: ToolAccess, locale?: string): string {
  if (access.kind === "scope") return access.scope;
  if (access.kind === "anyOf") {
    return locale === "en" ? `one of: ${access.scopes.join(", ")}` : `uno de: ${access.scopes.join(", ")}`;
  }
  return locale === "en" ? "no additional permission" : "sin permiso adicional";
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

export type AgentPromptLocale = "es" | "en";

/** Renderizador de dominio compartido: prompt, contador y exclusiones salen del mismo cálculo. */
export function buildAgentPrompt(input: {
  /** Ausente en las keys personales: no pertenecen a ningún workspace. */
  workspaceSlug?: string;
  target: PromptTarget;
  scopes: readonly ApiScope[];
  keyRef: KeyRef;
  mcpUrl: string;
  /** Preferencia personal del dueño de la key, no del workspace. */
  locale?: AgentPromptLocale;
}): AgentPrompt {
  const locale = input.locale ?? "es";
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
  const groupName = (group: ToolGroup) => locale === "en" ? ({
    "Descubrimiento": "Discovery", "Contexto y commits": "Context and commits",
    "Objetivo e informes": "Objective and reports", "Notas": "Notes",
    "Historias de Usuario": "User stories", "Kanban": "Kanban", "Actividad de agentes": "Agent activity", "Skills del workspace": "Workspace skills", "Brainstorming": "Brainstorming",
  } as const)[group] : group;
  const toolsSection = [...byGroup]
    .map(([group, tools]) => `${groupName(group)}:\n${tools.map((tool) => `- ${tool} — ${locale === "en" ? MCP_TOOL_SUMMARIES_EN[tool] : MCP_TOOLS[tool].summary}`).join("\n")}`)
    .join("\n\n");
  const scopeInstructions = input.target.scopeLevel === "project"
    ? locale === "en"
      ? `## Scope\nYour key is pinned to project "${input.target.project.slug}" (id ${input.target.project.id}). Project tools do not take a projectId parameter; the server applies it itself. If you send a different value anyway, it returns 403. Skill tools use the pinned project's workspace.`
      : `## Alcance\nTu key está fijada al proyecto "${input.target.project.slug}" (id ${input.target.project.id}). Las herramientas de proyecto no tienen el parámetro projectId; el servidor lo aplica solo. Si lo mandas de todos modos con otro valor, responde 403. Las tools de skills usan el workspace del proyecto fijado.`
    : locale === "en"
      ? `## API key scope (${input.target.scopeLevel})\nYour key is not pinned to one project. Before operating, call list_workspaces and/or list_projects to discover IDs and pass projectId in EVERY project tool (and workspaceId in skill tools).${input.target.referenceProject ? `\nReference project when this key was generated: "${input.target.referenceProject.slug}" (id ${input.target.referenceProject.id}).` : ""}`
      : `## Alcance de tu API key (${input.target.scopeLevel})\nTu key no está fijada a un solo proyecto. Antes de operar, llama a list_workspaces y/o list_projects para descubrir IDs y pasa projectId en CADA tool de proyecto (y workspaceId en las de skills).${input.target.referenceProject ? `\nProyecto de referencia al generar esta key: "${input.target.referenceProject.slug}" (id ${input.target.referenceProject.id}).` : ""}`;

  // Una key personal no cuelga de ningún workspace: nombrar uno ahí sería mentir.
  const home = input.workspaceSlug ? ` (workspace "${input.workspaceSlug}")` : "";

  return {
    included,
    excluded,
    text: locale === "en"
      ? `You are an agent connected to pemie.ai${home}.\nYour job is to monitor and document the team's progress: read commits, maintain the objective, publish reports, answer notes, and manage User Stories and the Kanban board.\n\n${scopeInstructions}\n\n## Connection (MCP · JSON-RPC 2.0 over HTTP)\n- Endpoint: ${input.mcpUrl}\n- Authentication: "Authorization: Bearer ${key}" header\n- Protocol: send POST with {"jsonrpc":"2.0","id":<n>,"method":<method>,"params":<object>}.\n- Discover tools with method "tools/list"; invoke them with method "tools/call" and params {"name":"<tool>","arguments":{...}}.\n- Everything you do is audited and limited by your API key scopes.\n\n## Available tools\n${toolsSection}\n\n## How to operate\n1. Respect the tool catalog you receive: it is already filtered for this key.\n2. Use list_* to read the real state before creating or changing anything.\n3. Be idempotent: publish_report already is by date+slot; avoid duplicating User Stories or cards.\n4. When writing reports, ground them in list_commits and get_story_commit_progress; do not invent facts.\n5. If an action fails due to scope or role, say what is missing instead of blindly retrying.\n6. Before resolving a task, check list_skills: a workspace skill may already cover what you are about to do. To publish: publish_skill (without files) → run the ticket command (tar|curl). To install: get_skill → if there is a downloadUrl/command, download the tar; if there are inline files, write them under install.rootPath. Ask the person for the destination (project or user) — never assume it. delete_skill is irreversible: confirm the slug with the person first.`
      : `Eres un agente conectado a pemie.ai${home}.\nTu trabajo es monitorear y documentar el avance del equipo: leer commits, mantener el objetivo, publicar informes, responder notas y gestionar Historias de Usuario y el tablero Kanban.\n\n${scopeInstructions}\n\n## Conexión (MCP · JSON-RPC 2.0 sobre HTTP)\n- Endpoint: ${input.mcpUrl}\n- Autenticación: cabecera "Authorization: Bearer ${key}"\n- Protocolo: envía POST con {"jsonrpc":"2.0","id":<n>,"method":<método>,"params":<obj>}.\n- Descubre las herramientas con method "tools/list"; invócalas con method "tools/call" y params {"name":"<tool>","arguments":{...}}.\n- Todo lo que haces queda auditado y está limitado por los scopes de tu API key.\n\n## Herramientas disponibles\n${toolsSection}\n\n## Cómo operar\n1. Respeta el catálogo de tools que recibes: ya está filtrado por esta key.\n2. Usa list_* para leer el estado real antes de crear o modificar nada.\n3. Sé idempotente: publish_report ya lo es por fecha+slot; evita duplicar HUs o tarjetas.\n4. Al escribir informes, fundaméntalos en list_commits y get_story_commit_progress, no inventes.\n5. Si una acción falla por scope o rol, informa qué falta en vez de reintentar a ciegas.\n6. Antes de resolver una tarea, revisa list_skills: puede haber una skill del workspace que ya cubra lo que vas a hacer. Para publicar: publish_skill (sin files) → ejecuta el command del ticket (tar|curl). Para instalar: get_skill → si hay downloadUrl/command, baja el tar; si hay files inline, escríbelos bajo install.rootPath. Pregunta a la persona el destino (project o user) — nunca lo asumas. delete_skill es irreversible: confirma el slug con la persona antes.`,
  };
}
