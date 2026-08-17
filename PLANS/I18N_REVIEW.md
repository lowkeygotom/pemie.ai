# Revisión crítica de i18n ES/EN — pemie.ai

Revisor independiente. No se implementó nada. Los hallazgos van por gravedad. Si una sección está bien, se dice en una línea.

Verificación corrida: `typecheck` de `@pemie/api` y `@pemie/web` en verde. Tests de `@pemie/web` (paridad) en verde. Tests de `@pemie/api`: 114 pass / 2 fail, los dos preexistentes de `mcp/index.test.ts` (`Cannot read properties of undefined (reading 'access')`).

---

## P0 — El usuario inglés ve español, o se le enseña un comando que no existe

### 1. Telegram: `/ayuda`, `/help` y `/start` siempre se responden en español

**Archivo:** `apps/api/src/services/telegram-bot.ts:227-257`  
**Qué está mal:** `dispatchMessage` arranca con `locale = "es"` y despacha `/start`, `/ayuda` y `/help` **antes** de `loadBotSession`. Un usuario ya vinculado con `User.locale = "en"` que escribe `/help` recibe la ayuda en español. Tras un `/start <token>` exitoso, `start_linked` también sale en español aunque el dueño del token tenga locale inglés: no se recarga la sesión ni el locale del user recién vinculado.  
**Por qué importa:** es el primer contacto del bot y el comando de ayuda. El resto de comandos (`/estado`, `/modelo`, …) sí traducen porque corren después de cargar la sesión.  
**Confianza:** alta (el orden del código lo demuestra).

### 2. Telegram: rate-limit y chat no privado siempre en español

**Archivo:** `apps/api/src/services/telegram-bot.ts:194-206`  
**Qué está mal:** `private_chat_only` y `rate_limited` se renderizan con `t("es", …)` aunque el usuario ya esté vinculado en inglés. El rate-limit ocurre antes de `dispatchMessage`, así que no hay forma de leer `session.link.user.locale`.  
**Por qué importa:** un usuario inglés que dispara el límite ve “Demasiados mensajes. Espera un minuto.”  
**Confianza:** alta.

### 3. `describeToolAccess` está hardcodeado en español y se interpola en respuestas inglesas

**Archivo:** `packages/shared/src/mcp-tools.ts:139-142`  
**Call sites:** `apps/api/src/mcp/index.ts:796` y `:980`; `apps/web/src/components/ConnectPanel.tsx:15`  
**Qué está mal:**

```ts
if (access.kind === "anyOf") return `uno de: ${access.scopes.join(", ")}`;
return "sin permiso adicional";
```

El catálogo EN de errores dice `The API key doesn't have the required permission: ${p?.permission}`. En inglés queda: *“The API key doesn't have the required permission: uno de: stories:read, …”*. En la UI, `CapabilityReceipt` hace `t("enableWith", { needs: describeToolAccess(needs) })` → *“enable it with uno de: …”* / *“sin permiso adicional”*.  
**Por qué importa:** B5 listó `packages/shared/src/mcp-tools.ts` y el archivo **no está en el diff**. El i18n de errores/MCP deja un fragmento español en el medio de una frase inglesa.  
**Confianza:** alta.

### 4. OverviewTab: badges de drift hardcodeados en español

**Archivo:** `apps/web/src/pages/project/OverviewTab.tsx:59` (se pintan en `:155-156`)  
**Qué está mal:** el archivo **sí se tocó** (migraron `fmtDate` a `dates.ts`) y dejaron:

```ts
const alertMeta = {
  unreported_work: { label: "Trabajo no reportado", tone: "danger" },
  stalled_wip: { label: "Estancada", tone: "warning" },
};
```

El estado de la HU al lado usa `t(STATUS_META[…].key)`. El badge del tipo de alerta no.  
**Por qué importa:** en inglés, cada alerta de drift muestra un badge en español junto a copy ya traducido.  
**Confianza:** alta.

### 5. La UI en inglés enseña comandos de Telegram que el bot no reconoce

**Archivo:** `apps/web/src/i18n/en/configuration.ts` clave `savedKeys`  
**Qué está mal:** EN dice `In Telegram: /provider, /model, /reset`. El bot solo matchea `/proveedor`, `/modelo`, `/estado`, `/proyecto`, `/desvincular` (`telegram-bot.ts:265-351`). Aliases ingleses hay dos: `/help` y `/reset`. `/provider` y `/model` caen al turno LLM como texto libre. El catálogo ES sí lista los comandos reales. Esta clave no se reescribió en esta tanda (solo se agregaron aria-labels), pero el archivo se tocó y el copy quedó mentiroso.  
**Por qué importa:** un usuario que sigue la UI en inglés no puede cambiar proveedor ni modelo por slash command.  
**Confianza:** alta.

---

