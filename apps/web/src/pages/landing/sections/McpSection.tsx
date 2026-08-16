import { DemoVideo } from "../components/DemoVideo.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";

const TITLE_ID = sectionTitleId("mcp");
const SCOPES = ["reports:read", "commits:read", "stories:write"];
const AUDIT_LINES = [
  "audit · tl-cursor · get_evaluation · reports:read · 09:41",
  "audit · tl-cursor · update_user_story HU-12 · stories:write · 09:44",
];

export function McpSection() {
  return (
    <Section id="mcp" tone="ink" titleId={TITLE_ID}>
      <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
        <div>
          <SectionIntro
            eyebrow="Agente (MCP)"
            titleId={TITLE_ID}
            title="Cada agente entra con los permisos exactos que le diste."
            description="MCP sobre HTTP: apunta Cursor o Hermes al endpoint, pega tu key y listo. Cada key tiene scopes por proyecto y cada llamada queda en el audit log."
            onInk
            className="mb-5"
          />
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 font-mono text-body-sm text-on-ink-code">
            <li>
              {SCOPES.map((s, i) => (
                <span key={s}>
                  {i > 0 ? " · " : ""}
                  <span className="text-accent-onink">{s}</span>
                </span>
              ))}
            </li>
            <li className="text-on-ink-muted">Cada key opera solo con los scopes que le diste.</li>
          </ul>
        </div>
        <div className="overflow-hidden rounded-lg border border-line-onink bg-surface-ink-deep">
          <div className="border-b border-line-onink px-4.5 py-3 font-mono text-caption text-on-ink-muted">
            mcp.json
          </div>
          <pre className="m-0 overflow-x-auto px-6 py-5 font-mono text-body-sm leading-loose text-on-ink-code">
{`{
  `}<span className="text-accent-onink">"pemie"</span>{`: {
    `}<span className="text-accent-onink">"url"</span>{`: `}<span className="text-code-string">"https://mcp.pemie.ai"</span>{`,
    `}<span className="text-accent-onink">"headers"</span>{`: {
      `}<span className="text-accent-onink">"Authorization"</span>{`: `}<span className="text-code-string">"Bearer pm_sk_…"</span>{`
    }
  }
}`}
          </pre>
          <div className="border-t border-line-onink px-6 py-4 font-mono text-caption leading-loose text-on-ink-muted">
            {AUDIT_LINES.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-12 sm:mt-16">
        <DemoVideo
          src="/videos/hermie.mp4"
          label="hermes · mcp.pemie.ai"
          caption="caso real · Hermes conectado a pemie"
          ariaLabel="Video: caso de uso real con Hermes ya conectado a pemie por MCP"
          onInk
        />
      </div>
    </Section>
  );
}
