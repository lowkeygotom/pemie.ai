import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from "@pemie/shared";
import {
  api,
  ApiError,
  type GithubUserRepo,
  type Project,
  type SyncResult,
} from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Input,
  Notice,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonList,
  Stat,
} from "../../components/ui.js";
import DomainConfigEditor from "./DomainConfigEditor.js";

const DATE_PRESETS = [
  { value: "", label: "Todo" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
];

/**
 * Inicio (UTC) del día que abre la ventana del preset.
 *
 * El redondeo al día no es cosmético: este valor alimenta la query key del
 * listado de commits, y un `Date.now()` con precisión de milisegundos daba una
 * key distinta en cada render — cache miss, refetch, render, y otra vez, en un
 * bucle que no paraba mientras hubiera un preset de fecha activo. Al día, la
 * key solo cambia cuando cambia el día.
 */
function presetToSince(preset: string): string | undefined {
  if (!preset) return undefined;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Number(preset));
  return start.toISOString();
}

/**
 * Último auto-sync por proyecto (`ws/proj`), en epoch ms. Vive a nivel de módulo
 * y no en un `useRef`: salir del tab y volver remonta el componente, y con un ref
 * el guard nacería vacío y repetiría el sync —con su llamada a GitHub— en cada
 * cambio de pestaña. La ventana coincide con el `STALE_AFTER_MS` del backend:
 * antes de eso el modo `auto` no tiene nada que traer, y después vuelve a valer
 * la pena, así una sesión larga no se queda sin sincronizar para siempre.
 */
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const lastAutoSyncAt = new Map<string, number>();

