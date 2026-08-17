import { Card } from "../../../components/ui.js";
import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("dual-surface");

export function DualSurface() {
  const { t } = useTranslation("landing");
  return (
    <Section tone="subtle" titleId={TITLE_ID}>
      <SectionIntro
        eyebrow={t("dualSurface.eyebrow")}
        titleId={TITLE_ID}
        title={t("dualSurface.title")}
        align="center"
        className="mb-10 sm:mb-14"
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card padding="none" className="p-8">
          <div className="mb-4 font-mono text-body-sm text-ink-600">{t("dualSurface.peopleLabel")}</div>
          <h3 className="mb-4 text-h4 text-ink-900">{t("dualSurface.peopleTitle")}</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-body text-ink-600">
            {[0, 1, 2].map((index) => <Bullet key={index} dot="text-blue-600">{t(`dualSurface.peopleBullets.${index}`)}</Bullet>)}
          </ul>
        </Card>
        <div className="rounded-lg bg-surface-ink p-8 text-on-ink">
          <div className="mb-4 font-mono text-body-sm text-on-ink-muted">{t("dualSurface.agentsLabel")}</div>
          <h3 className="mb-4 text-h4 text-on-ink">{t("dualSurface.agentsTitle")}</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-body text-on-ink-soft">
            {[0, 1, 2].map((index) => <Bullet key={index} dot="text-accent-onink">{t(`dualSurface.agentBullets.${index}`)}</Bullet>)}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Bullet({ children, dot }: { children: string; dot: string }) {
  return (
    <li className="flex gap-2.5">
      <span className={`font-bold ${dot}`}>—</span>
      {children}
    </li>
  );
}
