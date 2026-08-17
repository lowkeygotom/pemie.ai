import { useState } from "react";
import { useTranslation } from "react-i18next";
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

const TARGET_LABEL: Record<SkillTarget, string> = { cursor: "Cursor", claude: "Claude", codex: "Codex", generic: "generic" };

function installPrompt(ws: string, skill: SkillInstall, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (skill.install.downloadUrl && skill.install.command) {
    return t("promptInstall", { slug: skill.slug, version: skill.version, workspace: ws, target: skill.install.target, destination: skill.install.destination, rootPath: skill.install.rootPath });
  }
  const firstFile = skill.install.files?.[0]?.path ?? "SKILL.md";
  return t("promptInstallFiles", { slug: skill.slug, version: skill.version, workspace: ws, target: skill.install.target, destination: skill.install.destination, rootPath: skill.install.rootPath, file: firstFile });
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
  const { t } = useTranslation("skills");
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
  const errorMessage = error instanceof ApiError ? error.message : error ? t("detailLoadError") : null;
  const skillMd = skill?.install.files?.find((f) => f.path === "SKILL.md");

  const remove = useMutation({
    mutationFn: () => api.skills.remove(ws, skillSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills(ws) });
      onClose();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : t("uploadError"));
    },
  });

  return (
    <Modal title={skill?.name ?? skillSlug} onClose={onClose} size="lg">
      <div className="space-y-4">
        <ErrorText>{errorMessage}</ErrorText>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("runtime")}>
            <Select value={target} onChange={(e) => setTarget(e.target.value as SkillTarget)}>
              {SKILL_TARGETS.map((targetValue) => (
                <option key={targetValue} value={targetValue}>
                  {targetValue === "generic" ? t("generic") : TARGET_LABEL[targetValue]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("destination")} hint={t("destinationHint")}>
            <Select value={destination} onChange={(e) => setDestination(e.target.value as SkillDestination)}>
              {SKILL_DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {d === "project" ? t("project") : t("user")}
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
              <CodeBlock title={t("downloadCommand")}>{skill.install.command}</CodeBlock>
            ) : null}

            <CodeBlock title={t("installPrompt")}>{installPrompt(ws, skill, t)}</CodeBlock>

            <DangerZone
              title={t("delete")}
              description={t("deleteDescription")}
            >
              <ErrorText>{deleteError}</ErrorText>
              <Field label={t("confirmSlug")}>
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
                {remove.isPending ? t("deleting") : t("deleteSlug", { slug: skillSlug })}
              </Button>
            </DangerZone>
          </>
        )}
      </div>
    </Modal>
  );
}
