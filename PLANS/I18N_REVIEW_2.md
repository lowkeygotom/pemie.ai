# Revisión crítica — `fix/i18n-fugas-restantes` (P1 #7–11, P2 #12 y #14)

Revisor independiente. No se implementó nada. Alcance: `git diff 71cdd7f^...HEAD` (commits `71cdd7f`, `4933a47`, `29a270a`). `main...HEAD` trae toda la tanda i18n anterior; no se re-juzgó.

Verificación: `typecheck` de `@pemie/api` y `@pemie/web` en verde. Tests `@pemie/web` (paridad) en verde. Tests `@pemie/api`: 114 pass / 2 fail, los dos preexistentes de `mcp/index.test.ts` (`Cannot read properties of undefined (reading 'access')`).

---

## P2 — El doc de corte de analítica no dice la verdad

### 1. `forbidden` → 24 codes: faltan dos que sí son `forbidden()`

**Archivo:** `PLANS/POSTHOG_CODE_MIGRATION.md:48-57`  
**Qué está mal:** el mapa lista 24 codes. En el código hay 26 `throw forbidden(...)`. Faltan `write_scope_requires_member` y `read_scope_requires_viewer` (`apps/api/src/services/agents.ts:579`). Ambos están en `ERROR_CODES` (líneas 111–112) y en los catálogos es/en. Salieron del split B3b, no son codes nuevos de esta rama.  
**Por qué importa:** el doc se vende como inventario para no dejar filtros de PostHog en cero. Un `reason IN (...)` copiado de esa lista no cubre esos dos 403. El impacto en la SPA es bajo (viven en el chequeo de rol de una API key, no en un `*_failed` de sesión), pero el inventario está incompleto.  
**Confianza:** alta.

### 2. “33 call sites” / “18 eventos”: las dos cifras están mal

**Archivo:** `PLANS/POSTHOG_CODE_MIGRATION.md:20-29`  
**Qué está mal:** en el frontend hay **20** llamadas a `analyticsFailureReason` y **20** eventos `*_failed` distintos. El doc omite `agent_presence_blocked_failed` y `agent_presence_unblocked_failed` (`apps/web/src/pages/Workspace.tsx:642-644`), que sí están en `packages/shared/src/analytics.ts:84-86` y sí mandan `reason`. Tampoco menciona los dos eventos server-side con la misma propiedad (`telegram_link_started_failed`, `telegram_llm_key_set_failed` en `channels.ts:125` y `:324`).  
**Por qué importa:** quien busque insights por nombre de evento no va a tocar los de presencia de agente. Esos 403 sí pueden llevar `agent_presence_blocked` / `agent_not_found` post-split.  
**Confianza:** alta en el conteo actual; no verifiqué el “78 call sites / 47 mensajes” histórico (el spec `I18N_BACKEND.md:132` dice 73, no 78).

### 3. Los tres codes viejos sí desaparecieron; el resto del mapa `unauthorized`/`not_found` cuadra

`ERROR_CODES` no contiene `"forbidden"`, `"not_found"` ni `"unauthorized"`. Los 4 `unauthorized` del doc coinciden con los `throw unauthorized` de sesión/MCP (`invalid_credentials`, `not_authenticated`, `invalid_api_key`, `api_key_expired`). Los 19 `not_found` coinciden con los `throw notFound` actuales, incluido `invalid_invitation`.  
Los `unauthorized` nuevos de webhooks (`invalid_webhook_signature`, `invalid_telegram_secret`) no están en el mapa: correcto para PostHog (no pasan por `analyticsFailureReason`), incompleto si alguien usa el doc como lista total de 401.

---

## P2 — Residuales / cambios de borde

### 4. `app.notFound` arregla `/api/*` y da vuelta el default del resto

**Archivo:** `apps/api/src/app.ts:39-41`  
**Qué está mal (parcial):** P1 #7 queda cerrado para rutas que pasaron por `sessionMiddleware` (`/api/typo` con sesión o `Accept-Language`). El fallback ahora es `"es"` (`"No encontrado"`). Antes el 404 genérico era inglés fijo (`"Not found"`). Un agente MCP que pega `/mcp/foo`, un crawler, o `/webhooks/no-existe` pasan de inglés a español.  
**Por qué importa:** es el comportamiento que el comentario declara (“mismo criterio que onError”). No rompe clientes que parsean el status. Sí cambia el texto que ve un speaker inglés fuera de `/api/*`.  
**Confianza:** alta en el cambio; media en el impacto.

