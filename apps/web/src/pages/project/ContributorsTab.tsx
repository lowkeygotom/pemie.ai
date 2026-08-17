import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Contributor } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, Field, Input, Notice, SkeletonList } from "../../components/ui.js";
import InvitePersonModal from "../../components/InvitePersonModal.js";
import { useTranslation } from "react-i18next";

export default function ContributorsTab({ ws, proj, canManage }: { ws: string; proj: string; canManage: boolean }) {
  const { t } = useTranslation("collaboration");
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.contributors(ws, proj), queryFn: () => api.contributors.list(ws, proj).then((r) => r.contributors), staleTime: STALE_TIME.live });
  const [editing, setEditing] = useState<Contributor | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  function open(contributor: Contributor) { setEditing(contributor); setEmail(contributor.email ?? ""); setError(null); }
  async function save(value: string | null) {
    if (!editing) return; setSaving(true); setError(null);
    try { await api.contributors.update(ws, proj, editing.id, value); setEditing(null); client.invalidateQueries({ queryKey: queryKeys.contributors(ws, proj) }); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("saveEmailFailed")); }
    finally { setSaving(false); }
  }
  if (query.isLoading) return <Card><SkeletonList rows={3} /></Card>;
  if (query.error) return <Notice tone="danger">{t("contributorsLoadFailed")} <Button size="sm" variant="secondary" onClick={() => query.refetch()}>{t("retry")}</Button></Notice>;
  const contributors = query.data ?? [];
  if (!contributors.length) return <EmptyState title={t("noContributors")} description={t("noContributorsDescription")} />;
  return <Card>
    <h3 className="text-h4 text-ink-900">{t("contributors", { count: contributors.length })}</h3>
    <p className="mt-1 text-body-sm text-ink-500">{t("contributorsDescription")}</p>
    <ul className="mt-4 divide-y divide-line-100">
      {contributors.map((c) => <li key={c.id} className="py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar label={c.name || c.githubLogin} size="sm" />
          <div className="min-w-0 flex-1"><p className="truncate text-body-sm font-medium text-ink-900">{c.name || c.githubLogin}</p>{c.name && c.name !== c.githubLogin ? <p className="font-mono text-caption text-ink-400">{c.githubLogin}</p> : null}</div>
          {c.email ? <span className="font-mono text-caption text-ink-500">{c.email}</span> : null}
          {c.notify === "none" ? <Badge tone="warning" dot>{t("noEmail")}</Badge> : c.notify === "external" ? <Badge tone="neutral" mono>{t("noAccount")}</Badge> : null}
          {canManage ? <><Button size="sm" variant="secondary" onClick={() => open(c)}>{t("editEmail")}</Button>{c.notify === "external" && c.email ? <Button size="sm" variant="secondary" onClick={() => setInviteEmail(c.email)}>{t("invite")}</Button> : null}</> : null}
        </div>
        {editing?.id === c.id ? <div className="mt-3 flex flex-col gap-2 border-t border-line-100 pt-3 sm:flex-row sm:items-end"><div className="flex-1"><Field label={t("notificationEmail")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field></div><Button size="sm" disabled={saving} onClick={() => save(email)}>{saving ? t("saving") : t("save")}</Button>{c.suggestedEmail ? <Button size="sm" variant="ghost" onClick={() => setEmail(c.suggestedEmail!)}>{t("use", { email: c.suggestedEmail })}</Button> : null}{c.email ? <Button size="sm" variant="secondary" disabled={saving} onClick={() => save(null)}>{t("removeEmail")}</Button> : null}<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("cancel")}</Button><ErrorText>{error}</ErrorText></div> : null}
      </li>)}
    </ul>
    {inviteEmail ? <InvitePersonModal ws={ws} initialEmail={inviteEmail} onClose={() => setInviteEmail(null)} /> : null}
  </Card>;
}
