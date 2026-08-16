import { Button, GithubIcon } from "../../../components/ui.js";
import { Section, sectionTitleId } from "../components/Section.js";

const TITLE_ID = sectionTitleId("empezar");

export function FinalCta({ githubUrl }: { githubUrl: string }) {
  return (
    <Section id="empezar" tone="ink" titleId={TITLE_ID} className="text-center">
      <div className="mx-auto flex max-w-narrow flex-col items-center gap-6">
        <h2 id={TITLE_ID} className="m-0 text-h2 leading-tight text-on-ink sm:text-[52px]">
          Conectá tu primer repo y que cada "¿cómo vamos?" lo conteste un commit.
        </h2>
        <p className="m-0 text-body-lg leading-relaxed text-on-ink-soft">
          En minutos vas a estar viendo tu primer informe, sin migraciones ni ceremonia.
        </p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <a href="/register">
            <Button size="lg">Empezar</Button>
          </a>
          <a href={githubUrl}>
            <Button
              size="lg"
              variant="secondary"
              className="gap-2.5 border-[1.5px] border-white/40 bg-transparent text-on-ink hover:border-white hover:bg-transparent"
            >
              <GithubIcon /> Continuar con GitHub
            </Button>
          </a>
        </div>
      </div>
    </Section>
  );
}
