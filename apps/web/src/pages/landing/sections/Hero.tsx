import { useTranslation } from "react-i18next";
import { Button, GithubIcon } from "../../../components/ui.js";
import { AnimatedWordmark } from "../components/AnimatedWordmark.js";
import { TerminalDemo } from "../components/TerminalDemo.js";

export function Hero({ githubUrl }: { githubUrl: string }) {
  const { t } = useTranslation("landing");
  return (
    <header className="bg-gradient-to-b from-surface-0 to-surface-50 px-4 py-16 text-center sm:px-8 sm:py-24">
      <div className="mx-auto flex max-w-[960px] flex-col items-center gap-7">
        <AnimatedWordmark />
        <p className="animate-fade-up m-0 max-w-[760px] text-h3 font-bold leading-tight text-ink-900 sm:text-h1 [animation-delay:120ms]">
          {t("hero.title")}
        </p>
        <p className="animate-fade-up m-0 max-w-[620px] text-body-lg leading-relaxed text-ink-600 [animation-delay:220ms]">
          {t("hero.subtitle")}
        </p>
        <div className="animate-fade-up flex flex-wrap justify-center gap-3.5 [animation-delay:320ms]">
          <a href="/login">
            <Button size="lg">{t("footer.start")}</Button>
          </a>
          <a href={githubUrl}>
            <Button variant="secondary" size="lg" className="gap-2.5 border-[1.5px] border-ink-900">
              <GithubIcon /> {t("nav.continueWithGithub")}
            </Button>
          </a>
        </div>
        <div className="animate-fade-up mt-5 w-full text-left sm:mt-8 [animation-delay:450ms]">
          <TerminalDemo />
        </div>
      </div>
    </header>
  );
}
