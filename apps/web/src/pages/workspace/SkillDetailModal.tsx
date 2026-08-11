import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SKILL_DESTINATIONS, SKILL_TARGETS, type SkillDestination, type SkillTarget } from "@pemie/shared";
import { api, ApiError, type SkillInstall } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Button,
  CodeBlock,
  DangerZone,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
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

function installPrompt(ws: string, skill: SkillInstall): string {
  if (skill.install.downloadUrl && skill.install.command) {
    return `Instala la skill "${skill.slug}" (v${skill.version}) del workspace "${ws}" en pemie.ai.

1. Llama a get_skill con: { "slug": "${skill.slug}", "target": "${skill.install.target}", "destination": "${skill.install.destination}" }
2. Ejecutá el command de install (curl | tar) apuntando a install.rootPath (${skill.install.rootPath}).
3. Confirmame el path final y la versión instalada.`;
  }
  const firstFile = skill.install.files?.[0]?.path ?? "SKILL.md";
  return `Instala la skill "${skill.slug}" (v${skill.version}) del workspace "${ws}" en pemie.ai.

1. Llama a get_skill con: { "slug": "${skill.slug}", "target": "${skill.install.target}", "destination": "${skill.install.destination}" }
2. Escribe cada archivo de install.files bajo install.rootPath (ej: ${skill.install.rootPath}/${firstFile}).
3. Confirmame el path final y la versión instalada.`;
}

export default function SkillDetailModal({
  ws,
  skillSlug,
  onClose,
}: {
  ws: string;
  skillSlug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<SkillTarget>("claude");
  const [destination, setDestination] = useState<SkillDestination>("user");
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: skill, isLoading, error } = useQuery({
    queryKey: queryKeys.skillInstall(ws, skillSlug, target, destination),
    queryFn: () => api.skills.get(ws, skillSlug, target, destination),
    staleTime: STALE_TIME.moderate,
  });
  const errorMessage = error instanceof ApiError ? error.message : error ? "Error cargando la skill" : null;
  const skillMd = skill?.install.files?.find((f) => f.path === "SKILL.md");

  const remove = useMutation({
    mutationFn: () => api.skills.remove(ws, skillSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills(ws) });
      onClose();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo borrar la skill");
    },
  });

  return (
    <Modal title={skill?.name ?? skillSlug} onClose={onClose} size="lg">
      <div className="space-y-4">
        <ErrorText>{errorMessage}</ErrorText>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Runtime">
            <Select value={target} onChange={(e) => setTarget(e.target.value as SkillTarget)}>
              {SKILL_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Destino" hint="Lo decide la persona: no lo asuma el agente.">
            <Select value={destination} onChange={(e) => setDestination(e.target.value as SkillDestination)}>
              {SKILL_DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {DESTINATION_LABEL[d]}
                </option>
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

            {skill.install.command ? (
              <CodeBlock title="Comando de descarga">{skill.install.command}</CodeBlock>
            ) : null}

            <CodeBlock title="Prompt de instalación">{installPrompt(ws, skill)}</CodeBlock>

            <DangerZone
              title="Borrar skill"
              description="Hard delete irreversible: se eliminan la skill, sus archivos y los tokens de descarga. Tipiá el slug para habilitar el botón."
            >
              <ErrorText>{deleteError}</ErrorText>
              <Field label="Confirmá el slug">
                <Input
                  value={confirmSlug}
                  onChange={(e) => setConfirmSlug(e.target.value)}
                  placeholder={skillSlug}
                  autoComplete="off"
                />
              </Field>
              <Button
                variant="danger"
                className="mt-3"
                disabled={confirmSlug !== skillSlug || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "Borrando…" : `Borrar ${skillSlug}`}
              </Button>
            </DangerZone>
          </>
        )}
      </div>
    </Modal>
  );
}
