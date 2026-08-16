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
  return (
    <Section id="informes" tone="subtle" titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <Card padding="none" className="p-7">
          <div className="mb-4.5 flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-bold text-h4 text-ink-900">Informe · semana 31</span>
            <span className="font-mono text-caption text-ink-600">proyecto {PROJECT}</span>
          </div>
          <div className="mb-2 flex justify-between text-body-sm text-ink-600">
            <span>Avance hacia el objetivo</span>
            <span className="font-mono font-semibold text-ink-900">{PROGRESS}%</span>
          </div>
          <div className="mb-5 h-2 overflow-hidden rounded-sm bg-line-200">
            <div
              className="h-full rounded-sm bg-blue-600 transition-[width] duration-500"
              style={{ width: `${PROGRESS}%` }}
            />
          </div>
          <p className="m-0 mb-3.5 text-body-sm leading-relaxed text-ink-900">
            El dominio <strong>api</strong> avanzó de {PREV_PROGRESS}% a {PROGRESS}% esta semana:
            se cerró la autenticación con refresh tokens y quedó desbloqueada la HU de sesiones.
          </p>
          <div className="font-mono text-caption text-ink-600">
            evidencia:{" "}
            {EVIDENCE.map((sha, i) => (
              <span key={sha}>
                {i > 0 ? " · " : ""}
                <a href="#informes">{sha}</a>
              </span>
            ))}
          </div>
        </Card>
        <SectionIntro
          eyebrow="Objetivo e informes"
          titleId={TITLE_ID}
          title="Informes con evidencia, no con adjetivos."
          description="Cada informe de avance cita los commits y las HUs que lo respaldan. El objetivo del proyecto es el norte; la evidencia, el mapa. Nadie discute contra un hash."
        />
      </div>
      <div className="mt-12 sm:mt-16">
        <DemoVideo
          src="/videos/report-full.mp4"
          label="app.pemie.ai · informe semanal"
          caption="caso real · un informe completo, de principio a fin"
          ariaLabel="Video: informe completo de avance generado en pemie"
        />
      </div>
    </Section>
  );
}
