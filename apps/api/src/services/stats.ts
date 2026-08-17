// Métricas de un proyecto derivadas de sus commits (F2). Feed de los informes
// (F3) y del contexto que consumirán los agentes por MCP (F4).

import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from "@pemie/shared";
import { prisma } from "../db.js";
import { notFound } from "./errors.js";
import { projectWithAccess } from "./ingest.js";

/**
 * Resumen de actividad de un proyecto: totales, distribución por dominio (con
 * las etiquetas de la config del proyecto) y ranking de contribuidores (viewer+).
 */
export async function projectStats(userId: string, projectId: string) {
  await projectWithAccess(userId, projectId);
  return opProjectStats(projectId);
}

/** Operación (ya autorizada): calcula las stats del proyecto. */
export async function opProjectStats(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("project_not_found");
  const config = (project.domainConfig as DomainConfig | null) ?? DEFAULT_DOMAIN_CONFIG;
  const labels = new Map(config.categories.map((cat) => [cat.key, cat]));

  const [total, byDomainRaw, byContributorRaw, repoCount] = await Promise.all([
    prisma.commit.count({ where: { projectId } }),
    prisma.commit.groupBy({
      by: ["domain"],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.commit.groupBy({
      by: ["contributorId"],
      where: { projectId },
      _count: { _all: true },
      orderBy: { _count: { contributorId: "desc" } },
      take: 20,
    }),
    prisma.repo.count({ where: { projectId } }),
  ]);

  const byDomain = byDomainRaw
    .map((d) => {
      const cat = labels.get(d.domain);
      return {
        key: d.domain,
        label: cat?.label ?? d.domain,
        emoji: cat?.emoji ?? null,
        primary: cat?.primary ?? false,
        count: d._count._all,
      };
    })
    .sort((a, b) => b.count - a.count);

  const contributorIds = byContributorRaw.map((c) => c.contributorId);
  const contributors = await prisma.contributor.findMany({
    where: { id: { in: contributorIds } },
    select: { id: true, githubLogin: true, name: true, avatarUrl: true },
  });
  const contributorById = new Map(contributors.map((c) => [c.id, c]));
  const byContributor = byContributorRaw.map((c) => ({
    contributor: contributorById.get(c.contributorId) ?? null,
    count: c._count._all,
  }));

  return {
    totalCommits: total,
    repoCount,
    byDomain,
    byContributor,
  };
}
