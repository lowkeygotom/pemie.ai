// Lectura de commits desde la REST de GitHub. El endpoint y la normalización son
// idénticos para los dos tipos de credencial que maneja el producto —el access
// token OAuth del usuario y el installation token de la GitHub App— así que la
// llamada vive aquí y cada cliente (github-oauth / github-app) aporta su token.

const API = "https://api.github.com";
const UA = "pemie.ai";

export interface NormalizedCommit {
  sha: string;
  message: string;
  committedAt: Date;
  login: string | null;
  authorName: string | null;
  avatarUrl: string | null;
}

/**
 * Error de la API de GitHub con su status, para que la capa de servicios pueda
 * traducirlo a un error de dominio con mensaje accionable (token vencido, sin
 * acceso al repo, repo vacío…) en vez de un 500 opaco.
 */
export class GithubApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

/** Máximo de páginas por sincronización: cota superior al histórico que traemos. */
const MAX_PAGES = 5;
const PER_PAGE = 100;

/**
 * Trae commits de la rama por defecto de un repo, paginando hasta `MAX_PAGES`.
 * `since` limita a commits posteriores a esa fecha (sincronización incremental);
 * sin él trae el histórico reciente hasta agotar las páginas.
 */
export async function fetchCommitsWithToken(
  accessToken: string,
  owner: string,
  name: string,
  since?: Date
): Promise<NormalizedCommit[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const all: NormalizedCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    // `owner` y `name` van codificados: sin eso, `new URL` normaliza los `..`
    // que traigan y la petición acaba en otro endpoint de la API de GitHub —
    // con esta misma credencial.
    const url = new URL(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`
    );
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    if (since) url.searchParams.set("since", since.toISOString());

    const res = await fetch(url, { headers });
    // 409 = repositorio sin commits todavía. No es un fallo: no hay nada que traer.
    if (res.status === 409) return all;
    if (!res.ok) {
      throw new GithubApiError(res.status, `GitHub commits ${owner}/${name}: ${res.status}`);
    }

    const data = (await res.json()) as {
      sha: string;
      commit: { message: string; author: { name: string | null; date: string } | null };
      author: { login: string; avatar_url: string } | null;
    }[];

    all.push(
      ...data.map((c) => ({
        sha: c.sha,
        message: c.commit?.message ?? "",
        committedAt: c.commit?.author?.date ? new Date(c.commit.author.date) : new Date(),
        login: c.author?.login ?? null,
        authorName: c.commit?.author?.name ?? null,
        avatarUrl: c.author?.avatar_url ?? null,
      }))
    );

    if (data.length < PER_PAGE) break; // última página
  }
  return all;
}
