// Tipado contra `es`: el compilador exige que todas sus claves tengan traducción.

import type { McpDescParams } from "./es.js";
import { es } from "./es.js";

export const en: Record<keyof typeof es, string | ((params?: McpDescParams) => string)> = {
  project_id_prop: "Project ID. Required with workspace or user keys.",
  workspace_id_prop:
    "Workspace ID. Required with user keys; omit if the key already pins a project or workspace.",

  tool_list_workspaces:
    "Lists workspaces accessible with this API key. Useful with workspace/user keys before list_projects.",
  tool_list_projects:
    "Lists projects accessible with this API key. With broad keys, pass the resulting projectId to the other tools.",
  tool_list_projects_workspace_id: "Filter by workspace (optional)",
  tool_get_project_context: "Objective, stats, WIP, drift, and latest report for the project.",
  tool_get_project_drift:
    "Alerts where the board doesn't match commit evidence: unreported work (a story with commits but not started) and stalled WIP.",
  tool_get_project_drift_stale_days:
    "Days without commit evidence after which a WIP item is considered stalled (default 14).",
  tool_get_project_drift_coverage_threshold:
    "Minimum coverage of commits tagged with a story key (0-1) needed to trust absence alerts (stalled_wip). Below this, those alerts are suppressed (default 0.5).",
  tool_get_project_leaderboard: "Ranking of closed stories by actor (person or agent) in the project.",
  tool_get_agent_reliability:
    "Share of agent moves and assignments that a person didn't undo. The calculation lives in the domain service: same shape as REST.",
  tool_get_agent_reliability_window_days:
    "Days back of agent actions included in the calculation (default 30).",
  tool_get_agent_reliability_settle_hours:
    "Settling hours: excludes actions too recent to avoid inflating the score (default 2).",
  tool_report_activity:
    "Declares the agent's current work segment, or adds files to the open segment when summary is omitted.",
  tool_report_activity_summary: "Concrete summary of the current task (maximum 280 characters). Omit it to keep doing the same work and only add paths.",
  tool_report_activity_state: "working, blocked, or done (default working).",
  tool_report_activity_story_id: "ID of the User Story being worked on (optional). It must belong to the project.",
  tool_report_activity_card_id: "ID of the card being worked on (optional). It must belong to the project.",
  tool_report_activity_paths: "Paths of files or directories to edit (optional). A directory overlaps its child files.",
  tool_report_activity_interval_seconds: "Expected seconds between heartbeats (default 300); the segment stays active for three intervals, then idle up to the 8-hour ceiling.",
  tool_report_activity_model: "LLM model reporting the work (optional).",
  tool_list_agent_activity: "Lists live and historical agent work segments for the project.",
  tool_list_agent_activity_agent_id: "Filters by agent ID (optional).",
  tool_list_agent_activity_story_id: "Filters by User Story ID (optional).",
  tool_list_agent_activity_from: "ISO 8601: segments seen from this instant onward (inclusive).",
  tool_list_agent_activity_to: "ISO 8601: segments seen up to this instant (inclusive).",
  tool_list_commits: "Lists project commits (filterable by domain, contributor, and date range).",
  tool_list_commits_since: "ISO 8601 — commits from this date onward (inclusive).",
  tool_list_commits_until:
    "ISO 8601 — commits before this date (exclusive). For 'through day X inclusive', pass midnight UTC of the day after X.",
  tool_get_evaluation: "Latest progress reports for the project.",
  tool_publish_report: "Publishes (or updates) a progress report. Idempotent by date+slot.",
  tool_publish_report_date: "YYYY-MM-DD for scope 'day'",
  tool_list_notes: "Lists project notes/feedback (filterable by status).",
  tool_answer_note: "Answers a note and optionally links it to a report.",
  tool_get_objective: "Current project objective.",
  tool_update_objective: "Sets or updates the project objective (keeps history).",
  tool_list_user_stories:
    "Lists the project's User Stories (filterable by status/epic; type=story|epic filters by isEpic).",
  tool_list_user_stories_type: "Filters by isEpic: 'story' for regular stories only, 'epic' for epics only. Omit to get both.",
  tool_create_user_story:
    "Creates a User Story (role/want/benefit narrative + acceptance criteria). With isEpic=true, creates an epic instead of a regular story: no Kanban card, no storyPoints allowed.",
  tool_create_user_story_is_epic:
    "true to create an epic instead of a regular story. An epic can't have epicId or storyPoints.",
  tool_update_user_story:
    "Updates a User Story (title, status, priority, narrative…). isEpic converts story↔epic: story→epic only without its own epicId; epic→story only without child stories.",
  tool_update_user_story_is_epic:
    "Converts the story into an epic (true) or the epic back into a regular story (false). Rejects if it already has its own epic (going to epic) or has children (going back to story).",
  tool_assign_user_story:
    "Assigns (or unassigns, with assigneeId null) a story to a candidate from list_assignees (contributor or workspace member); syncs the linked Card.",
  tool_list_contributors: "Lists project contributors (candidates for assigning stories/cards).",
  tool_list_assignees:
    "Lists assignable candidates for the project: real contributors and workspace members without a contributor yet. Each candidate's `id` field is the value to pass to assign_user_story/update_card.",
  tool_list_board: "Returns the Kanban board with columns and cards.",
  tool_create_card: "Creates a card on the board (optionally linked to a story).",
  tool_move_card: "Moves a card to another column on the board.",
  tool_link_story_to_card: "Links an existing board card to a User Story that doesn't have one.",
  tool_get_story_commit_progress:
    "Counts and lists project commits whose message references a story's key (e.g. PRJ-123).",
  tool_search:
    "Searches text across the project's stories, commits, notes, cards, and brainstorming ideas or conclusions. Returns the type and id of each result so it can be acted on afterward.",
  tool_search_query: "Text to search for (minimum 2 characters).",
  tool_search_types: "Limits the search to these types; defaults to all allowed types.",
  tool_search_limit: "Maximum number of results (20 by default, 50 cap).",
  tool_list_brainstorms: "Lists the project's brainstorming sessions, optionally filtered by status.",
  tool_list_brainstorms_status: "Filters by session status (optional).",
  tool_get_brainstorm: "Returns a brainstorming session's details: minutes, speakers, nodes, citations, connections, and User Story proposals.",
  tool_get_brainstorm_session_id: "Brainstorming session ID.",
  tool_create_note: "Leaves a note or question on the project.",
  tool_get_user_story:
    "Detail for a single story by id, without listing all of the project's stories. If it's an epic, includes its children; otherwise, includes its parent epic.",
  tool_delete_user_story:
    "Deletes a story and its Kanban card. With keepCard=true the card is kept unlinked, with its activity intact. An epic with child stories can't be deleted.",
  tool_update_card:
    "Updates a card's title, description, type, assignee, or linked story. Omitting a field leaves it unchanged; sending null unlinks it.",
  tool_delete_card:
    "Deletes a board card along with its activity. The linked story isn't deleted: that's what delete_user_story is for.",
  tool_list_card_activities: "A card's activity (creation, moves, assignments) with the actor's name.",
  tool_list_skills: "Lists the skills published in the workspace (without their content).",
  tool_get_skill:
    "Returns a skill's installable package. If it's large, it includes downloadUrl/command (tar.gz); if small, files inline. The person decides the destination; don't assume it.",
  tool_publish_skill:
    'Step 1 of 2: creates an upload ticket (uploadUrl + command). Do NOT send files here — the content travels outside the tool call. Step 2: run the command in your shell (`COPYFILE_DISABLE=1 tar czf - -C <dir> <slug> | curl --upload-file - "$UPLOAD_URL"`). Idempotent by content hash.',
  tool_publish_skill_slug: "kebab-case, stable.",
  tool_delete_skill: "Deletes a skill from the workspace IRREVERSIBLY (hard delete). Confirm the slug with the person before calling it.",

  resource_project_context: "Objective, stats, and latest report.",
  resource_commits: "Project commits.",
  resource_reports: "Progress reports.",
  resource_notes: "Notes/feedback.",

  rpc_unknown_tool: (p) => `Unknown tool: ${p?.name}`,
  rpc_missing_permission: (p) => `The API key doesn't have the required permission: ${p?.permission}`,
  rpc_unknown_resource: (p) => `Unknown resource: ${p?.uri}`,
  rpc_unsupported_method: (p) => `Unsupported method: ${p?.method}`,
  rpc_sse_not_supported: "This MCP server doesn't offer SSE; use POST",
  rpc_unauthorized: "Unauthorized",
};
