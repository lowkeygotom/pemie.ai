import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api.js";
import { Card, ErrorText, Field, PageHeader, Select, Switch } from "../components/ui.js";

export default function Settings() {
  const { user, setAnalyticsPreference, setLocale } = useAuth();
  const { t } = useTranslation(["common", "account"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null; // ruta protegida: Layout ya garantiza sesión

  async function onToggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setAnalyticsPreference(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common:saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function onLocaleChange(locale: "es" | "en") {
    setBusy(true);
    setError(null);
    try {
      await setLocale(locale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common:saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={t("account:eyebrow")} title={t("account:title")} description={t("account:description")} />

      <Card className="mb-4">
        <h3 className="text-h4 text-ink-900">{t("account:languageTitle")}</h3>
        <p className="mt-2 max-w-lg text-body-sm text-ink-600">{t("account:languageDescription")}</p>
        <div className="mt-4 max-w-xs">
          <Field label={t("common:language")}>
            <Select
              aria-label={t("common:language")}
              value={user.locale}
              disabled={busy}
              onChange={(event) => void onLocaleChange(event.target.value as "es" | "en")}
            >
              <option value="es">{t("account:spanish")}</option>
              <option value="en">{t("account:english")}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="text-h4 text-ink-900">{t("account:privacyTitle")}</h3>
        <p className="mt-2 max-w-lg text-body-sm text-ink-600">
          {t("account:privacyDescription")}
        </p>
        <div className="mt-4">
          <Switch
            checked={user.analyticsEnabled}
            onChange={onToggle}
            label={t("account:analyticsLabel")}
          />
        </div>
        {busy ? <p className="mt-2 text-caption text-ink-400">{t("common:saving")}</p> : null}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>
    </div>
  );
}