### 5. P1 #9 quedó a medias: los 500 de MCP sí respetan la key; `Parse error` / `Invalid Request` siguen crudos

**Archivo:** `apps/api/src/mcp/index.ts:1101-1119`  
`c.set("locale", ctx.locale)` corre **después** de autenticar, en el único `POST /`. El 401 pre-auth no lo necesita: se responde in-situ con `Accept-Language` (`:1088-1098`). Un throw no-`ServiceError` post-auth llega a `onError` con locale de la key. `GET /` no setea locale; un 500 ahí (improbable) seguiría en español.  
`"Parse error"` e `"Invalid Request"` siguen en inglés de la spec JSON-RPC, como en la revisión anterior. No es una regresion; es el resto de #9 sin tocar.  
**Confianza:** alta.

### 6. Webhooks: status igual, shape distinto, copy del 503 reescrito

**Archivo:** `apps/api/src/rest/webhooks.ts:21-45` vs el padre de `71cdd7f`  
Status: 401 / 400 / 503 / 401 / 400, iguales que antes. GitHub no reintenta 4xx; el 503 de Telegram no cambió. No hay regresion de reintentos.  
Shape: antes `{ error: "firma inválida" }`; ahora `{ error: "Firma inválida", code: "invalid_webhook_signature" }` vía `onError` (`app.ts:48-49`). GitHub ignora el body en 4xx.  
Copy: el 503 reusa `telegram_not_configured`, cuyo catálogo dice “Telegram no está configurado en el servidor” (`i18n/errors/es.ts:61`), no el literal viejo “Telegram no configurado”. M2M; Telegram no parsea el texto.  
**Confianza:** alta.

---

## Lo que está bien (una línea cada uno)

- **`serviceUnavailable()`** (`errors.ts:48-50`): misma firma que los otros helpers, status 503, `code: ErrorCode`. `telegram_not_configured` ya estaba en `ERROR_CODES` y en es/en. Los tres codes nuevos (`invalid_webhook_signature`, `invalid_webhook_payload`, `invalid_telegram_secret`) están en `error-codes.ts:172-174`, `i18n/errors/es.ts:169-171`, `en.ts:167-169`. El test `toda clave de ERROR_CODES existe en ambos catálogos` los cubre (pasó).
- **Telegram aliases:** `commandToken` + `isCommand` por token exacto (`telegram-bot.ts:229-241`). `/model` no pisa `/modelo` (con `startsWith("/model")` sí lo habría hecho: `/modelo claude` habría dejado arg `"o claude"`). `/new` y `/nueva` son aliases del mismo handler, no colisionan. `/project` no es prefijo de `/proyecto`. Los comandos españoles canónicos (`/estado`, `/modelo`, `/modelo <id>`, `/modelo@bot`, `/proveedor`, `/proyecto`, `/desvincular`, `/nueva`, `/ayuda`) siguen matcheando. El help EN lista los aliases nuevos; el ES no se tocó. Único cambio de matching: deja de tragarse prefijos concatenados tipo `/modelogpt` (el `startsWith` viejo sí). Eso es el punto del matcher, no una regresion de los slash commands documentados.
- **`ingestPushEvent` reason:** grep de `evento sin repo` / `repo no vinculado` solo pega en `PLANS/I18N_REVIEW.md`. Ningún test, ningún consumidor web. Viaja en el JSON 200 del webhook; GitHub no lo lee. `no_repo` / `repo_not_linked` no cambian status ni retries.
- **Settings fechas:** los tres `toLocaleString()` (createdAt, lastUsedAt, log.createdAt) pasaron a `formatDateTime`. No queda ningún `toLocaleString()` en `apps/web` fuera de `dates.ts`. Settings ya usa `useTranslation`, así que un cambio de idioma re-renderiza.
- **`noCorrelation` EN:** ahora termina con “The rest of the summary is just as reliable.”, equivalente al ES. Paridad web en verde.

---

## Fuera de alcance, no inflar

- P0 #1–5 y P1 #6: no están en estos 3 commits.
- `savedKeys` EN sigue enseñando `/proveedor, /modelo, /reset` (comandos españoles, que existen). Esta rama no lo tocó; el help de Telegram EN sí lista los aliases. Inconsistencia de producto, no un comando mentiroso.
- Los 2 fallos de `mcp/index.test.ts`: preexistentes, no hallazgo.
