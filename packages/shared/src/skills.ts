// Catálogo de skills por proyecto (docs/skills-catalog.md): un agente publica
// el contenido canónico de una skill y otro agente (o persona) la instala en
// su runtime eligiendo destino. Runtime-agnóstico: sin imports de Node ni del
// navegador — tanto el servicio (Node) como la web (browser) comparten esto.

export const SKILL_TARGETS = ["cursor", "claude", "codex", "generic"] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

export const SKILL_DESTINATIONS = ["project", "user"] as const;
export type SkillDestination = (typeof SKILL_DESTINATIONS)[number];

/** rootPath por target × destination. Los `~` los resuelve el agente local, no el servidor. */
export const SKILL_ROOT_PREFIX: Record<SkillTarget, Record<SkillDestination, string>> = {
  cursor: { project: ".cursor/skills", user: "~/.cursor/skills" },
  claude: { project: ".claude/skills", user: "~/.claude/skills" },
  codex: { project: ".codex/skills", user: "~/.codex/skills" },
  generic: { project: ".pemie/skills", user: "~/.pemie/skills" },
};

export function resolveSkillRootPath(
  target: SkillTarget,
  destination: SkillDestination,
  slug: string
): string {
  return `${SKILL_ROOT_PREFIX[target][destination]}/${slug}`;
}

/** Archivo canónico de una skill; `path` es relativo al paquete (SKILL.md, assets/…). */
export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillSummary<TDate = string> {
  slug: string;
  name: string;
  description: string;
  version: number;
  publishedByType: "user" | "agent";
  updatedAt: TDate;
}

export interface SkillInstallPackage<TDate = string> extends SkillSummary<TDate> {
  install: {
    target: SkillTarget;
    destination: SkillDestination;
    rootPath: string;
    files: SkillFile[];
  };
  availableTargets: readonly SkillTarget[];
}

export const SKILL_MAX_TOTAL_BYTES = 512 * 1024;
export const SKILL_MAX_FILES = 50;
export const SKILL_ENTRY_FILE = "SKILL.md";

const SKILL_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** kebab-case, sin mayúsculas ni guiones dobles/finales. */
export function isValidSkillSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 100 && SKILL_SLUG_RE.test(slug);
}

/**
 * `path` de archivo de skill seguro para escribir bajo `rootPath` en el disco
 * de quien instala: relativo, sin `..`, sin raíz absoluta (`/` o `~`) ni
 * backslashes. Es la única defensa antes de esa escritura, así que se aplica
 * tanto al publicar como al servir el paquete instalable — un dato que llegó
 * a la fila por otra vía (seed, migración) no debe poder escapar el directorio
 * de destino tampoco al leerlo.
 */
export function isSafeSkillFilePath(path: string): boolean {
  if (!path || path.trim() !== path) return false;
  if (path.startsWith("/") || path.startsWith("~") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}
