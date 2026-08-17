import { useMemo, useState } from "react";
import {
  classifyCommit,
  DEFAULT_DOMAIN_CONFIG,
  type DomainCategory,
  type DomainConfig,
} from "@pemie/shared";
import { api, ApiError } from "../../lib/api.js";
import { Badge, Button, Collapsible, ErrorText, Field, Input } from "../../components/ui.js";
import { useTranslation } from "react-i18next";

function cloneConfig(config: DomainConfig): DomainConfig {
  return {
    fallback: config.fallback,
    categories: config.categories.map((c) => ({
      ...c,
      matchers: [...(c.matchers ?? [])],
    })),
  };
}

function emptyCategory(): DomainCategory {
  return { key: "", label: "", emoji: "", matchers: [], primary: false };
}

export default function DomainConfigEditor({
  ws,
  proj,
  initial,
  onSaved,
}: {
  ws: string;
  proj: string;
  initial: DomainConfig | null;
  onSaved: (config: DomainConfig, reclassified: number) => void;
}) {
  const { t } = useTranslation("configuration");
  const [draft, setDraft] = useState<DomainConfig>(() =>
    cloneConfig(initial ?? DEFAULT_DOMAIN_CONFIG)
  );
  const [previewMsg, setPreviewMsg] = useState("feat: add login form");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewKey = useMemo(() => classifyCommit(previewMsg, draft), [previewMsg, draft]);
  const previewCat = draft.categories.find((c) => c.key === previewKey);

  function updateCategory(
    index: number,
    patch: Partial<DomainCategory> | { matchersText: string }
  ) {
    setDraft((prev) => {
      const categories = prev.categories.map((c, i) => {
        if (i !== index) return c;
        if ("matchersText" in patch) {
          return {
            ...c,
            matchers: patch.matchersText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
        }
        return { ...c, ...patch };
      });
      return { ...prev, categories };
    });
  }

  function setPrimary(index: number) {
    setDraft((prev) => ({
      ...prev,
      categories: prev.categories.map((c, i) => ({ ...c, primary: i === index })),
    }));
  }

  function addCategory() {
    setDraft((prev) => ({ ...prev, categories: [...prev.categories, emptyCategory()] }));
  }

  function removeCategory(index: number) {
    setDraft((prev) => ({
      ...prev,
      categories: prev.categories.filter((_, i) => i !== index),
    }));
  }

  function restoreDefault() {
    setDraft(cloneConfig(DEFAULT_DOMAIN_CONFIG));
    setNotice(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const cleaned: DomainConfig = {
        fallback: draft.fallback.trim() || "otro",
        categories: draft.categories.map((c) => ({
          key: c.key.trim(),
          label: c.label.trim(),
          ...(c.emoji?.trim() ? { emoji: c.emoji.trim() } : {}),
          ...(c.matchers && c.matchers.length > 0 ? { matchers: c.matchers } : {}),
          ...(c.primary ? { primary: true } : {}),
        })),
      };
      if (cleaned.categories.some((c) => !c.key || !c.label)) {
        throw new Error(t("categoryRequired"));
      }
      const result = await api.projects.updateDomainConfig(ws, proj, cleaned);
      setDraft(cloneConfig(result.config));
      setNotice(
        result.reclassified > 0
          ? t("saved", { count: result.reclassified })
          : t("savedUnchanged")
      );
      onSaved(result.config, result.reclassified);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t("saveFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Collapsible
      title={t("domains")}
      defaultOpen={false}
      badge={
        <Badge tone="neutral" mono>
          {draft.categories.length}
        </Badge>
      }
    >
      <p className="mb-4 text-body-sm text-ink-500">
        {t("domainsDescription")}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={restoreDefault} disabled={saving}>
          {t("restore")}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>
      {notice && <p className="mt-2 text-body-sm text-ink-600">{notice}</p>}

      <div className="mt-4 space-y-3">
        {draft.categories.map((cat, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border border-line-100 bg-surface-50 p-3 sm:grid-cols-12"
          >
            <Field label={t("key")}>
              <Input
                className="!py-1.5 font-mono text-caption"
                value={cat.key}
                onChange={(e) => updateCategory(index, { key: e.target.value })}
                placeholder="feature"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("label")}>
                <Input
                  className="!py-1.5"
                  value={cat.label}
                  onChange={(e) => updateCategory(index, { label: e.target.value })}
                  placeholder="Feature"
                />
              </Field>
            </div>
            <Field label={t("emoji")}>
              <Input
                className="!py-1.5"
                value={cat.emoji ?? ""}
                onChange={(e) => updateCategory(index, { emoji: e.target.value })}
                placeholder="✨"
              />
            </Field>
            <div className="sm:col-span-5">
              <Field label={t("matchers")} hint={t("commaSeparated")}>
                <Input
                  className="!py-1.5 font-mono text-caption"
                  value={(cat.matchers ?? []).join(", ")}
                  onChange={(e) => updateCategory(index, { matchersText: e.target.value })}
                  placeholder="^feat, feature"
                />
              </Field>
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <label className="mb-2 flex items-center gap-1.5 text-caption text-ink-600">
                <input
                  type="radio"
                  name="primary-domain"
                  checked={Boolean(cat.primary)}
                  onChange={() => setPrimary(index)}
                />
                {t("primary")}
              </label>
              <Button
                variant="danger"
                size="sm"
                className="mb-1"
                onClick={() => removeCategory(index)}
                disabled={draft.categories.length <= 1}
              >
                {t("remove")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Button variant="secondary" size="sm" onClick={addCategory}>
          {t("addCategory")}
        </Button>
        <div className="w-40">
          <Field label={t("fallback")}>
            <Input
              className="!py-1.5 font-mono text-caption"
              value={draft.fallback}
              onChange={(e) => setDraft((prev) => ({ ...prev, fallback: e.target.value }))}
            />
          </Field>
        </div>
      </div>

      <div className="mt-5 border-t border-line-100 pt-4">
        <Field label={t("preview")} hint={t("previewHint")}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-md !py-1.5"
              value={previewMsg}
              onChange={(e) => setPreviewMsg(e.target.value)}
              aria-label={t("previewAria")}
            />
            <Badge tone={previewCat?.primary ? "brand" : "neutral"} mono>
              {previewCat?.emoji ? `${previewCat.emoji} ` : ""}
              {previewCat?.label ?? previewKey}
            </Badge>
          </div>
        </Field>
      </div>
    </Collapsible>
  );
}
