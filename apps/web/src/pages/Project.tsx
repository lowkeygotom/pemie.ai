import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, type Project as Prj } from "../lib/api.js";
import { Badge, Card, PageHeader, Spinner, Tabs } from "../components/ui.js";
import CommitsTab from "./project/CommitsTab.js";
import ReportsTab from "./project/ReportsTab.js";
import StoriesTab from "./project/StoriesTab.js";
import BoardTab from "./project/BoardTab.js";
import AgentTab from "./project/AgentTab.js";
import LeaderboardTab from "./project/LeaderboardTab.js";
import ProjectSearch from "./project/ProjectSearch.js";
const TABS = [
  { id: "commits", label: "Ingesta de commits" },
  { id: "reports", label: "Objetivo e informes" },
  { id: "stories", label: "Historias de usuario" },
  { id: "board", label: "Kanban" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "activity", label: "Actividad" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value);
}

export default function Project() {
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
      : "commits";

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
        setError(e instanceof ApiError ? e.message : "No se pudo cargar el proyecto")
      );
  }, [slug, projectSlug]);

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
            <Badge tone="neutral" mono>{project.key}</Badge>
          </>
        }
      />

      <Tabs
        items={[...TABS]}
        value={tab}
        onChange={(id) => selectTab(id as TabId)}
        className="mb-6"
      />

      {tab === "commits" && <CommitsTab ws={slug} proj={projectSlug} project={project} />}
      {tab === "reports" && <ReportsTab ws={slug} proj={projectSlug} />}
      {tab === "stories" && <StoriesTab ws={slug} proj={projectSlug} />}
      {tab === "board" && <BoardTab ws={slug} proj={projectSlug} />}
      {tab === "leaderboard" && <LeaderboardTab ws={slug} proj={projectSlug} />}
      {tab === "activity" && <AgentTab ws={slug} proj={projectSlug} />}
    </div>
  );
}
