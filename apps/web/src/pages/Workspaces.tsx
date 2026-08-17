import { useEffect, useState } from "react";
import { api, analyticsFailureReason, ApiError, type WorkspaceSummary } from "../lib/api.js";
import { track } from "../lib/analytics/index.js";
import { useAuth } from "../lib/auth.js";
import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, ErrorText, Field, Input, Skeleton, SkeletonList } from "../components/ui.js";
import { LaunchpadList } from "./workspaces/LaunchpadList.js";
import { DirectoryList } from "./workspaces/DirectoryList.js";

// A partir de acá el launchpad (filas grandes centradas) deja de escalar y se pasa al
// directorio (filtro + recientes + grid compacto).
const DIRECTORY_THRESHOLD = 6;

export default function Workspaces() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { workspaces } = await api.workspaces.list();
    setWorkspaces(workspaces);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : t("loadWorkspacesFailed")));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.workspaces.create(name);
      track("workspace_created");
      setName("");
      setCreating(false);
      await load();
    } catch (err) {
      track("workspace_created_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !workspaces)
    return (
      <Card>
        <ErrorText>{error}</ErrorText>
      </Card>
    );

  if (!workspaces)
    return (
      <div className="mx-auto flex max-w-focus flex-col gap-3.5">
        <div className="mb-11 flex flex-col items-center gap-2.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-11 w-80" />
          <Skeleton className="h-5 w-48" />
        </div>
        <SkeletonList rows={3} />
      </div>
    );

  if (workspaces.length === 0)
    return (
      <div className="mx-auto max-w-focus">
        <EmptyState
          title={t("noWorkspaces")}
          description={t("noWorkspacesDescription")}
          action={<Button onClick={() => setCreating(true)}>{t("createWorkspace")}</Button>}
        />
        {creating && (
          <Card className="mt-6">
            <form onSubmit={onCreate} className="flex items-end gap-3">
              <div className="flex-1">
                <Field label={t("workspaceName")}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                </Field>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? t("creating") : t("create")}
              </Button>
            </form>
            <div className="mt-2">
              <ErrorText>{error}</ErrorText>
            </div>
          </Card>
        )}
      </div>
    );

  const sharedProps = {
    workspaces,
    userName: user?.name,
    creating,
    onToggleCreate: setCreating,
    name,
    onNameChange: setName,
    onCreate,
    busy,
    error,
  };

  return workspaces.length < DIRECTORY_THRESHOLD ? (
    <LaunchpadList {...sharedProps} />
  ) : (
    <DirectoryList {...sharedProps} />
  );
}
