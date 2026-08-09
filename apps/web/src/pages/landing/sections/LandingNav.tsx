import { Link } from "react-router-dom";
import { GithubIcon, LogoMark, Wordmark } from "../../../components/ui.js";

const LINKS = [
  { href: "#como", label: "Cómo funciona" },
  { href: "#mcp", label: "MCP" },
  { href: "#telegram", label: "Telegram" },
];

export function LandingNav({ githubUrl }: { githubUrl: string }) {
  return (
    <div className="border-b border-line-200 bg-surface-0">
      <nav className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-6 px-4 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark size={24} />
          <Wordmark />
        </Link>
        <div className="flex flex-wrap items-center gap-7">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-body-sm text-ink-600 hover:text-ink-900">
              {l.label}
            </a>
          ))}
          <a
            href={githubUrl}
            className="inline-flex items-center gap-2 rounded-sm bg-ink-900 px-3.5 py-2 text-body-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-600"
          >
            <GithubIcon /> Continuar con GitHub
          </a>
        </div>
      </nav>
    </div>
  );
}
