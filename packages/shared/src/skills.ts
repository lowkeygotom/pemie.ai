// Catálogo de skills por workspace (docs/skills-catalog.md): un agente publica
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

export interface SkillFileManifestEntry {
  path: string;
  bytes: number;
}

export interface SkillSummary<TDate = string> {
  slug: string;
  name: string;
  description: string;
  version: number;
  publishedByType: "user" | "agent";
  updatedAt: TDate;
}

/**
 * Paquete instalable. `files` solo viaja inline si `totalBytes <= SKILL_INLINE_MAX_BYTES`;
 * si no, el agente baja el tar.gz con `downloadUrl`/`command`.
 */
export interface SkillInstallPackage<TDate = string> extends SkillSummary<TDate> {
  install: {
    target: SkillTarget;
    destination: SkillDestination;
    rootPath: string;
    manifest: SkillFileManifestEntry[];
    totalBytes: number;
    files?: SkillFile[];
    downloadUrl?: string;
    /** `curl -sL "$URL" | tar xz -C <rootPath>` listo para el shell del agente. */
    command?: string;
  };
  availableTargets: readonly SkillTarget[];
}

/** Ticket de upload que devuelve `publish_skill`: el contenido viaja fuera del tool call. */
export interface SkillUploadTicket {
  uploadUrl: string;
  expiresAt: string;
  /** `COPYFILE_DISABLE=1 tar czf - -C <dir> <slug> | curl --upload-file - "$UPLOAD_URL"` listo para el shell. */
  command: string;
  slug: string;
  name: string;
  description: string;
}

// impeccable ≈ 3.2 MB / 147 archivos: margen por encima de ese caso real.
export const SKILL_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const SKILL_MAX_FILES = 500;
export const SKILL_MAX_FILE_BYTES = 1 * 1024 * 1024;
/** Por debajo de este umbral, get_skill puede devolver files inline. */
export const SKILL_INLINE_MAX_BYTES = 64 * 1024;
export const SKILL_UPLOAD_TTL_MS = 15 * 60 * 1000;
/** TTL del token de descarga (multi-uso dentro de la ventana). */
export const SKILL_DOWNLOAD_TTL_MS = 15 * 60 * 1000;
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
