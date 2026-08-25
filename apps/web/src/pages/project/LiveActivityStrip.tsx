// PEM-56: "quién está trabajando ahora" vive en el header del proyecto, no en
// el tab de Overview — el momento en que más importa saberlo es antes de tocar
// Board o Stories, no mirando el dashboard. Por eso el widget se planta acá y
// se queda visible sin importar en qué tab esté parada la persona.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentActivity } from "@pemie/shared";
import { api } from "../../lib/api.js";
import { queryKeys, STALE_TIME } from "../../lib/queryClient.js";
import { Avatar, Badge, Notice, Popover, Skeleton } from "../../components/ui.js";
import { formatRelativeTime } from "../../lib/dates.js";

const MAX_VISIBLE_BUBBLES = 4;

function activityIdentity(activity: AgentActivity): string {
  return activity.contributor?.name || activity.contributor?.githubLogin || activity.owner?.name || activity.agent?.name || activity.ownerUserId || activity.agentId || activity.apiKeyId;
}

function activitiesOverlap(left: AgentActivity, right: AgentActivity): boolean {
  if (left.userStoryId && left.userStoryId === right.userStoryId) return true;
  if (left.cardId && left.cardId === right.cardId) return true;
  return left.paths.some((path) => right.paths.some((otherPath) => {
    const a = path.replace(/\/$/, "");
    const b = otherPath.replace(/\/$/, "");
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  }));
}

function ActivityBubble({ activity, identity, overlap }: { activity: AgentActivity; identity: string; overlap: boolean }) {
  const { t } = useTranslation("agents");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isIdle = activity.status === "idle";
  const isBlocked = activity.state === "blocked";
  // El anillo respira solo si hay señal fresca: es la jerarquía primaria del
  // widget, no un adorno, así que idle se apaga en vez de seguir pulsando.
  const ring = isIdle ? "ring-line-200" : isBlocked ? "ring-amber-600" : "ring-blue-600";
  const label = overlap ? `${identity} — ${t("overlapWarning")}` : identity;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={identity}
        className="relative block rounded-md focus:shadow-focus focus:outline-none"
      >
        <Avatar label={identity} imageUrl={activity.contributor?.avatarUrl ?? activity.owner?.avatarUrl} size="sm" />
        <span
          aria-hidden
          className={`pointer-events-none absolute -inset-0.5 rounded-md ring-2 ${ring} ${
            isIdle ? "opacity-40" : "animate-pulse motion-reduce:animate-none"
          }`}
        />
        {overlap ? (
          <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-pill bg-amber-600 ring-2 ring-surface-0" />
        ) : null}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} align="end">
        <div className="flex items-start gap-3">
          <Avatar label={identity} imageUrl={activity.contributor?.avatarUrl ?? activity.owner?.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-body font-semibold text-ink-900">{identity}</span>
              <Badge tone={isIdle ? "neutral" : isBlocked ? "warning" : "brand"} dot={!isIdle}>
                {t(`activityStatus.${activity.status}`)}
              </Badge>
              {isBlocked ? <Badge tone="warning">{t("blocked")}</Badge> : null}
            </div>
            <p className="mt-1 text-body-sm text-ink-500">{activity.summary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-caption text-ink-400">
              {activity.userStory ? <Badge tone="neutral" mono>{activity.userStory.key}</Badge> : null}
              <span>{isIdle ? t("seenAgo", { time: formatRelativeTime(activity.lastSeenAt) }) : formatRelativeTime(activity.lastSeenAt)}</span>
            </div>
            {overlap ? (
              <div className="mt-2">
                <Notice tone="warning">{t("overlapWarning")}</Notice>
              </div>
            ) : null}
          </div>
        </div>
      </Popover>
    </div>
  );
}

/** El resto no entra en la fila: un chip "+N" con la lista compacta atrás. */
function OverflowBubble({ activities }: { activities: AgentActivity[] }) {
  const { t } = useTranslation("agents");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("liveCount", { count: activities.length })}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-100 font-mono text-caption font-semibold text-ink-600 transition-colors hover:bg-surface-200 focus:shadow-focus focus:outline-none"
      >
        +{activities.length}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} align="end">
        <div className="space-y-3">
          {activities.map((activity) => {
            const identity = activityIdentity(activity);
            const isIdle = activity.status === "idle";
            return (
              <div key={activity.id} className="flex items-center gap-2.5">
                <Avatar label={identity} imageUrl={activity.contributor?.avatarUrl ?? activity.owner?.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <span className={`block truncate text-body-sm font-medium ${isIdle ? "text-ink-500" : "text-ink-900"}`}>{identity}</span>
                  <span className="block truncate text-caption text-ink-400">{activity.summary}</span>
                </div>
                <Badge tone={isIdle ? "neutral" : activity.state === "blocked" ? "warning" : "brand"} dot={!isIdle}>
                  {t(`activityStatus.${activity.status}`)}
                </Badge>
              </div>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

export default function LiveActivityStrip({ ws, proj }: { ws: string; proj: string }) {
  const activityQuery = useQuery({
    queryKey: queryKeys.agentActivity(ws, proj),
    queryFn: () => api.projects.activity(ws, proj),
    staleTime: STALE_TIME.live,
    // Único polling del producto: evita pisadas mientras alguien mira el
    // proyecto, sin depender de en qué tab esté parado (ver OverviewTab).
    refetchInterval: 20_000,
  });

  if (activityQuery.isLoading) {
    return (
      <div className="flex items-center gap-1.5" aria-hidden>
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    );
  }

  // Widget periférico del header: un error acá no debe romper la navegación
  // del proyecto, así que se apaga en silencio en vez de mostrar un banner.
  if (activityQuery.error || !activityQuery.data) return null;

  const live = activityQuery.data.live;
  if (live.length === 0) return null;

  // Prioriza señal fresca: quien tiene latido activo entra antes que idle.
  const sorted = [...live].sort((a, b) => Number(a.status === "idle") - Number(b.status === "idle"));
  const visible = sorted.slice(0, MAX_VISIBLE_BUBBLES);
  const overflow = sorted.slice(MAX_VISIBLE_BUBBLES);

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((activity) => (
        <ActivityBubble
          key={activity.id}
          activity={activity}
          identity={activityIdentity(activity)}
          overlap={live.some((other) => other.id !== activity.id && activitiesOverlap(activity, other))}
        />
      ))}
      {overflow.length > 0 ? <OverflowBubble activities={overflow} /> : null}
    </div>
  );
}
