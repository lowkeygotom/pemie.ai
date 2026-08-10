import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SKILL_DESTINATIONS, SKILL_TARGETS, type SkillDestination, type SkillTarget } from "@pemie/shared";
import { api, ApiError, type SkillInstall } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Badge,
  Card,
  CodeBlock,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  Select,
  SkeletonList,
  Skeleton,
} from "../../components/ui.js";

const TARGET_LABEL: Record<SkillTarget, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  generic: "Genérico",
};

const DESTINATION_LABEL: Record<SkillDestination, string> = {
  project: "Proyecto (repo)",
  user: "Solo yo (usuario)",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SkillsTab({ ws, proj }: { ws: string; proj: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.skills(ws, proj),
    queryFn: () => api.skills.list(ws, proj).then((r) => r.skills),
    staleTime: STALE_TIME.moderate,
  });
  const skills = data ?? [];
  const errorMessage = error instanceof ApiError ? error.message : error ? "Error cargando las skills" : null;

  if (isLoading)
    return (
      <Card>
        <SkeletonList rows={4} />
      </Card>
    );

  return (
    <div className="space-y-6">
      <ErrorText>{errorMessage}</ErrorText>

      <Card>
        <h3 className="text-h4 text-ink-900">Skills del proyecto</h3>
        <p className="mt-1 text-body-sm text-ink-500">
          Publicadas por agentes vía MCP (publish_skill). Instalar es local: elegí destino y pegá el prompt en tu agente.
        </p>

        <div className="mt-4">
          {skills.length === 0 ? (
            <EmptyState
              title="Todavía no se publicó ninguna skill"
              description={'Pedile a un agente conectado que "suba esta skill al proyecto en Pemie" para que aparezca acá.'}
            />
          ) : (
            <div className="divide-y divide-line-100">
              {skills.map((skill) => (
                <button
                  key={skill.slug}
                  type="button"
                  onClick={() => setSelected(skill.slug)}
                  className="flex w-full items-center gap-3 -mx-6 px-6 py-3 text-left hover:bg-surface-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body font-semibold text-ink-900">{skill.name}</span>
                      <Badge tone="brand" mono>v{skill.version}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-body-sm text-ink-500">{skill.description}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3 font-mono text-caption text-ink-400">
                    <Badge tone={skill.publishedByType === "agent" ? "brand" : "neutral"} dot mono>
                      {skill.publishedByType === "agent" ? "Agente" : "Persona"}
                    </Badge>
                    <span>{formatDate(skill.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {selected ? <SkillDetailModal ws={ws} proj={proj} slug={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function installPrompt(ws: string, proj: string, skill: SkillInstall): string {
  const firstFile = skill.install.files[0]?.path ?? "SKILL.md";
  return `Instala la skill "${skill.slug}" (v${skill.version}) del proyecto "${proj}" en pemie.ai (workspace "${ws}").

1. Llama a la tool MCP get_skill con: { "slug": "${skill.slug}", "target": "${skill.install.target}", "destination": "${skill.install.destination}" }
2. Escribe cada archivo de install.files bajo install.rootPath (ej: ${skill.install.rootPath}/${firstFile}).
3. Confirmame el path final y la versión instalada.`;
}

function useSkillInstall(ws: string, proj: string, slug: string, target: SkillTarget, destination: SkillDestination) {
  return useQuery({
    queryKey: queryKeys.skillInstall(ws, proj, slug, target, destination),
    queryFn: () => api.skills.get(ws, proj, slug, target, destination),
    staleTime: STALE_TIME.moderate,
  });
}

function SkillDetailModal({
  ws,
  proj,
  slug,
  onClose,
}: {
  ws: string;
  proj: string;
  slug: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<SkillTarget>("claude");
  const [destination, setDestination] = useState<SkillDestination>("user");
  const { data: skill, isLoading, error } = useSkillInstall(ws, proj, slug, target, destination);
  const errorMessage = error instanceof ApiError ? error.message : error ? "Error cargando la skill" : null;
  const skillMd = skill?.install.files.find((f) => f.path === "SKILL.md");

  return (
    <Modal title={skill?.name ?? slug} onClose={onClose} size="lg">
      <div className="space-y-4">
        <ErrorText>{errorMessage}</ErrorText>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Runtime">
            <Select value={target} onChange={(e) => setTarget(e.target.value as SkillTarget)}>
              {SKILL_TARGETS.map((t) => (
                <option key={t} value={t}>{TARGET_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Destino" hint="Lo decide la persona: no lo asuma el agente.">
            <Select value={destination} onChange={(e) => setDestination(e.target.value as SkillDestination)}>
              {SKILL_DESTINATIONS.map((d) => (
                <option key={d} value={d}>{DESTINATION_LABEL[d]}</option>
              ))}
            </Select>
          </Field>
        </div>

        {isLoading || !skill ? (
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        ) : (
          <>
            <p className="text-body-sm text-ink-600">{skill.description}</p>

            {skillMd ? <CodeBlock title="SKILL.md">{skillMd.content}</CodeBlock> : null}

            <CodeBlock title="Prompt de instalación">{installPrompt(ws, proj, skill)}</CodeBlock>
          </>
        )}
      </div>
    </Modal>
  );
}
