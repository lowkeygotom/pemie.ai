import { Section, sectionTitleId } from "../components/Section.js";
import { Eyebrow } from "../../../components/ui.js";

const TITLE_ID = sectionTitleId("problema");

export function ProblemSection() {
  return (
    <Section tone="ink" titleId={TITLE_ID}>
      <div className="grid items-start gap-10 sm:grid-cols-2 sm:gap-14">
        <div>
          <Eyebrow className="mb-4 block text-accent-onink">El problema</Eyebrow>
          <h2 id={TITLE_ID} className="text-h3 leading-tight text-on-ink sm:text-h2">
            El progreso real vive en commits, issues y chats desconectados.
          </h2>
        </div>
        <div className="flex flex-col gap-5.5 text-body-lg leading-relaxed text-on-ink-soft">
          <p className="m-0 border-l-2 border-blue-600 pl-4.5">
            Los tableros mienten: se actualizan a mano, después del standup, cuando alguien se
            acuerda.
          </p>
          <p className="m-0 border-l-2 border-blue-600 pl-4.5">
            Los chatbots inventan: responden desde memoria de chat, no desde el proyecto.
          </p>
          <p className="m-0 border-l-2 border-blue-600 pl-4.5 text-on-ink">
            Pemie ancla cada informe y cada acción de agente a datos verificables del repo:
            commits, PRs y HUs reales.
          </p>
        </div>
      </div>
    </Section>
  );
}
