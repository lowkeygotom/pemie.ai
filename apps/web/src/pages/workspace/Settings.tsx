import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { API_SCOPES, buildAgentPrompt, type ApiKeyScopeLevel, type ApiScope } from "@pemie/shared";
import {
  api,
  analyticsFailureReason,
  ApiError,
  API_BASE,
  type ApiKeyPublic,
  type AuditLog,
  type ProjectSummary,
  type Workspace as Ws,
} from "../../lib/api.js";
import { track } from "../../lib/analytics/index.js";
import { useAuth } from "../../lib/auth.js";
import { useTranslation } from "react-i18next";
import { ConnectPanel } from "../../components/ConnectPanel.js";
import { ScopePicker } from "../../components/ScopePicker.js";
import { TelegramChannelCard } from "../../components/TelegramChannelCard.js";
import { SettingsSection } from "../Workspace.js";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  SkeletonCard,
  Tabs,
} from "../../components/ui.js";

const MCP_URL = `${API_BASE}/mcp`;
const TAB_ITEMS = [
  { id: "general", label: "General" },
  { id: "credentials", label: "Credenciales" },
  { id: "telegram", label: "Telegram" },
  { id: "activity", label: "Actividad" },
] as const;
type SettingsTab = (typeof TAB_ITEMS)[number]["id"];

function isSettingsTab(value: string | null): value is SettingsTab {
  return TAB_ITEMS.some((tab) => tab.id === value);
}

