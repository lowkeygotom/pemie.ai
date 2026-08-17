import { useTranslation } from "react-i18next";
import { Card } from "../../../components/ui.js";
import { DemoVideo } from "../components/DemoVideo.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("informes");
const PROJECT = "atlas";
const PROGRESS = 74;
const PREV_PROGRESS = 68;
const EVIDENCE = ["a41f2c9", "7d03be1", "c9e0d12"];

export function ReportsSection() {
  const { t } = useTranslation("landing");
  return (
    <Section id="informes" tone="subtle" titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <Card padding="none" className="p-7">
          <div className="mb-4.5 flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-bold text-h4 text-ink-900">{t("reports.cardTitle", { week: 31 })}</span>
            <span className="font-mono text-caption text-ink-600">{t("reports.project", { project: PROJECT })}</span>
          </div>
          <div className="mb-2 flex justify-between text-body-sm text-ink-600">
            <span>{t("reports.progressLabel")}</span>
            <span className="font-mono font-semibold text-ink-900">{PROGRESS}%</span>
          </div>
          <div className="mb-5 h-2 overflow-hidden rounded-sm bg-line-200">
            <div
              className="h-full rounded-sm bg-blue-600 transition-[width] duration-500"
              style={{ width: `${PROGRESS}%` }}
            />
          </div>
          <p className="m-0 mb-3.5 text-body-sm leading-relaxed text-ink-900">
            {t("reports.summaryPrefix")}
            <strong>{t("reports.summaryDomain", { domain: "api" })}</strong>
            {t("reports.summarySuffix", { prev: PREV_PROGRESS, progress: PROGRESS })}
          </p>
          <div className="font-mono text-caption text-ink-600">
            {t("reports.evidence")}{" "}
            {EVIDENCE.map((sha, i) => (
              <span key={sha}>
                {i > 0 ? " · " : ""}
                <a href="#informes">{sha}</a>
              </span>
            ))}
          </div>
        </Card>
        <SectionIntro
          eyebrow={t("reports.eyebrow")}
          titleId={TITLE_ID}
          title={t("reports.title")}
          description={t("reports.description")}
        />
      </div>
      <div className="mt-12 sm:mt-16">
        <DemoVideo
          src="/videos/report-full.mp4"
          label={t("reports.videoLabel")}
          caption={t("reports.videoCaption")}
          ariaLabel={t("reports.videoAriaLabel")}
        />
      </div>
    </Section>
  );
}
