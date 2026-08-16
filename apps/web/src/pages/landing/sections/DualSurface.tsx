import { Card } from "../../../components/ui.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("dual-surface");

export function DualSurface() {
  return (
    <Section tone="subtle" titleId={TITLE_ID}>
      <SectionIntro
        eyebrow="Dos superficies, un dato"
        titleId={TITLE_ID}
        title="Lo que ve tu equipo es lo que lee tu agente."
        align="center"
        className="mb-10 sm:mb-14"
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card padding="none" className="p-8">
          <div className="mb-4 font-mono text-body-sm text-ink-600">personas · app web</div>
          <h3 className="mb-4 text-h4 text-ink-900">Para quien pregunta "¿cómo vamos?"</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-body text-ink-600">
            <Bullet dot="text-blue-600">Objetivo e informes de avance por dominio</Bullet>
            <Bullet dot="text-blue-600">Historias de usuario y Kanban</Bullet>
            <Bullet dot="text-blue-600">Ingesta de commits clasificada y navegable</Bullet>
          </ul>
        </Card>
        <div className="rounded-lg bg-surface-ink p-8 text-on-ink">
          <div className="mb-4 font-mono text-body-sm text-on-ink-muted">agentes · MCP sobre HTTP</div>
          <h3 className="mb-4 text-h4 text-on-ink">Para quien ejecuta el trabajo</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-body text-on-ink-soft">
            <Bullet dot="text-accent-onink">Tools sobre los mismos datos: informes, HUs, commits</Bullet>
            <Bullet dot="text-accent-onink">API keys con scopes por proyecto</Bullet>
            <Bullet dot="text-accent-onink">Audit log de cada llamada</Bullet>
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Bullet({ children, dot }: { children: string; dot: string }) {
  return (
    <li className="flex gap-2.5">
      <span className={`font-bold ${dot}`}>—</span>
      {children}
    </li>
  );
}
