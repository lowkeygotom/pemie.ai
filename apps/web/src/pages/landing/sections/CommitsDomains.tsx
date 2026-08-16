import { Badge, Card } from "../../../components/ui.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";
import { DEMO_COMMITS } from "../data/commits.js";

const TITLE_ID = sectionTitleId("commits-dominios");

export function CommitsDomains() {
  return (
    <Section titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <SectionIntro
          eyebrow="Ingesta de commits · Dominios"
          titleId={TITLE_ID}
          title="Cada commit se clasifica solo, sin que nadie tenga que opinar sobre el avance."
          description="Define los dominios de tu proyecto — los que tú quieras, no una taxonomía impuesta. Pemie clasifica la ingesta automáticamente y el avance por dominio se calcula solo."
        />
        <Card padding="none" className="divide-y divide-line-100 p-5 font-mono text-body-sm">
          {DEMO_COMMITS.map((c) => (
            <div key={c.sha} className="flex items-center justify-between gap-3 px-2.5 py-3">
              <span className="text-ink-600">
                {c.sha}&nbsp;&nbsp;<span className="text-ink-900">{c.message}</span>
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
