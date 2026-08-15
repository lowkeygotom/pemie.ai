import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import {
  Badge,
  Card,
  EmptyState,
  ErrorText,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  Stat,
} from "../../components/ui.js";

/** Actividad de alcance proyecto; la conexión y los agentes viven ahora en Equipo. */
export default function AgentTab({ ws, proj }: { ws: string; proj: string }) {
  const reliabilityQuery = useQuery({
    queryKey: queryKeys.agentReliability(ws, proj),
    queryFn: () => api.projects.agentReliability(ws, proj),
    staleTime: STALE_TIME.moderate,
  });
  const auditQuery = useQuery({
    queryKey: queryKeys.projectAudit(ws, proj),
    queryFn: () => api.audit.listForProject(ws, proj).then((r) => r.auditLogs),
    staleTime: STALE_TIME.moderate,
  });

  const logs = auditQuery.data ?? [];
  const reliability = reliabilityQuery.data;
  const reliabilityError =
    reliabilityQuery.error instanceof ApiError
      ? reliabilityQuery.error.message
      : reliabilityQuery.error
        ? "No se pudo cargar la confiabilidad de agentes"
        : null;
  const auditError =
    auditQuery.error instanceof ApiError
      ? auditQuery.error.message
      : auditQuery.error
        ? "No se pudo cargar la actividad"
        : null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-h4 text-ink-900">Acciones de agente que quedan en pie</h3>
        <p className="mt-1 text-body-sm text-ink-500">
          Qué proporción de movimientos y asignaciones de agente una persona no deshizo. Un humano
          que sigue el flujo no cuenta como corrección.
        </p>
        <div className="mt-4">
          <ErrorText>{reliabilityError}</ErrorText>
          {reliabilityQuery.isLoading ? (
            <SkeletonStats count={3} />
          ) : reliability && reliability.survivalRate === null ? (
            <EmptyState
              title="Todavía no hay acciones de agente para medir"
              description="Cuando un agente mueva o asigne tarjetas y pase el período de asentamiento, acá vas a ver qué proporción queda en pie. La actividad solo humana no infla este número."
            />
          ) : reliability && reliability.survivalRate != null ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <Stat
                  value={`${Math.round(reliability.survivalRate * 100)}%`}
                  label="Tasa de supervivencia"
                  delta={
                    reliability.revertedActions > 0
                      ? `${reliability.revertedActions} revertida${reliability.revertedActions === 1 ? "" : "s"}`
                      : undefined
                  }
                  deltaTone="danger"
                />
              </Card>
              <Card>
                <Stat value={reliability.agentActions} label="Acciones analizadas" />
              </Card>
              <Card>
                <Stat value={`${reliability.windowDays}d`} label="Ventana usada" />
              </Card>
            </div>
          ) : null}
        </div>
      </section>

      <ErrorText>{auditError}</ErrorText>
      {auditQuery.isLoading ? (
        <Card>
          <Skeleton className="mb-4 h-5 w-48" />
          <SkeletonList rows={4} />
        </Card>
      ) : (
        <Card>
          <h3 className="text-h4 text-ink-900">Actividad del proyecto</h3>
          <p className="mt-2 text-body-sm text-ink-600">
            Audit de las acciones hechas por personas, agentes y API keys en este proyecto.
          </p>
          <div className="mt-4">
            {logs.length === 0 ? (
              <EmptyState
                title="Sin actividad"
                description="Las acciones del proyecto aparecerán aquí."
              />
            ) : (
              <>
                <div className="divide-y divide-line-100">
                  {logs.slice(0, 50).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between -mx-6 px-6 py-2.5 hover:bg-surface-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge tone={log.actorType === "agent" ? "brand" : "neutral"} dot>
                          {log.actorType}
                        </Badge>
                        <span className="truncate text-body-sm text-ink-700">{log.actorName}</span>
                        <code className="truncate font-mono text-caption text-ink-700">
                          {log.action}
                        </code>
                      </span>
                      <span className="shrink-0 font-mono text-caption text-ink-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                {logs.length > 50 ? (
                  <p className="mt-3 text-caption text-ink-400">
                    Mostrando los 50 más recientes de {logs.length}.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
