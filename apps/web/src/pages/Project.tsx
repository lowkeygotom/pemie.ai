import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, type Project as Prj } from "../lib/api.js";
import { Badge, Card, PageHeader, Spinner, Tabs } from "../components/ui.js";
import OverviewTab from "./project/OverviewTab.js";
import LiveActivityStrip from "./project/LiveActivityStrip.js";
import CommitsTab from "./project/CommitsTab.js";
import ReportsTab from "./project/ReportsTab.js";
import StoriesTab from "./project/StoriesTab.js";
import BoardTab from "./project/BoardTab.js";
import AgentTab from "./project/AgentTab.js";
import LeaderboardTab from "./project/LeaderboardTab.js";
import ContributorsTab from "./project/ContributorsTab.js";
import ProjectSearch from "./project/ProjectSearch.js";
// El `id` viaja en la URL (`?tab=`), así que es parte del contrato de un enlace
// compartido y nunca se traduce; solo la etiqueta sale del catálogo.
const TAB_IDS = [
  "overview",
  "commits",
  "reports",
  "stories",
  "board",
  "leaderboard",
  "activity",
  "team",
] as const;

type TabId = (typeof TAB_IDS)[number];

const TAB_LABEL_KEYS: Record<TabId, string> = {
  overview: "tabOverview",
  commits: "tabCommits",
  reports: "tabReports",
  stories: "tabStories",
  board: "tabBoard",
  leaderboard: "tabLeaderboard",
  activity: "tabActivity",
  team: "tabTeam",
};

function isTabId(value: string | null): value is TabId {
  return TAB_IDS.some((id) => id === value);
}

export default function Project() {
  const { t } = useTranslation("project");
  const { slug = "", projectSlug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState<Prj | null>(null);
  const [error, setError] = useState<string | null>(null);

  // El tab viaja en la URL (`?tab=`) para que un enlace pueda aterrizar en una
  // vista concreta del proyecto (PEM-38: el correo de asignación enlaza a una HU).
  // Con `?story=` y sin `tab` válido se asume `stories`: es el único tab con deep link.
  const requestedTab = searchParams.get("tab");
  const tab: TabId = isTabId(requestedTab)
    ? requestedTab
    : searchParams.get("story")
      ? "stories"
      : "overview";

  // `replace`, no `push`: esta tab bar es la navegación principal del proyecto y
  // una entrada de historial por clic llenaría el "atrás". La URL queda
  // compartible sin ese costo. `story` solo aplica al tab de historias.
  function selectTab(nextTab: TabId) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    if (nextTab !== "stories") next.delete("story");
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    api.projects
      .get(slug, projectSlug)
      .then((r) => setProject(r.project))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t("projectLoadError"))
      );
  }, [slug, projectSlug, t]);

  if (error) return <Card className="text-red-600">{error}</Card>;
  if (!project) return <Spinner />;

  return (
    <div>
      <Link to={`/w/${slug}`} className="mb-1 block text-body-sm text-ink-400 hover:text-ink-700">
        ← {project.workspace.name}
      </Link>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <>
            <ProjectSearch ws={slug} proj={projectSlug} onNavigateToTab={selectTab} />
            <LiveActivityStrip ws={slug} proj={projectSlug} />
            <Badge tone="neutral" mono>{project.key}</Badge>
          </>
        }
      />

      <Tabs
        items={TAB_IDS.map((id) => ({ id, label: t(TAB_LABEL_KEYS[id]) }))}
        value={tab}
        onChange={(id) => selectTab(id as TabId)}
        className="mb-6"
      />

      {tab === "overview" && <OverviewTab ws={slug} proj={projectSlug} />}
      {tab === "commits" && <CommitsTab ws={slug} proj={projectSlug} project={project} />}
      {tab === "reports" && <ReportsTab ws={slug} proj={projectSlug} />}
      {tab === "stories" && <StoriesTab ws={slug} proj={projectSlug} canManage={project.role === "owner" || project.role === "admin"} />}
      {tab === "board" && <BoardTab ws={slug} proj={projectSlug} canManage={project.role === "owner" || project.role === "admin"} />}
      {tab === "leaderboard" && <LeaderboardTab ws={slug} proj={projectSlug} />}
      {tab === "activity" && <AgentTab ws={slug} proj={projectSlug} />}
      {tab === "team" && <ContributorsTab ws={slug} proj={projectSlug} canManage={project.role === "owner" || project.role === "admin"} />}
    </div>
  );
}
