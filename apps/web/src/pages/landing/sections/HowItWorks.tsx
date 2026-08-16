import { DemoVideo } from "../components/DemoVideo.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";
import { HOW_IT_WORKS_STEPS } from "../data/howItWorks.js";

const TITLE_ID = sectionTitleId("como");

export function HowItWorks() {
  return (
    <Section id="como" titleId={TITLE_ID}>
      <SectionIntro
        eyebrow="Cómo funciona"
        titleId={TITLE_ID}
        title="De cero a una fuente de verdad en cuatro pasos."
        className="mb-10 sm:mb-14"
      />
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS_STEPS.map((s) => (
          <div key={s.step} className="border-t-2 border-ink-900 pt-5">
            <div className="mb-2.5 font-mono text-body-sm text-blue-600">{s.step}</div>
            <h3 className="mb-2 text-h4 text-ink-900">{s.title}</h3>
            <p className="m-0 text-body-sm leading-relaxed text-ink-600">{s.description}</p>
          </div>
        ))}
      </div>
      <div className="mt-12 sm:mt-16">
        <DemoVideo
          src="/videos/connect-to-hermes.mp4"
          label="app.pemie.ai · conectar agente"
          caption="demo real · conectar Hermes con pemie"
          ariaLabel="Video tutorial: cómo conectar Hermes con pemie, paso a paso"
        />
      </div>
    </Section>
  );
}
