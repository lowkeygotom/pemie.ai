import { Card } from "../../../components/ui.js";
import { Section, sectionTitleId } from "../components/Section.js";
import { SectionIntro } from "../components/SectionIntro.js";
import { DEMO_KANBAN } from "../data/kanban.js";

const TITLE_ID = sectionTitleId("kanban");

export function StoriesKanban() {
  return (
    <Section titleId={TITLE_ID}>
      <SectionIntro
        eyebrow="Historias de usuario · Kanban"
        titleId={TITLE_ID}
        title="Un tablero que se actualiza con cada commit vinculado a la HU."
        description="Las HUs viven junto a los commits que las implementan. Personas y agentes las mueven por el Kanban con los mismos permisos y el mismo rastro."
        className="mb-10 max-w-narrow sm:mb-14"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {DEMO_KANBAN.map((col) => (
          <div key={col.title} className="rounded-md border border-line-200 bg-surface-50 p-3.5">
            <div className="mb-3 font-mono text-caption text-ink-600">
              {col.title} · {col.count}
            </div>
            <div className="space-y-2.5">
              {col.cards.map((card) => (
                <Card key={card.key} padding="sm" className="text-body-sm leading-snug">
                  <span className="font-mono text-caption text-blue-600">{card.key}</span>
                  <br />
                  {card.title}
                  {card.trail ? (
                    <>
                      <br />
                      <span className="font-mono text-caption text-ink-500">{card.trail}</span>
                    </>
                  ) : null}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
