# i18n del backend — spec de implementación

Cierra los huecos que el i18n del frontend no cubre. La web ya está resuelta
(react-i18next, 15 namespaces, selector, `User.locale`): esto es **solo backend**.

Reemplaza al plan original de 21 historias, que asumía que no existía nada de
i18n. Lo que ese plan proponía para la web ya estaba hecho.

## Estado de partida

- `User.locale String @default("es")` — **ya existe** en Prisma.
- `sendInvitationEmail` — **ya resuelve** locale (destinatario → invitador → es).
- `sendStoryAssignedEmail` — **ya resuelto** en esta tanda (locale del destinatario).
- `ApiKey.locale` — **no existe**. Hace falta para MCP.
- `services/errors.ts` — mensajes en español hardcodeados, `code` opcional.
- `mcp/index.ts` — 63 `description` en español; `packages/shared/src/mcp-tools.ts`, 36 `summary`.
- `services/telegram-bot.ts` — renderiza `err.message` crudo.

## Decisiones cerradas (no re-discutir)

1. **Telegram entra.** Sin esto, tras cerrar la vía legacy un usuario de Telegram
   vería codes crudos (`project_not_found`) en vez de texto.
2. **Idioma de una invitación a quien no tiene cuenta**: `inviter.locale`. Ya implementado.
3. **`User.locale` nullable vs default**: el repo ya eligió `@default("es")`. Se respeta.
4. **`ErrorCode` NO se exporta a `packages/shared`.** La web recibe el texto ya
   traducido y usa `code` de forma opaca solo para analítica (`api.ts:58` → PostHog).
   Exportarlo acoplaría el vocabulario de errores del backend al bundle del navegador
   sin un caso de uso real.
5. **`ApiKey.locale`**, nullable, con esta cadena de fallback:
   `apiKey.locale` → si `scopeLevel === "user"`: `owner.locale` → `"es"`.
   Cubre al tester individual (key personal) y al equipo de testers en USA que
   comparte una key `project`/`workspace` configurada en inglés.

## Fuera de alcance (decisión de producto, no bug)

- **Columnas del Kanban** (`board.ts` `DEFAULT_COLUMNS`): son filas de DB
  renombrables por equipo. Traducirlas en la UI pisaría el nombre que puso el
  equipo, y los proyectos existentes seguirían en español igual. Si se quiere,
  va aparte: sembrar según el locale de quien crea el proyecto.
- **`DEFAULT_DOMAIN_CONFIG.fallback = "otro"`** (`packages/shared`): mismo caso,
  vive en el `domainConfig` editable del proyecto.
- **Landing** (`pages/landing/**`): es transcreación de marketing y arrastra
  decisiones de SEO (`hreflang`, URLs por idioma, sitemap). Épica aparte.

## Diseño

### Catálogos

```
apps/api/src/i18n/
  index.ts        translate(catalogs, locale, key, params)
  errors/es.ts    Record<ErrorCode, string | (p) => string>
  errors/en.ts    Record<keyof typeof es, ...>  ← el tipo fuerza paridad
  mcp/es.ts       descripciones de tools y del transporte
  mcp/en.ts
```

`es` es la fuente de verdad de las claves; `en` se tipa contra ella, así que el
compilador exige EN completo.

### Fallback — nunca lanza

1. `catalogs[locale][key]`
2. `catalogs["es"][key]`
3. la clave cruda + `console.warn` en dev

El paso 3 existe para que ni la UI quede en blanco ni el JSON-RPC devuelva
`undefined` si alguna clave desaparece de ambos catálogos.

### `ServiceError`

```ts
export class ServiceError extends Error {
  constructor(public status: number, public code: ErrorCode, public params?: ErrorParams) {
    super(code);   // message = code: solo para logs y stack traces
  }
}
```

`message` deja de ser texto de usuario. Los logs no pierden nada: `api_key_missing_scope`
dice más en un agregador que la frase completa.

### Resolución de locale por transporte

