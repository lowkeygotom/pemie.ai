import { Badge, Card } from "../../../components/ui.js";
import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";
import { DEMO_COMMITS } from "../data/commits.js";

const TITLE_ID = sectionTitleId("commits-dominios");

export function CommitsDomains() {
  const { t } = useTranslation("landing");
  return (
    <Section titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <SectionIntro
          eyebrow={t("commits.eyebrow")}
          titleId={TITLE_ID}
          title={t("commits.title")}
          description={t("commits.description")}
        />
        <Card padding="none" className="divide-y divide-line-100 p-5 font-mono text-body-sm">
          {DEMO_COMMITS.map((c) => (
            <div key={c.sha} className="flex items-center justify-between gap-3 px-2.5 py-3">
              <span className="text-ink-600">
                {c.sha}&nbsp;&nbsp;<span className="text-ink-900">{t(`commits.messages.${c.sha}`)}</span>
              </span>
              <Badge tone="neutral" mono>
                {c.domain}
              </Badge>
            </div>
          ))}
        </Card>
      </div>
    </Section>
  );
}
