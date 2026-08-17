import { Wordmark } from "../../../components/ui.js";
import { useTranslation } from "react-i18next";

const LINKS = [
  { href: "#como", key: "nav.howItWorks" },
  { href: "#mcp", key: "nav.mcp" },
  { href: "#telegram", key: "nav.telegram" },
  { href: "#empezar", key: "footer.start" },
];

export function LandingFooter() {
  const { t } = useTranslation("landing");
  return (
    <footer className="border-t border-line-200 bg-surface-0 px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-5">
        <Wordmark />
        <div className="flex flex-wrap gap-6 text-body-sm">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-ink-600 hover:text-ink-900">
              {t(l.key)}
            </a>
          ))}
        </div>
        <div className="font-mono text-caption text-ink-600">© 2026 pemie.ai</div>
      </div>
    </footer>
  );
}