## P1 — Huecos de locale / i18n incompleto

### 6. `ApiKey.locale` existe en el schema y no se puede configurar

**Archivos:** `apps/api/prisma/schema.prisma:510-512`; `apps/api/src/services/agents.ts:213-266`; `apps/api/src/rest/workspaces.ts:64` y `:517-524`  
**Qué está mal:** la spec (decisión 5 / cadena MCP) existe para “el equipo de testers en USA que comparte una key `project`/`workspace` configurada en inglés”. `createApiKey` no acepta `locale`, no lo copia del creador, y no hay PATCH. `resolveApiKeyLocale` solo cae a `owner.locale` si `scopeLevel === "user"`. Keys `project`/`workspace` (las compartidas) quedan siempre en `"es"` salvo un UPDATE SQL a mano.  
**Por qué importa:** el caso de uso que justifica la columna no tiene API ni UI. Las user keys sí funcionan vía `owner.locale`.  
**Confianza:** alta.

### 7. `app.notFound` responde inglés fijo, sin locale

**Archivo:** `apps/api/src/app.ts:36`  
**Qué está mal:** `c.json({ error: "Not found" }, 404)` — no pasa por `ServiceError` ni por `renderServiceError`. Un 404 de ruta (typo en el cliente, crawler, agente) siempre es inglés, también para usuarios `es`.  
**Por qué importa:** es el 404 genérico de toda la API. El `onError` de 500 sí respeta locale.  
**Confianza:** alta.

### 8. Webhooks responden español a mano, fuera de `ServiceError`

**Archivo:** `apps/api/src/rest/webhooks.ts:16, 23, 37, 41, 45`  
**Qué está mal:** `"firma inválida"`, `"payload inválido"`, `"Telegram no configurado"`, `"secret inválido"`. Las rutas se montan **antes** de `sessionMiddleware` (`rest/index.ts:49-53`), así que ni siquiera hay `c.get("locale")`.  
**Por qué importa:** el consumidor es GitHub/Telegram (máquina), no una persona. Gravedad baja para UX humana; alta como fuga del modelo “todo texto de usuario pasa por catálogo”. Si un 500 burbujea desde el webhook, `onError` cae a `"es"` porque no hay locale en el contexto.  
**Confianza:** alta en el hecho; media en el impacto (M2M).

### 9. MCP: JSON-RPC `Parse error` / `Invalid Request` sin traducir; 500s del transporte MCP caen a español

**Archivo:** `apps/api/src/mcp/index.ts:1101, 1114`; `apps/api/src/app.ts:40-46`  
**Qué está mal:** `"Parse error"` e `"Invalid Request"` van crudos (inglés de la spec JSON-RPC). Las rutas MCP **no** pasan por `sessionMiddleware` y no hacen `c.set("locale")`. Un throw no-`ServiceError` en MCP llega a `onError` con `c.get("locale") ?? "es"` → 500 siempre en español, aunque la key sea inglesa. Los 401 pre-auth sí usan `Accept-Language` (eso está bien).  
**Por qué importa:** parse errors son raros; un 500 de MCP en una key inglesa mostrando “Error interno” es más visible.  
**Confianza:** alta en los literales; alta-media en el 500 (Hono devuelve `undefined` si la variable no se seteó).

### 10. Settings: fechas todavía atadas al locale del navegador

**Archivo:** `apps/web/src/pages/workspace/Settings.tsx:248, 272`  
**Qué está mal:** el archivo se tocó (título del `PageHeader` + `locale` en `buildAgentPrompt`) y quedaron tres `new Date(…).toLocaleString()` **sin** argumentos → locale del browser, exactamente el bug que `dates.ts` dice resolver. No están entre los call sites migrados.  
**Por qué importa:** un usuario con pemie en inglés y Chrome en español (o al revés) ve fechas mezcladas en Ajustes, que es donde cambia el idioma.  
**Confianza:** alta.

### 11. `noCorrelation` EN pierde una frase del original ES

**Archivo:** `apps/web/src/i18n/es/project.ts` vs `en/project.ts`, clave `noCorrelation`  
**Qué está mal:** ES termina con “El resto del resumen es igual de confiable.” EN no tiene equivalente. No es un leftover español: es un recorte de significado. La clave es preexistente (esta tanda solo agregó `tab*` y aria al final del archivo).  
**Por qué importa:** el inglés implica que el overview entero es poco confiable; el español aclara que solo falla la correlación commit↔HU.  
**Confianza:** alta en la diferencia; media en si se considera bug de *esta* tanda.

---

## P2 — Menores / sospechas

### 12. Comandos de Telegram no tienen alias en inglés

