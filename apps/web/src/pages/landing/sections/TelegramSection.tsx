import { Card } from "../../../components/ui.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("telegram");
const PROJECT = "atlas";

export function TelegramSection() {
  return (
    <Section id="telegram" titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <Card padding="none" className="mx-auto flex w-full max-w-[480px] flex-col gap-3.5 p-6">
          <div className="text-center font-mono text-caption text-ink-600">canal telegram · {PROJECT}</div>
          <div className="ml-auto max-w-[85%] rounded-[14px] rounded-tr-sm bg-blue-600 px-4 py-3 text-body-sm leading-relaxed text-white">
            ¿Cómo vamos con {PROJECT} esta semana?
          </div>
          <Card padding="none" className="mr-auto max-w-[88%] rounded-[14px] rounded-tl-sm px-4 py-3 text-body-sm leading-relaxed">
            Avance 74% (+6 pts). Se cerró auth con refresh tokens y CI con cache de builds. 3 HUs
            pasaron a hecho.
            <br />
            <span className="font-mono text-caption text-ink-600">
              evidencia: a41f2c9 · 7d03be1 · c9e0d12
            </span>
          </Card>
          <div className="text-center font-mono text-caption text-ink-600">
            respondido con tu key · scope reports:read
          </div>
        </Card>
        <div>
          <SectionIntro
            eyebrow="Canal Telegram · BYOK"
            titleId={TITLE_ID}
            title="El proyecto responde tus preguntas en Telegram."
            description="Trae tu propia key — Anthropic, OpenAI o DeepSeek — y el canal responde con datos del proyecto, con los scopes que tú definas. Tu modelo, tus límites, tu factura."
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
