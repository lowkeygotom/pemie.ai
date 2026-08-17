import { DemoVideo } from "../components/DemoVideo.js";
import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";
import { HOW_IT_WORKS_STEPS } from "../data/howItWorks.js";

const TITLE_ID = sectionTitleId("como");

export function HowItWorks() {
  const { t } = useTranslation("landing");
  return (
    <Section id="como" titleId={TITLE_ID}>
      <SectionIntro
        eyebrow={t("howItWorks.eyebrow")}
        titleId={TITLE_ID}
        title={t("howItWorks.title")}
        className="mb-10 sm:mb-14"
      />
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS_STEPS.map((s) => (
          <div key={s.step} className="border-t-2 border-ink-900 pt-5">
            <div className="mb-2.5 font-mono text-body-sm text-blue-600">{s.step}</div>
            <h3 className="mb-2 text-h4 text-ink-900">{t(`howItWorks.steps.${Number(s.step) - 1}.title`)}</h3>
            <p className="m-0 text-body-sm leading-relaxed text-ink-600">{t(`howItWorks.steps.${Number(s.step) - 1}.description`)}</p>
          </div>
        ))}
      </div>
      <div className="mt-12 sm:mt-16">
        <DemoVideo
          src="/videos/connect-to-hermes.mp4"
          label={t("howItWorks.videoLabel")}
          caption={t("howItWorks.videoCaption")}
          ariaLabel={t("howItWorks.videoAriaLabel")}
        />
      </div>
    </Section>
  );
}
