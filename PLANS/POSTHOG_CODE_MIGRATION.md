# Corte de analítica: cambian los valores de `code`

Nota de despliegue para el refactor de `ErrorCode` (commit `c92d78e`). **Leer antes de mergear.**

## Qué pasa

Los tres codes `forbidden`, `not_found` y `unauthorized` **dejan de existir**. No es que algunos
filtros pierdan eventos: cualquier insight, dashboard o alerta que filtre por esos tres valores
va a coincidir con **cero** desde el despliegue.

Antes, 78 call sites compartían esos 3 codes para 47 mensajes distintos. Ahora cada uno tiene
el suyo, así que la analítica gana granularidad real — pero a costa de romper lo que ya estaba
apuntando a los valores viejos.

## Por dónde llega a PostHog

`apps/web/src/lib/api.ts` → `analyticsFailureReason(err)` devuelve `err.code` y se manda como
la propiedad **`reason`** de los eventos `*_failed`.

**21 invocaciones** en el frontend, repartidas en estos **20 eventos**:

```
agent_deleted_failed              project_created_failed        story_delete_failed
agent_presence_blocked_failed     project_search_failed         story_update_failed
agent_presence_unblocked_failed   report_note_answered_failed   user_logged_in_failed
agent_registered_failed           report_note_created_failed    user_signed_up_failed
api_key_created_failed            report_objective_set_failed   workspace_created_failed
board_card_created_failed         story_created_failed          workspace_member_invited_failed
board_card_deleted_failed         invite_accepted_failed
```

> Los dos `agent_presence_*` se emiten desde un ternario
> (`track(blocked ? … : …, { reason })`, `Workspace.tsx:642`), así que no aparecen en una
> búsqueda por `track("nombre"`. Son justamente los que pueden llevar
> `agent_presence_blocked` y `agent_not_found` después del split.

Además hay **2 eventos server-side** con la misma propiedad `reason`
(`telegram_link_started_failed` y `telegram_llm_key_set_failed`, en `services/channels.ts`),
que no pasan por `analyticsFailureReason` pero conviene mirar si hay insights sobre ellos.

## Mapeo viejo → nuevo

### `unauthorized` → 4 codes

`api_key_expired` · `invalid_api_key` · `invalid_credentials` · `not_authenticated`

> El de login de una persona es **`invalid_credentials`**; los otros tres son de API keys.
> Si tenías un embudo de login mirando `reason = "unauthorized"`, ese es el reemplazo.

### `not_found` → 19 codes

`agent_not_found` · `agent_presence_not_found` · `api_key_not_found` · `card_not_found` ·
`contributor_not_found` · `download_token_not_found` · `github_repo_not_found` ·
`invalid_invitation` · `invitation_not_found` · `member_not_found` · `note_not_found` ·
`project_not_found` · `repo_not_found` · `report_not_found` · `skill_not_found` ·
`story_not_found` · `upload_ticket_not_found` · `user_not_found` · `workspace_not_found`

### `forbidden` → 26 codes

`agent_presence_blocked` · `api_key_missing_permission` · `api_key_missing_scope` ·
`api_key_no_owner` · `api_key_no_project` · `api_key_no_workspace` · `api_key_project_pinned` ·
`api_key_workspace_pinned` · `cannot_change_owner_role` · `cannot_remove_owner` ·
`cannot_remove_self` · `card_not_in_project` · `github_repo_forbidden` ·
`installation_not_linked` · `insufficient_workspace_role` · `invitation_email_mismatch` ·
`key_owner_not_member` · `key_owner_not_workspace_member` · `no_read_scope_for_search` ·
`not_workspace_member` · `note_not_in_project` · `project_not_in_key_workspace` ·
`read_scope_requires_viewer` · `story_not_in_project` · `workspace_not_accessible` ·
`write_scope_requires_member`

> `read_scope_requires_viewer` y `write_scope_requires_member` salen de un ternario
> (`agents.ts:579`), así que tampoco aparecen buscando `forbidden("`. Son el chequeo de rol
> del dueño de una API key.

## Qué hacer

1. **Antes de mergear**: buscar en PostHog insights, dashboards y alertas que filtren
   `reason` por `forbidden`, `not_found` o `unauthorized`. Son los que se rompen.
2. **Reemplazar el filtro** por el conjunto de codes de la tabla de arriba (PostHog acepta
   `reason IN (...)`), o dejarlo apuntando solo al caso concreto que interesaba medir —
   que probablemente sea lo que se quería desde el principio.
3. **Los históricos no se tocan**: los eventos ya guardados conservan el valor viejo. Un
   dashboard que cruce el despliegue va a mostrar un escalón. Vale anotar la fecha de
   despliegue como marca en los gráficos afectados.

## Lo que NO cambia

Los ~119 call sites que ya pasaban un code explícito (`already_member`, `invalid_email`,
`weak_password`, `email_taken`, …) conservan su valor. Solo se rompen los tres colapsados.

Los codes nuevos de webhooks (`invalid_webhook_signature`, `invalid_telegram_secret`) tampoco
entran acá: no pasan por `analyticsFailureReason`, así que no llegan a PostHog. Están listados
solo para que nadie tome estas tablas como el inventario completo de 401 de la API.
