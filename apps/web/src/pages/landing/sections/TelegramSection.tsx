import { Card } from "../../../components/ui.js";
import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("telegram");
const PROJECT = "atlas";

export function TelegramSection() {
  const { t } = useTranslation("landing");
  return (
    <Section id="telegram" titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <Card padding="none" className="mx-auto flex w-full max-w-[480px] flex-col gap-3.5 p-6">
          <div className="text-center font-mono text-caption text-ink-600">{t("telegram.channelLabel", { project: PROJECT })}</div>
          <div className="ml-auto max-w-[85%] rounded-[14px] rounded-tr-sm bg-blue-600 px-4 py-3 text-body-sm leading-relaxed text-white">
            {t("telegram.question", { project: PROJECT })}
          </div>
          <Card padding="none" className="mr-auto max-w-[88%] rounded-[14px] rounded-tl-sm px-4 py-3 text-body-sm leading-relaxed">
            {t("telegram.answer")}
            <br />
            <span className="font-mono text-caption text-ink-600">
              {t("telegram.evidence")}
            </span>
          </Card>
          <div className="text-center font-mono text-caption text-ink-600">
            {t("telegram.scope")}
          </div>
        </Card>
        <div>
          <SectionIntro
            eyebrow={t("telegram.eyebrow")}
            titleId={TITLE_ID}
            title={t("telegram.title")}
            description={t("telegram.description")}
            className="mb-4.5"
          />
          <div className="font-mono text-body-sm text-ink-900">
            byok: <span className="text-blue-600">anthropic</span> ·{" "}
            <span className="text-blue-600">openai</span> · <span className="text-blue-600">deepseek</span>
          </div>
        </div>
      </div>
    </Section>
  );
}
