// Servicio F7: vista de estado del proyecto (PEM-45). Agrega en un solo golpe
// lo que antes componía el handler MCP de get_project_context: objetivo,
// stats, último informe, WIP por columna y ahora también drift (PEM-50).
// Único punto de verdad para REST (OverviewTab) y MCP (get_project_context).

import type { DriftReport, WipColumn } from "@pemie/shared";
import * as board from "./board.js";
import * as drift from "./drift.js";
import * as reports from "./reports.js";
import * as stats from "./stats.js";
import { projectWithAccess } from "./ingest.js";

export interface ProjectOverview {
  projectId: string;
  objective: Awaited<ReturnType<typeof reports.opGetObjective>>;
  stats: Awaited<ReturnType<typeof stats.opProjectStats>>;
  latestReport: Awaited<ReturnType<typeof reports.opListReports>>[number] | null;
  wip: WipColumn[];
  drift: DriftReport<Date>;
}

/** Vista de estado del proyecto (viewer+). */
export async function projectOverview(userId: string, projectId: string): Promise<ProjectOverview> {
  await projectWithAccess(userId, projectId);
  return opProjectOverview(projectId);
}

/** Operación (ya autorizada): compone el resumen a partir de los servicios ya existentes. */
export async function opProjectOverview(projectId: string): Promise<ProjectOverview> {
  const [objective, projectStats, latestReports, projectBoard, driftReport] = await Promise.all([
    reports.opGetObjective(projectId),
    stats.opProjectStats(projectId),
    reports.opListReports(projectId, { limit: 1 }),
    board.opListBoard(projectId),
    drift.opDetectDrift(projectId),
  ]);

  const wip: WipColumn[] = (projectBoard?.columns ?? []).map((col) => ({
    name: col.name,
    order: col.order,
    cardCount: col.cards.length,
  }));

  return {
    projectId,
    objective,
    stats: projectStats,
    latestReport: latestReports[0] ?? null,
    wip,
    drift: driftReport,
  };
}
