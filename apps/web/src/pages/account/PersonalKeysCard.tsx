import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_SCOPES, buildAgentPrompt, type ApiScope } from "@pemie/shared";
import { api, API_BASE, ApiError, type ApiKeyPublic } from "../../lib/api.js";
import { formatDateTime } from "../../lib/dates.js";
import { useAuth } from "../../lib/auth.js";
import { ConnectPanel } from "../../components/ConnectPanel.js";
import { ScopePicker } from "../../components/ScopePicker.js";
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorText, Field, Input, Modal, Select, Skeleton,
} from "../../components/ui.js";

/**
 * API keys personales: una sola key por persona sirve para todos los workspaces
 * donde sea miembro, así que se administran aquí y no en los ajustes de equipo.
 */
export function PersonalKeysCard() {
  const { t } = useTranslation(["account", "common"]);
  const { user } = useAuth();

  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([...API_SCOPES]);
  const [locale, setLocale] = useState<"es" | "en">(user?.locale ?? "es");
  const [creating, setCreating] = useState(false);

  const [newKey, setNewKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<ApiKeyPublic | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const readable = scopes.some((scope) => scope.endsWith(":read"));

  const prompt = useMemo(
    () =>
      newKey
        ? buildAgentPrompt({
            target: { scopeLevel: "user" },
            scopes,
            keyRef: { kind: "plaintext", key: newKey },
            mcpUrl: `${API_BASE}/mcp`,
            locale,
          })
        : null,
    [newKey, scopes, locale]
  );

  async function load() {
    setError(null);
    try {
      const result = await api.me.apiKeys.list();
      setKeys(result.apiKeys);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("account:loadKeysError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // La key en claro no se puede recuperar: avisar antes de perder la pestaña.
  useEffect(() => {
    if (!newKey || saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [newKey, saved]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!readable || name.trim().length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.me.apiKeys.create({ name: name.trim(), scopes, locale });
      setNewKey(result.key);
      setSaved(false);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("account:createKeyError"));
    } finally {
      setCreating(false);
    }
  }

  async function updateLocale(key: ApiKeyPublic, next: "es" | "en") {
    setUpdating(key.id);
    try {
      await api.me.apiKeys.updateLocale(key.id, next);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("account:updateKeyError"));
    } finally {
      setUpdating(null);
    }
  }

  async function revoke() {
    if (!pending) return;
    setRevoking(true);
    try {
      await api.me.apiKeys.revoke(pending.id);
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("account:revokeKeyError"));
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card className="mt-4">
      <h3 className="text-h4 text-ink-900">{t("account:personalKeysTitle")}</h3>
      <p className="mt-2 max-w-lg text-body-sm text-ink-600">{t("account:personalKeysDescription")}</p>

      <form className="mt-5 space-y-4" onSubmit={create}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("account:keyName")}>
            <Input value={name} required onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t("account:keyLocale")}>
            <Select
              aria-label={t("account:keyLocale")}
              value={locale}
              onChange={(event) => setLocale(event.target.value as "es" | "en")}
            >
              <option value="es">{t("account:spanish")}</option>
              <option value="en">{t("account:english")}</option>
            </Select>
          </Field>
        </div>
        <Field label={t("account:permissions")} hint={t("account:permissionsHint")}>
          <ScopePicker value={scopes} onChange={setScopes} />
        </Field>
        {!readable ? <ErrorText>{t("account:needRead")}</ErrorText> : null}
        <Button type="submit" disabled={creating || !readable || name.trim().length < 2}>
          {creating ? t("account:generating") : t("account:generateKey")}
        </Button>
      </form>

      <div className="mt-6">
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <EmptyState title={t("account:noKeys")} description={t("account:noKeysDescription")} />
        ) : (
          <div className="mt-4 divide-y divide-line-100">
            {keys.map((key) => (
              <div key={key.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink-900">
                    {key.name} <code className="font-mono text-caption text-ink-400">{key.prefix}…</code>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} tone="neutral" mono>{scope}</Badge>
                    ))}
                  </div>
                  <p className="mt-1 font-mono text-caption text-ink-400">
                    {t("account:created", { date: formatDateTime(key.createdAt) })} ·{" "}
                    {key.lastUsedAt
                      ? t("account:lastUse", { date: formatDateTime(key.lastUsedAt) })
                      : t("account:neverUsed")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    aria-label={t("account:keyLocaleAria", { name: key.name })}
                    className="w-auto"
                    disabled={updating === key.id}
                    value={key.locale ?? "es"}
                    onChange={(event) => void updateLocale(key, event.target.value as "es" | "en")}
                  >
                    <option value="es">{t("account:spanish")}</option>
                    <option value="en">{t("account:english")}</option>
                  </Select>
                  <Button size="sm" variant="danger" onClick={() => setPending(key)}>
                    {t("account:revoke")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending ? (
        <Modal title={t("account:revokeTitle")} onClose={() => !revoking && setPending(null)}>
          <div className="space-y-4">
            <p className="text-body text-ink-700">{t("account:revokeWarning", { name: pending.name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPending(null)}>{t("account:cancel")}</Button>
              <Button variant="danger" disabled={revoking} onClick={() => void revoke()}>
                {revoking ? t("account:revoking") : t("account:revoke")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {newKey && prompt ? (
        <Modal title={t("account:connect")} size="xl" dismissible={saved} onClose={() => saved && setNewKey(null)}>
          <div className="space-y-4">
            <ConnectPanel
              apiKey={newKey}
              mcpUrl={`${API_BASE}/mcp`}
              prompt={prompt}
              onCopy={() => setSaved(true)}
            />
            <Checkbox checked={saved} onChange={setSaved}>{t("account:confirmSaved")}</Checkbox>
            <Button className="w-full" disabled={!saved} onClick={() => setNewKey(null)}>
              {t("account:savedClose")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}
