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

**33 call sites** en el frontend, repartidos en estos 18 eventos:

```
agent_deleted_failed          project_created_failed        story_delete_failed
agent_registered_failed       project_search_failed         story_update_failed
api_key_created_failed        report_note_answered_failed   user_logged_in_failed
board_card_created_failed     report_note_created_failed    user_signed_up_failed
board_card_deleted_failed     report_objective_set_failed   workspace_created_failed
invite_accepted_failed        story_created_failed          workspace_member_invited_failed
```

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

### `forbidden` → 24 codes

`agent_presence_blocked` · `api_key_missing_permission` · `api_key_missing_scope` ·
`api_key_no_owner` · `api_key_no_project` · `api_key_no_workspace` · `api_key_project_pinned` ·
`api_key_workspace_pinned` · `cannot_change_owner_role` · `cannot_remove_owner` ·
`cannot_remove_self` · `card_not_in_project` · `github_repo_forbidden` ·
`installation_not_linked` · `insufficient_workspace_role` · `invitation_email_mismatch` ·
`key_owner_not_member` · `key_owner_not_workspace_member` · `no_read_scope_for_search` ·
`not_workspace_member` · `note_not_in_project` · `project_not_in_key_workspace` ·
`story_not_in_project` · `workspace_not_accessible`

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