export default function CommitsTab({ ws, proj, project }: { ws: string; proj: string; project: Project }) {
  const queryClient = useQueryClient();
  const [domainConfig, setDomainConfig] = useState<DomainConfig | null>(project.domainConfig);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [contributorFilter, setContributorFilter] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Sincronización manual con GitHub (usa el token OAuth de la sesión).
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Selector de repos de GitHub
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  const commitsFilter = useMemo(() => {
    const since = presetToSince(datePreset);
    return {
      limit: 50,
      ...(domainFilter ? { domain: domainFilter } : {}),
      ...(contributorFilter ? { contributorId: contributorFilter } : {}),
      ...(since ? { since } : {}),
    };
  }, [domainFilter, contributorFilter, datePreset]);

  const reposQuery = useQuery({
    queryKey: queryKeys.repos(ws, proj),
    queryFn: () => api.repos.list(ws, proj).then((r) => r.repos),
    staleTime: STALE_TIME.slow,
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.stats(ws, proj),
    queryFn: () => api.stats.get(ws, proj).then((r) => r.stats),
    staleTime: STALE_TIME.slow,
  });
  const commitsQuery = useQuery({
    queryKey: queryKeys.commits(ws, proj, commitsFilter),
    queryFn: () => api.commits.list(ws, proj, commitsFilter).then((r) => r.commits),
    staleTime: STALE_TIME.slow,
  });
  const repos = reposQuery.data ?? [];
  const stats = statsQuery.data ?? null;
  const commits = commitsQuery.data ?? [];
  const loading = reposQuery.isLoading || statsQuery.isLoading;
  const loadError = reposQuery.error ?? statsQuery.error ?? commitsQuery.error;
  const error =
    actionError ?? (loadError ? (loadError instanceof ApiError ? loadError.message : "Error cargando la ingesta") : null);

  const resolvedConfig = domainConfig ?? DEFAULT_DOMAIN_CONFIG;
  const labelByKey = useMemo(() => {
    const map = new Map(resolvedConfig.categories.map((c) => [c.key, c]));
    return map;
  }, [resolvedConfig]);

  /** Invalida todo lo que un sync/link/unlink puede afectar: repos, stats y commits (cualquier filtro). */
  function invalidateIngestData() {
    queryClient.invalidateQueries({ queryKey: queryKeys.repos(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats(ws, proj) });
    queryClient.invalidateQueries({ queryKey: queryKeys.commitsAll(ws, proj) });
  }

  // Al cambiar de proyecto, los filtros del anterior no aplican (contributorId
  // y domain son específicos de cada proyecto) y la config de dominio ya llega
  // fresca en `project` — no hace falta pedirla de nuevo.
  useEffect(() => {
    setDomainFilter(null);
    setContributorFilter(null);
    setDatePreset("");
    setDomainConfig(project.domainConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, proj]);

  // Abrir la pestaña sincroniza sola: lo que ya hay se pinta al instante desde
  // la caché y en segundo plano se trae lo nuevo de GitHub. La marca de tiempo
  // cubre el doble montaje de StrictMode y las vueltas a este tab, sin dejar la
  // sesión sin sincronizar cuando la app queda abierta mucho rato.
  useEffect(() => {
    const key = `${ws}/${proj}`;
    const last = lastAutoSyncAt.get(key);
    if (last !== undefined && Date.now() - last < AUTO_SYNC_INTERVAL_MS) return;
    lastAutoSyncAt.set(key, Date.now());
    void autoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, proj]);

  /**
   * Sincronización silenciosa al entrar: solo molesta si trajo algo o si falló.
   * Un "no había nada nuevo" en cada visita sería ruido.
   */
  async function autoSync() {
    setSyncing(true);
    try {
      const result = await api.repos.syncAll(ws, proj, "auto");
      if (result.ingested > 0 || result.failed.length > 0) {
        setSyncResult(result);
        invalidateIngestData();
      }
    } catch {
      // Silencioso a propósito: la vista ya tiene datos y el usuario no pidió
      // esto. El botón manual sí reporta el error.
    } finally {
      setSyncing(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setActionError(null);
    setSyncResult(null);
    try {
      const result = await api.repos.syncAll(ws, proj);
      setSyncResult(result);
      invalidateIngestData();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo sincronizar con GitHub");
    } finally {
      setSyncing(false);
    }
  }

  const githubReposQuery = useQuery({
    queryKey: ["githubRepos"],
    queryFn: () => api.auth.githubRepos().then((r) => r.repos),
    enabled: picker,
    staleTime: STALE_TIME.moderate,
    retry: false,
  });
  const ghRepos = githubReposQuery.data ?? null;
  const ghLoading = githubReposQuery.isLoading;
  const ghNotConnected =
    githubReposQuery.error instanceof ApiError && githubReposQuery.error.code === "github_not_connected";

  function openPicker() {
    setPicker(true);
  }

  async function linkFromGithub(r: GithubUserRepo) {
    setLinking(r.fullName);
    setActionError(null);
    setSyncResult(null);
    try {
      // El backend hace una primera sincronización al vincular.
      const { ingested, syncError } = await api.repos.link(ws, proj, {
        owner: r.owner,
        name: r.name,
        url: r.url,
      });
      setSyncResult({
        repos: 1,
        fetched: ingested,
        ingested,
        failed: syncError ? [{ repo: r.fullName, error: syncError }] : [],
      });
      invalidateIngestData();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo vincular el repo");
    } finally {
      setLinking(null);
    }
  }

  async function unlink(id: string) {
    await api.repos.unlink(ws, proj, id).then(invalidateIngestData).catch(() => {});
  }

  function toggleDomainFilter(key: string) {
    setDomainFilter((current) => {
      const next = current === key ? null : key;
      if (next) track("commits_filter_applied", { filter_type: "domain" });
      return next;
    });
  }

  function domainBadge(key: string) {
    const cat = labelByKey.get(key);
    const label = cat ? `${cat.emoji ? `${cat.emoji} ` : ""}${cat.label}` : key;
    return label;
  }

  const linkedKeys = useMemo(
    () => new Set(repos.map((r) => `${r.owner}/${r.name}`.toLowerCase())),
    [repos]
  );
  const filtered = useMemo(() => {
    if (!ghRepos) return [];
    const q = query.trim().toLowerCase();
    return q ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(q)) : ghRepos;
  }, [ghRepos, query]);

  if (loading)
    return (
      <div className="space-y-6">
        <SkeletonStats count={3} />
        <Card>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonList rows={5} />
        </Card>
      </div>
    );

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>

      {syncResult && (
        <Notice
          tone={syncResult.failed.length > 0 ? "warning" : "success"}
          onDismiss={() => setSyncResult(null)}
        >
          {syncResult.ingested > 0
            ? `Se registraron ${syncResult.ingested} commits nuevos.`
            : syncResult.failed.length === syncResult.repos
              ? "No se pudo leer ningún repositorio."
              : "Todo al día: no había commits nuevos."}
          {syncResult.failed.length > 0 && (
            <ul className="mt-2 space-y-1">
              {syncResult.failed.map((f) => (
                <li key={f.repo}>
                  <span className="font-mono text-caption">{f.repo}</span>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <Stat value={stats.totalCommits} label="Commits totales" />
          </Card>
          <Card>
            <Stat value={stats.repoCount} label="Repositorios" />
          </Card>
          <Card>
            <p className="text-caption font-mono uppercase text-ink-500">Por dominio</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.byDomain.length === 0 && (
                <span className="text-body-sm text-ink-400">—</span>
              )}
              {stats.byDomain.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDomainFilter(d.key)}
                  className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  aria-pressed={domainFilter === d.key}
                >
                  <Badge tone={domainFilter === d.key ? "brand" : "neutral"} mono>
                    {d.emoji ? `${d.emoji} ` : ""}
                    {d.label}: {d.count}
                  </Badge>
                </button>
              ))}
            </div>
            {domainFilter && (
              <button
                type="button"
                className="mt-2 text-caption text-ink-500 underline hover:text-ink-800"
                onClick={() => setDomainFilter(null)}
              >
                Quitar filtro
              </button>
            )}
          </Card>
        </div>
      )}

      <DomainConfigEditor
        key={`${ws}/${proj}`}
        ws={ws}
        proj={proj}
        initial={domainConfig}
        onSaved={(config) => {
          setDomainConfig(config);
          // Reclasifica TODOS los commits del proyecto — hay que invalidar
          // stats y las variantes de commits sin importar el filtro activo.
          queryClient.invalidateQueries({ queryKey: queryKeys.stats(ws, proj) });
          queryClient.invalidateQueries({ queryKey: queryKeys.commitsAll(ws, proj) });
        }}
      />

      {/* Repos vinculados */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h4 text-ink-900">Repositorios vinculados</h3>
          <div className="flex flex-wrap items-center gap-2">
            {repos.length > 0 && (
              <Button variant="secondary" size="sm" onClick={sync} disabled={syncing}>
                {syncing ? "Sincronizando…" : "Sincronizar commits"}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={openPicker}>
              + Vincular repo de GitHub
            </Button>
          </div>
        </div>
        <div className="mt-4">
          {repos.length === 0 ? (
            <EmptyState
              title="Sin repositorios"
              description='Pulsa "Vincular repo de GitHub" y elige de tu lista.'
            />
          ) : (
            <div className="divide-y divide-line-100">
              {repos.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 -mx-6 px-6 py-3 hover:bg-surface-50"
                >
                  <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
                    <a
                      href={r.url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-body font-medium text-ink-900 hover:text-blue-600 hover:underline"
                    >
                      {r.owner}/{r.name}
                    </a>
                    <span className="shrink-0 font-mono text-caption text-ink-400">
                      {r._count.commits} commits
                    </span>
                  </div>
                  <Button variant="danger" size="sm" className="shrink-0" onClick={() => unlink(r.id)}>
                    Quitar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Selector de repos de GitHub */}
      {picker && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onClick={() => setPicker(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-line-200 bg-surface-0 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line-100 p-4">
              <h3 className="text-h4 text-ink-900">Tus repositorios de GitHub</h3>
              <button
                className="text-body text-ink-400 transition-colors hover:text-ink-900"
                onClick={() => setPicker(false)}
              >
                Cerrar
              </button>
            </div>

            {ghNotConnected ? (
              <div className="p-6 text-center">
                <p className="text-body-sm text-ink-600">
                  Conéctate con GitHub para ver y elegir tus repositorios.
                </p>
                <a href={api.auth.githubUrl()}>
                  <Button className="mt-4">Conectar con GitHub</Button>
                </a>
              </div>
            ) : ghLoading ? (
              <SkeletonList rows={4} className="p-3" />
            ) : (
              <>
                <div className="border-b border-line-100 p-3">
                  <Input
                    autoFocus
                    placeholder="Buscar repo…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar repositorio"
                  />
                </div>
                <div className="max-h-[55vh] divide-y divide-line-100 overflow-y-auto">
                  {filtered.length === 0 && (
                    <p className="p-4 text-body-sm text-ink-400">No hay repos que coincidan.</p>
                  )}
                  {filtered.map((r) => {
                    const already = linkedKeys.has(r.fullName.toLowerCase());
                    return (
                      <div
                        key={r.fullName}
                        className="flex items-center justify-between gap-3 p-3 hover:bg-surface-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-body font-medium text-ink-900">
                            {r.fullName}{" "}
                            {r.private && (
                              <Badge tone="neutral" mono>
                                privado
                              </Badge>
                            )}
                          </p>
                          {r.description && (
                            <p className="truncate text-body-sm text-ink-400">{r.description}</p>
                          )}
                        </div>
                        {already ? (
                          <Badge tone="success" dot>
                            vinculado
                          </Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={linking === r.fullName}
                            onClick={() => linkFromGithub(r)}
                          >
                            {linking === r.fullName ? "…" : "Vincular"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Commits */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-h4 text-ink-900">Commits recientes</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-36 shrink-0">
              <Select
                value={domainFilter ?? ""}
                onChange={(e) => {
                  const value = e.target.value || null;
                  setDomainFilter(value);
                  if (value) track("commits_filter_applied", { filter_type: "domain" });
                }}
                aria-label="Filtrar por tipo"
                className="!py-2 !text-body-sm"
              >
                <option value="">Todos los tipos</option>
                {(stats?.byDomain ?? []).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.emoji ? `${d.emoji} ` : ""}
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-36 shrink-0">
              <Select
                value={contributorFilter ?? ""}
                onChange={(e) => {
                  const value = e.target.value || null;
                  setContributorFilter(value);
                  // Nunca el nombre del autor en texto libre — solo el hecho de filtrar.
                  if (value) track("commits_filter_applied", { filter_type: "author" });
                }}
                aria-label="Filtrar por autor"
                className="!py-2 !text-body-sm"
              >
                <option value="">Todos los autores</option>
                {(stats?.byContributor ?? [])
                  .filter((c) => c.contributor)
                  .map((c) => (
                    <option key={c.contributor!.id} value={c.contributor!.id}>
                      {c.contributor!.name || c.contributor!.githubLogin}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="w-32 shrink-0">
              <Select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value);
                  if (e.target.value) track("commits_filter_applied", { filter_type: "date_preset" });
                }}
                aria-label="Filtrar por fecha"
                className="!py-2 !text-body-sm"
              >
                {DATE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            {(domainFilter || contributorFilter || datePreset) && (
              <button
                type="button"
                className="shrink-0 whitespace-nowrap text-caption text-ink-500 underline hover:text-ink-800"
                onClick={() => {
                  setDomainFilter(null);
                  setContributorFilter(null);
                  setDatePreset("");
                  track("commits_filter_cleared");
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
        <div className="mt-4">
          {commits.length === 0 && (commitsQuery.isFetching || syncing) ? (
            <SkeletonList rows={5} />
          ) : commits.length === 0 ? (
            <EmptyState
              title="Sin commits todavía"
              description={
                domainFilter || contributorFilter || datePreset
                  ? "No hay commits que coincidan con estos filtros."
                  : repos.length === 0
                    ? "Vincula un repositorio de GitHub para empezar a ver la actividad del equipo."
                    : 'Pulsa "Sincronizar commits" para traer el historial con tu cuenta de GitHub.'
              }
            />
          ) : (
            <div className="divide-y divide-line-100">
              {commits.map((c) => (
                <div key={c.id} className="flex items-start gap-3 -mx-6 px-6 py-3 hover:bg-surface-50">
                  <Badge tone="neutral" mono>
                    {domainBadge(c.domain)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink-900">{c.message.split("\n")[0]}</p>
                    <p className="mt-0.5 font-mono text-caption text-ink-400">
                      {c.contributor.githubLogin} · {c.repo.owner}/{c.repo.name} ·{" "}
                      {new Date(c.committedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <code className="font-mono text-caption text-ink-400">{c.sha.slice(0, 7)}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
