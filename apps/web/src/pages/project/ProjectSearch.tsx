import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, analyticsFailureReason, ApiError, type SearchHit } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryClient.js";
import { track } from "../../lib/analytics/index.js";
import { Badge, Button, EmptyState, ErrorText, Input, Modal, SkeletonList } from "../../components/ui.js";
import { useTranslation } from "react-i18next";

/** Subconjunto de TabId (Project.tsx) que puede recibir un resultado de búsqueda. */
type ProjectTabId = "commits" | "reports" | "stories" | "board" | "leaderboard" | "activity";

const TYPE_ORDER: SearchHit["type"][] = ["story", "commit", "note", "card"];

const TAB_BY_TYPE: Record<SearchHit["type"], ProjectTabId> = {
  story: "stories",
  commit: "commits",
  note: "reports",
  card: "board",
};

export default function ProjectSearch({
  ws,
  proj,
  onNavigateToTab,
}: {
  ws: string;
  proj: string;
  onNavigateToTab: (tab: ProjectTabId) => void;
}) {
  const { t } = useTranslation("search");
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(rawQuery), 300);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Atajo scoped a esta página: solo funciona con el proyecto montado, no es un
  // command palette global de la app.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const trimmedQuery = debouncedQuery.trim();
  const searchQuery = useQuery({
    queryKey: queryKeys.search(ws, proj, trimmedQuery),
    queryFn: () => api.search.query(ws, proj, { q: trimmedQuery }).then((r) => r.hits),
    enabled: open && trimmedQuery.length >= 2,
  });

  useEffect(() => {
    if (searchQuery.isError) {
      track("project_search_failed", { reason: analyticsFailureReason(searchQuery.error) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery.isError, searchQuery.error]);

  function closeAndReset() {
    setOpen(false);
    setRawQuery("");
    setDebouncedQuery("");
  }

  function handleHitClick(hit: SearchHit) {
    track("project_search_used", { result_type: hit.type });
    onNavigateToTab(TAB_BY_TYPE[hit.type]);
    closeAndReset();
  }

  // El debounce corriendo (rawQuery ≠ debouncedQuery) cuenta como "pendiente" para
  // no mostrar "sin resultados" mientras la persona todavía está tipeando.
  const pending = rawQuery !== debouncedQuery && rawQuery.trim().length >= 2;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("search")}
      </Button>

      {open && (
        <Modal title={t("title")} onClose={closeAndReset} size="lg">
          <div className="space-y-4">
            <Input
              autoFocus
              placeholder={t("placeholder")}
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              aria-label={t("search")}
            />

            {pending || ((searchQuery.isLoading || searchQuery.isFetching) && trimmedQuery.length >= 2) ? (
              <SkeletonList rows={4} />
            ) : trimmedQuery.length < 2 ? (
              <EmptyState compact title={t("minChars")} />
            ) : searchQuery.isError ? (
              <ErrorText>
                {searchQuery.error instanceof ApiError ? searchQuery.error.message : t("failed")}
              </ErrorText>
            ) : (searchQuery.data ?? []).length === 0 ? (
              <EmptyState
                title={t("noResults", { query: trimmedQuery })}
                description={t("tryOther")}
              />
            ) : (
              <div className="space-y-4">
                {TYPE_ORDER.map((type) => {
                  const hits = (searchQuery.data ?? []).filter((h) => h.type === type);
                  if (hits.length === 0) return null;
                  return (
                    <div key={type}>
                      <h4 className="mb-1.5 text-body-sm font-semibold text-ink-800">{t(type)}</h4>
                      <div className="divide-y divide-line-100">
                        {hits.map((hit) => (
                          <button
                            key={hit.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-sm px-1 py-2 text-left transition-colors hover:bg-surface-50"
                            onClick={() => handleHitClick(hit)}
                          >
                            {hit.ref && (
                              <Badge tone="neutral" mono>
                                {hit.ref}
                              </Badge>
                            )}
                            <span className="min-w-0 flex-1 truncate text-body text-ink-900">{hit.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
