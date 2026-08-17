import { Button, GithubIcon } from "../../../components/ui.js";
import { useTranslation } from "react-i18next";
import { Section, sectionTitleId } from "../components/Section.js";

const TITLE_ID = sectionTitleId("empezar");

export function FinalCta({ githubUrl }: { githubUrl: string }) {
  const { t } = useTranslation("landing");
  return (
    <Section id="empezar" tone="ink" titleId={TITLE_ID} className="text-center">
      <div className="mx-auto flex max-w-narrow flex-col items-center gap-6">
        <h2 id={TITLE_ID} className="m-0 text-h2 leading-tight text-on-ink sm:text-[52px]">
          {t("finalCta.title")}
        </h2>
        <p className="m-0 text-body-lg leading-relaxed text-on-ink-soft">
          {t("finalCta.description")}
        </p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <a href="/register">
            <Button size="lg">{t("finalCta.start")}</Button>
          </a>
          <a href={githubUrl}>
            <Button
              size="lg"
              variant="secondary"
              className="gap-2.5 border-[1.5px] border-white/40 bg-transparent text-on-ink hover:border-white hover:bg-transparent"
            >
              <GithubIcon /> {t("finalCta.continueWithGithub")}
            </Button>
          </a>
        </div>
      </div>
    </Section>
  );
}
