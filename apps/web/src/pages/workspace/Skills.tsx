import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isValidSkillSlug } from "@pemie/shared";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Badge,
  Card,
  DropZone,
  EmptyState,
  ErrorText,
  PageHeader,
  ProgressBar,
  Skeleton,
  SkeletonList,
} from "../../components/ui.js";
import SkillDetailModal from "./SkillDetailModal.js";
import { formatDateShort } from "../../lib/dates.js";

const formatDate = formatDateShort;

/**
 * Extrae path relativos desde un FileList de webkitdirectory.
 * El primer segmento (nombre de la carpeta raíz) se strippea para que
 * SKILL.md quede en la raíz del paquete, igual que el tar del agente.
 */
function relativeSkillFiles(fileList: FileList): Array<{ path: string; file: File }> {
  const entries: Array<{ path: string; file: File }> = [];
  for (const file of Array.from(fileList)) {
    const raw = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const segments = raw.split("/").filter(Boolean);
    if (segments.length < 2) continue;
    const path = segments.slice(1).join("/");
    if (!path || path.endsWith("/")) continue;
    entries.push({ path, file });
  }
  return entries;
}

function inferMeta(files: Array<{ path: string; file: File }>) {
  const rootName = files[0]?.file.webkitRelativePath?.split("/")[0] ?? "skill";
  const slug = isValidSkillSlug(rootName)
    ? rootName
    : rootName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "skill";
  return {
    slug,
    name: rootName,
    description: `Skill ${rootName} subida desde la web`,
  };
}

export default function WorkspaceSkills() {
  const { t } = useTranslation("skills");
  const { slug = "" } = useParams();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.skills(slug),
    queryFn: () => api.skills.list(slug).then((r) => r.skills),
    staleTime: STALE_TIME.moderate,
  });
  const skills = data ?? [];
  const errorMessage = error instanceof ApiError ? error.message : error ? t("loadError") : null;

  const upload = useMutation({
    mutationFn: async (fileList: FileList) => {
      setUploadError(null);
      setUploadProgress(0);
      const parts = relativeSkillFiles(fileList);
      if (parts.length === 0) throw new ApiError(400, t("emptyFiles"), "empty_files");
      if (!parts.some((p) => p.path === "SKILL.md"))
        throw new ApiError(400, t("missingSkillMd"), "missing_skill_md");

      const meta = inferMeta(parts);
      const ticket = await api.skills.create(slug, meta);
      setUploadProgress(20);

      const form = new FormData();
      for (const part of parts) form.append(part.path, part.file, part.path);
      setUploadProgress(40);
      await api.skills.upload(ticket.uploadUrl, form);
      setUploadProgress(100);
      return meta.slug;
    },
    onSuccess: (uploadedSlug) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills(slug) });
      setSelected(uploadedSlug);
      setTimeout(() => setUploadProgress(null), 800);
    },
    onError: (err) => {
      setUploadProgress(null);
      setUploadError(err instanceof ApiError ? err.message : t("uploadError"));
    },
  });

  if (isLoading)
    return (
      <div>
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="mb-8 h-9 w-64" />
        <Card>
          <SkeletonList rows={4} />
        </Card>
      </div>
    );

  return (
    <div>
      <Link to={`/w/${slug}`} className="mb-1 block text-body-sm text-ink-400 hover:text-ink-700">
        {t("workspace")}
      </Link>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-6">
        <ErrorText>{errorMessage}</ErrorText>
        <ErrorText>{uploadError}</ErrorText>

        <DropZone
          disabled={upload.isPending}
          onFiles={(files) => upload.mutate(files)}
          label={t("dropLabel")}
          hint={t("dropHint")}
        />
        {uploadProgress != null ? (
          <ProgressBar value={uploadProgress} label={t("uploading")} />
        ) : null}

        <Card>
          <h3 className="text-h4 text-ink-900">{t("catalog")}</h3>
          <div className="mt-4">
            {skills.length === 0 ? (
              <EmptyState
                title={t("empty")}
                description={t("emptyDescription")}
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
                        <Badge tone="brand" mono>
                          v{skill.version}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-body-sm text-ink-500">{skill.description}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3 font-mono text-caption text-ink-400">
                      <Badge tone={skill.publishedByType === "agent" ? "brand" : "neutral"} dot mono>
                        {skill.publishedByType === "agent" ? t("agent") : t("person")}
                      </Badge>
                      <span>{formatDate(skill.updatedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {selected ? (
        <SkillDetailModal ws={slug} skillSlug={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
