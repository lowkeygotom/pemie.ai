import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";
import { Eyebrow } from "../../../components/ui.js";

const TITLE_ID = sectionTitleId("problema");

export function ProblemSection() {
  const { t } = useTranslation("landing");
  return (
    <Section tone="ink" titleId={TITLE_ID}>
      <div className="grid items-start gap-10 sm:grid-cols-2 sm:gap-14">
        <div>
          <Eyebrow className="mb-4 block text-accent-onink">{t("problem.eyebrow")}</Eyebrow>
          <h2 id={TITLE_ID} className="text-h3 leading-tight text-on-ink sm:text-h2">
            {t("problem.title")}
          </h2>
        </div>
        <div className="flex flex-col gap-5.5 text-body-lg leading-relaxed text-on-ink-soft">
          <p className="m-0 border-l-2 border-blue-600 pl-4.5">{t("problem.boards")}</p>
          <p className="m-0 border-l-2 border-blue-600 pl-4.5">{t("problem.chatbots")}</p>
          <p className="m-0 border-l-2 border-blue-600 pl-4.5 text-on-ink">{t("problem.anchor")}</p>
        </div>
      </div>
    </Section>
  );
}