| Transporte | Cadena |
|---|---|
| REST autenticado | `user.locale` → `Accept-Language` → `es` |
| REST anónimo | `Accept-Language` → `es` |
| MCP | `apiKey.locale` → si `scopeLevel="user"`: `owner.locale` → `es` |
| MCP 401 (sin key todavía) | `Accept-Language` → `es` |
| Correo | locale del destinatario |
| Telegram | `channelLink.user.locale` → `es` |

**La cadena es lógica de dominio** y vive en `services/agents.ts`
(`resolveApiKeyLocale`). Lo que vive en el borde es el *render*. Eso respeta la
regla dura de CLAUDE.md: `mcp/` decide en qué idioma escribir, `services/` decide
qué idioma corresponde a esa identidad.

`authenticateApiKey` ya hace un `findUnique` sobre `api_keys`: se le agrega
`include: { owner: { select: { locale: true } } }`. Cero queries extra.

## Fases

| # | Alcance | Archivos |
|---|---|---|
| B1 | `ErrorCode` + catálogos + `translate` + `ServiceError` nuevo **con vía legacy `@deprecated` viva** | `services/error-codes.ts`, `services/errors.ts`, `i18n/**` |
| B2 | Traducción en los bordes + `ApiKey.locale` + `resolveApiKeyLocale` | `schema.prisma`, `services/agents.ts`, `rest/http.ts`, `app.ts`, `mcp/index.ts` |
| B3 | Migrar los 212 call sites, módulo por módulo | `services/*.ts`, `rest/*`, `mcp/*` |
| B4 | Cerrar la vía legacy + guarda de no-regresión | `services/errors.ts`, test nuevo |
| B5 | Descripciones de tools MCP por idioma | `mcp/index.ts`, `packages/shared/src/mcp-tools.ts`, `i18n/mcp/**` |
| B6 | Telegram | `services/telegram-bot.ts` |

### Migración de los 212 call sites (B3)

Cambiar la firma rompe los 212 a la vez. Por eso B1 deja la firma legacy
`(message, code?)` marcada `@deprecated` conviviendo con la nueva `(code, params?)`:
nada se rompe, y B3 migra módulo por módulo. B4 elimina la vía legacy, y si quedó
un call site sin migrar, no compila.

**Regla de traducción**: el texto español que hoy está en el código se copia
**tal cual** al catálogo `es`. Cero re-redacción — así el diff es mecánico y
auditable. Mejorar el copy va después, en su propio cambio.

| Hoy | Después |
|---|---|
| `unauthorized("API key inválida")` | `unauthorized("api_key_invalid")` |
| `forbidden(\`…scope requerido: ${scope}\`)` | `forbidden("api_key_missing_scope", { scope })` |
| `badRequest(\`Tipo inválido: ${type}\`, "invalid_type")` | `badRequest("invalid_card_type", { type })` |

## Riesgo conocido: cambia el valor de `code` en ~73 respuestas

Hoy 73 call sites de `forbidden`/`notFound`/`unauthorized` comparten 3 codes para
47 mensajes distintos. Al darles code propio, el `code` que llega al frontend
**cambia de valor**.

Consumidores: `apps/web/src/lib/api.ts:58` (`analyticsFailureReason` → PostHog) y
`services/channels.ts`. El efecto neto es positivo (la analítica gana granularidad),
pero cualquier dashboard que filtre por `code = "forbidden"` deja de coincidir.
**Inventariar los filtros de PostHog antes de B3 y anunciar el corte.**

## Definición de terminado

- `typecheck` de `@pemie/api`, `@pemie/web` y `@pemie/shared` en verde.
- Suite de `@pemie/api` sin regresiones nuevas (hay 2 fallos preexistentes en
  `mcp/index.test.ts` — `Cannot read properties of undefined (reading 'access')` —
  que ya fallaban antes de este trabajo).
- Test de paridad de claves `es`/`en` para errores y MCP.
- Ningún literal de usuario nuevo en `services/`.