/** Ajustes del workspace, separados del flujo diario de Equipo. */
export default function WorkspaceSettings() {
  const { t } = useTranslation("configuration");
  const { user } = useAuth();
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [ws, setWs] = useState<Ws | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyName, setKeyName] = useState("");
  const [scopeLevel, setScopeLevel] = useState<Extract<ApiKeyScopeLevel, "workspace" | "user">>("workspace");
  const [scopes, setScopes] = useState<ApiScope[]>([...API_SCOPES]);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyPublic | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const requestedTab = params.get("tab");
  const tab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : "general";
  const hasReadScope = scopes.some((scope) => scope.endsWith(":read"));
  const credentialKeys = useMemo(
    () => keys.filter((key) => key.scopeLevel !== "project" || key.agentId === null),
    [keys]
  );
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  async function load() {
    setError(null);
    try {
      const [wsRes, projectsRes] = await Promise.all([api.workspaces.get(slug), api.projects.list(slug)]);
      const canManage = wsRes.workspace.role === "owner" || wsRes.workspace.role === "admin";
      const [keysRes, auditRes] = canManage
        ? await Promise.all([api.apiKeys.list(slug), api.audit.list(slug)])
        : [{ apiKeys: [] as ApiKeyPublic[] }, { auditLogs: [] as AuditLog[] }];
      setWs(wsRes.workspace);
      setProjects(projectsRes.projects);
      setKeys(keysRes.apiKeys);
      setLogs(auditRes.auditLogs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settingsLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!newKey || confirmedSaved) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [newKey, confirmedSaved]);

  function selectTab(nextTab: SettingsTab) {
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    setParams(next);
  }

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    if (keyName.trim().length < 2 || !hasReadScope) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const result = await api.apiKeys.create(slug, { name: keyName.trim(), scopeLevel, scopes });
      track("api_key_created", { scope_level: scopeLevel });
      setNewKey(result.key);
      setConfirmedSaved(false);
      setKeyName("");
      await load();
    } catch (err) {
      track("api_key_created_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : t("keyCreate"));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.apiKeys.revoke(slug, pendingRevoke.id);
      track("api_key_revoked");
      setPendingRevoke(null);
      await load();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : t("keyRevoke"));
    } finally {
      setRevoking(false);
    }
  }

  const prompt = useMemo(
    () => newKey
      ? buildAgentPrompt({
          workspaceSlug: slug,
          target: { scopeLevel },
          scopes,
          keyRef: { kind: "plaintext", key: newKey },
          mcpUrl: MCP_URL,
          locale: user?.locale,
        })
      : null,
    [newKey, scopeLevel, scopes, slug, user?.locale]
  );

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="mb-8 h-9 w-48" />
        <div className="space-y-6"><SkeletonCard lines={3} /><SkeletonCard lines={3} /></div>
      </div>
    );
  }

  if (!ws) return <Card><ErrorText>{error ?? t("workspaceMissing")}</ErrorText></Card>;

  const canManage = ws.role === "owner" || ws.role === "admin";
  if (!canManage) {
    return (
      <div>
        <Link to={`/w/${slug}`} className="mb-1 block text-body-sm text-ink-400 hover:text-ink-700">← {ws.name}</Link>
        <PageHeader title="Ajustes" />
        <Card><ErrorText>{t("adminOnly")}</ErrorText></Card>
      </div>
    );
  }

  return (
    <div>
      <Link to={`/w/${slug}`} className="mb-1 block text-body-sm text-ink-400 hover:text-ink-700">← {ws.name}</Link>
        <PageHeader title={t("settings")} description={t("settingsDescription")} actions={<Badge tone="neutral" mono>{ws.role}</Badge>} />
      <Tabs items={[...TAB_ITEMS]} value={tab} onChange={(id) => selectTab(id as SettingsTab)} className="mb-6" />
      <section role="tabpanel" aria-label={TAB_ITEMS.find((item) => item.id === tab)?.label} className="space-y-6">
        <ErrorText>{error}</ErrorText>

        {tab === "general" ? <SettingsSection key={ws.id} ws={ws} onRenamed={setWs} /> : null}

        {tab === "credentials" ? (
          <>
            <Card>
              <h2 className="text-h4 text-ink-900">{t("credentialsTitle")}</h2>
              <p className="mt-2 text-body-sm text-ink-600">{t("credentialsDescription")}</p>
              <form onSubmit={createKey} className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("scope")}>
                    <Select value={scopeLevel} onChange={(event) => setScopeLevel(event.target.value as Extract<ApiKeyScopeLevel, "workspace" | "user">)}>
                      <option value="workspace">{t("workspace")}</option>
                      <option value="user">{t("user")}</option>
                    </Select>
                  </Field>
                  <Field label={t("keyName")} hint={keyName.trim().length < 2 ? t("minChars") : undefined}>
                    <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Ej: reportes-global" required />
                  </Field>
                </div>
                <Field label={t("permissions")} hint={t("permissionsHint")}>
                  <ScopePicker value={scopes} onChange={setScopes} />
                </Field>
                {!hasReadScope ? <ErrorText>{t("needRead")}</ErrorText> : null}
                <Button type="submit" disabled={creating || keyName.trim().length < 2 || !hasReadScope}>{creating ? t("generating") : t("generateKey")}</Button>
              </form>
            </Card>

            <Card>
              <h2 className="text-h4 text-ink-900">{t("keys", { count: credentialKeys.length })}</h2>
              <div className="mt-4">
                {credentialKeys.length === 0 ? <EmptyState title={t("noCredentials")} description={t("noCredentialsDescription")} /> : (
                  <div className="divide-y divide-line-100">
                    {credentialKeys.map((key) => (
                      <div key={key.id} className="flex items-start justify-between gap-3 -mx-6 px-6 py-3 hover:bg-surface-50">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink-900">{key.name} <code className="font-mono text-caption text-ink-400">{key.prefix}…</code></p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Badge tone="brand" mono>{key.scopeLevel === "project" ? t("projectScope") : key.scopeLevel === "workspace" ? t("workspace") : t("user")}</Badge>
                            {key.scopeLevel === "project" && key.projectId ? <Badge tone="neutral" mono>{projectById.get(key.projectId)?.slug ?? t("project")}</Badge> : null}
                            {key.scopeLevel === "project" && key.agentId === null ? <Badge tone="warning">{t("noAgent")}</Badge> : null}
                            {key.scopes.map((scope) => <Badge key={scope} tone="neutral" mono>{scope}</Badge>)}
                          </div>
                          <p className="mt-1 font-mono text-caption text-ink-400">{t("created", { date: new Date(key.createdAt).toLocaleString() })} · {key.lastUsedAt ? t("lastUse", { date: new Date(key.lastUsedAt).toLocaleString() }) : t("neverUsed")}</p>
                        </div>
                        <Button variant="danger" size="sm" onClick={() => setPendingRevoke(key)}>{t("revoke")}</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </>
        ) : null}

        {tab === "telegram" ? <TelegramChannelCard projects={projects.map((project) => ({ id: project.id, slug: project.slug, name: project.name }))} /> : null}

        {tab === "activity" ? (
          <Card>
            <h2 className="text-h4 text-ink-900">{t("activityTitle")}</h2>
            <p className="mt-2 text-body-sm text-ink-600">{t("activityDescription")}</p>
            <div className="mt-4">
              {logs.length === 0 ? <EmptyState title={t("noActivity")} description={t("noActivityDescription")} /> : (
                <div className="divide-y divide-line-100">
                  {logs.slice(0, 50).map((log) => (
                    <div key={log.id} className="flex items-center justify-between -mx-6 px-6 py-2.5 hover:bg-surface-50">
                      <span className="flex min-w-0 items-center gap-2"><Badge tone={log.actorType === "agent" ? "brand" : "neutral"} dot>{log.actorType}</Badge><span className="truncate text-body-sm text-ink-700">{log.actorName}</span><code className="truncate font-mono text-caption text-ink-700">{log.action}</code></span>
                      <span className="shrink-0 font-mono text-caption text-ink-400">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {logs.length > 50 ? <p className="mt-3 text-caption text-ink-400">{t("showingRecent", { count: logs.length })}</p> : null}
            </div>
          </Card>
        ) : null}
      </section>

      {pendingRevoke ? (
        <Modal title={t("revokeTitle")} onClose={() => !revoking && setPendingRevoke(null)}>
          <div className="space-y-4">
            <ErrorText>{revokeError}</ErrorText>
            <p className="text-body text-ink-700">{t("revokeWarning", { name: `${pendingRevoke.name} ${pendingRevoke.prefix}…` })}</p>
            <div className="flex justify-end gap-2 border-t border-line-100 pt-4"><Button variant="secondary" disabled={revoking} onClick={() => setPendingRevoke(null)}>{t("cancel")}</Button><Button variant="danger" disabled={revoking} onClick={confirmRevoke}>{revoking ? t("revoking") : t("revoke")}</Button></div>
          </div>
        </Modal>
      ) : null}
      {newKey && prompt ? (
        <Modal title={t("connect")} size="xl" dismissible={confirmedSaved} onClose={() => confirmedSaved && setNewKey(null)}>
          <div className="space-y-4">
            <ConnectPanel apiKey={newKey} mcpUrl={MCP_URL} prompt={prompt} onCopy={() => setConfirmedSaved(true)} />
            <Checkbox checked={confirmedSaved} onChange={setConfirmedSaved}>{t("confirmSaved")}</Checkbox>
            <Button type="button" className="w-full" disabled={!confirmedSaved} onClick={() => setNewKey(null)}>{t("savedClose")}</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