**Archivo:** `apps/api/src/services/telegram-bot.ts:259-351` y catálogo EN `i18n/telegram/en.ts:16-26`  
**Qué está mal:** el help EN (cuando algún día se sirva en inglés) sigue listando `/estado`, `/proyecto`, `/modelo`, `/proveedor`, `/desvincular`, `/nueva`. Eso es coherente con el matcher, no con un usuario inglés. No es un leftover accidental: es un producto a medio traducir.  
**Confianza:** alta. Gravedad baja si se acepta que los slash commands quedan en español a propósito; alta combinada con el hallazgo 5.

### 13. `dates.ts` usa `i18n.language` (`"es"` / `"en"`), no `es-AR`

Se reemplazó un `toLocaleDateString("es-AR")`. El formato argentino (d/m/yyyy) se mantiene con `"es"`, pero el mes abreviado de `formatDateShort` puede diferir de `es-AR`. Menor.  
**Confianza:** media (depende del ICU del browser).

### 14. `ingestPushEvent` devuelve `reason` en español

**Archivo:** `apps/api/src/services/ingest.ts:334, 342` (`"evento sin repo"`, `"repo no vinculado a ningún proyecto"`). Viaja en el JSON del webhook de GitHub. M2M, mismo perfil que el hallazgo 8.  
**Confianza:** alta en el hecho; baja en impacto.

### 15. Sospecha, no hecho: `localizeSchema` traduce cualquier `description` string

**Archivo:** `apps/api/src/mcp/index.ts:59-67`  
Si en el futuro un `description` de schema deja de ser clave de catálogo y pasa a ser prosa, `translate` no la encuentra y devuelve la clave cruda (o el español, si coincidiera). Hoy todas las `description` del schema son keys (`project_id_prop`, etc.). No es un bug actual.  
**Confianza:** n/a — preventiva.

---

## Lo que está bien (una línea cada uno)

- **Call sites mal migrados (riesgo conocido `invalid_body` / `invalid_name` / `invalid_path`):** se partieron. Contrasté los 209 mensajes originales de HEAD contra los 157 codes actuales. `invalid_body` quedó solo en registro (“Datos de registro inválidos”). `invalid_name` quedó en el nombre obligatorio de skill. `invalid_path` quedó para path de archivo inválido; el duplicado y el path inseguro de skill tienen code propio. `invalid_title` es épica; las HU usan `story_title_too_short`. `invalid_column` vs `invalid_target_column`, `invalid_llm_key` vs `invalid_anthropic_key`/`invalid_openai_key`, `scope_mismatch` vs `user_key_scope_mismatch`, `invalid_target` vs `invalid_target_list`: todos spliteados con el texto original en el catálogo ES. No encontré un code reusado que haya pisado un mensaje distinto.
- **Catálogos EN de errores / MCP / Telegram:** sin español copiado. Params interpolados (`scope`, `max`, `path`, `type`, `permission`, …) idénticos en ES y EN.
- **Cadena REST autenticada:** `user.locale → Accept-Language → es` en `sessionMiddleware`. MCP 401 pre-auth usa `Accept-Language`. Correo de asignación usa locale del destinatario. User keys MCP caen a `owner.locale`.
- **OAuth `?error=`:** son codes opacos (`oauth_state`, `oauth_unconfigured`, `oauth_failed`); Login los mapea a `t("oauthState"|"oauthUnconfigured"|"oauthUnknown")`. No es fuga de texto.
- **Arquitectura CLAUDE.md:** esta tanda no metió reglas de negocio nuevas en `rest/`/`mcp/`. Prisma en `rest/` es el health check preexistente (`SELECT 1`) más `import type`. `services/` ya no lanza texto de usuario por `ServiceError` (el `message` es el code). Mailer y Telegram viven en `services/` con catálogo propio, como pide la spec.
- **Frontend keys nuevas (`tabOverview`, `show`/`hide`, aria de Telegram, avisos de BoardTab, `parity.test.ts`):** existen en ES y EN. No vi un `t("…")` nuevo que apunte a una clave ausente.
- **`buildAgentPrompt`:** las 4 llamadas (3 en Workspace, 1 en Settings) pasan `locale: user?.locale`.
- **`dates.ts` y re-render:** lee `i18n.language` en cada llamada. `setLocale` hace `i18n.changeLanguage`. Los call sites migrados (Overview, Reports, Commits, Agent, CardDetail, Skills, Workspace) están en componentes con `useTranslation`, así que un cambio de idioma re-renderiza y la fecha se actualiza. No hace falta recargar. Settings (hallazgo 10) es la excepción porque ni siquiera usa `dates.ts`.

---

## Fuera de alcance, no inflar

- Landing (`pages/landing/**`): excluida a propósito.
- Columnas Kanban y `DEFAULT_DOMAIN_CONFIG.fallback`: decisión de producto en la spec.
- Migración SQL de `ApiKey.locale` no ejecutada: el entorno no tiene Postgres; no es un hallazgo de i18n.
