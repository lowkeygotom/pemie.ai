# pemie.ai — Guía de arquitectura y diseño

Plataforma multi-proyecto para monitorear equipos y proyectos, para **personas** (web)
y **agentes** (MCP). Monorepo npm workspaces: `apps/api`, `apps/web`, `packages/shared`.

Estas reglas son **obligatorias** para cualquier cambio en este repo. No son sugerencias.

## Arquitectura — Clean Architecture

El backend tiene **un solo núcleo de negocio** expuesto por tres interfaces de transporte.
La regla de dependencia apunta siempre hacia adentro: el transporte depende de los
servicios, nunca al revés.

```
apps/api/src/
  services/   ← CAPA DE NEGOCIO. Agnóstica del transporte. La fuente de verdad.
              Aquí viven TODAS las reglas: validación de dominio, autorización,
              acceso a datos (Prisma). No importa nada de hono/rest/mcp.
  rest/       ← interfaz REST (frontend web). Solo traduce HTTP ⇄ servicios.
  mcp/        ← interfaz MCP (agentes, API key + scopes). Solo traduce JSON-RPC ⇄ servicios.
  auth/       ← sesiones, OAuth.
```

**Reglas duras:**
- **Ninguna regla de negocio en `rest/` o `mcp/`.** Si un endpoint valida, autoriza o
  consulta la DB directamente, está mal: eso va en `services/`. El transporte solo parsea
  la entrada, llama a un servicio y serializa la salida.
- **Prisma solo se usa desde `services/`** (y `db.ts`). Nunca desde `rest/`/`mcp/`.
- Cada servicio expone funciones autorizadas (`createStory(userId, …)`) y, cuando aplica,
  su operación ya-autorizada (`opCreateStory(…)`) reutilizable por REST y MCP sin duplicar
  lógica. Mantén ese patrón.
- Tipos y constantes compartidos entre api y web viven en `packages/shared` y deben ser
  **agnósticos de runtime** (sin imports de Node ni del navegador).

## Clean Code

- Nombres reveladores de intención; funciones pequeñas con una sola responsabilidad.
- Sin dependencias nuevas salvo justificación real (el estilo del repo prefiere `node:crypto`,
  `fetch`, etc. antes que traer un paquete). Si agregas una, documenta por qué.
- Errores de dominio tipados (`badRequest`/`notFound`/`forbidden`/`conflict` en `services/errors.ts`),
  nunca strings sueltos ni `throw new Error`.
- Idempotencia donde el dominio la pide (upserts por unique, reintentos en colisión de key).
- Comenta el *por qué*, no el *qué*. Sigue el estilo y densidad de comentarios del archivo vecino.

## Modularidad y organización feature-based

- Organiza por **feature/dominio**, no por tipo técnico. En el frontend cada feature es su
  carpeta (`pages/project/StoriesTab.tsx`, `BoardTab.tsx`, …); en el backend cada dominio es
  su servicio (`stories.ts`, `board.ts`, `reports.ts`, `tenancy.ts`, `ingest.ts`).
- Una feature nueva = un servicio + su(s) endpoint(s) + su(s) tool(s) MCP si aplica + su tab/UI.
  No la esparzas en archivos "utils" genéricos.
- Evita acoplamiento entre features: si dos servicios se necesitan, importa la función
  concreta (como `stories.ts` usa `board.opAssignCard`), no metas lógica cruzada.

## Frontend — el design system es la fuente de verdad

Los tokens en `apps/web/src/styles/tokens/` y los componentes de `apps/web/src/components/ui.tsx`
son **obligatorios**. Toda UI se construye con ellos.

- **Nunca hardcodees valores de diseño.** Usa las utilidades mapeadas a tokens
  (`text-ink-900`, `bg-surface-50`, `border-line-200`, `text-h4`, `rounded-md`, `shadow-sm`,
  fuentes `Sora`/`IBM Plex Mono`). Nada de hex sueltos, px arbitrarios ni colores fuera de la escala.
- **Reutiliza los componentes** (`Button`, `Card`, `Input`, `Select`, `Field`, `Badge`, `Stat`,
  `EmptyState`, `PageHeader`, `Tabs`, `CodeBlock`, …). Si necesitas algo nuevo, créalo **dentro
  de `ui.tsx`** como primitiva reutilizable, no inline en la página.
- **Estados siempre cubiertos**: loading, vacío (`EmptyState`), error (`ErrorText`) y con datos.
  Ninguna vista puede quedarse en blanco o mostrar un error crudo del backend.

### Skeleton loaders — obligatorios

- **Toda carga asíncrona de contenido usa un skeleton con la forma del contenido**, no un
  spinner genérico. Usa los componentes `Skeleton`/`Skeleton*` de `ui.tsx`.
- El skeleton debe **imitar el layout final** (mismas cajas, filas, alturas) para evitar saltos
  de layout cuando llegan los datos.
- `Spinner` queda reservado solo para gates de página completa muy breves (p. ej. verificación
  de sesión en `App.tsx`), no para contenido de una feature.

### Mentalidad UI/UX (experto)

Cada pantalla se diseña pensando en la experiencia, no solo en "que funcione":

- **Jerarquía visual** clara: un solo foco por vista, tamaños/pesos tipográficos del sistema.
- **Feedback inmediato**: estados hover/focus/disabled/loading en todo control; nada que
  parezca clickeable sin serlo.
- **Accesibilidad**: `aria-label` en controles sin texto, foco visible (`shadow-focus`),
  contraste suficiente, targets táctiles cómodos.
- **Consistencia**: mismos espaciados, radios y patrones entre features; si algo se repite,
  se vuelve componente.
- **Vacío con intención**: los `EmptyState` guían la primera acción, no solo dicen "sin datos".
- **Movimiento sobrio**: transiciones cortas con las curvas del sistema (`overshoot` cuando aporta),
  nunca animaciones que distraigan.

## Comandos

```bash
npm run dev:api     # backend  → http://localhost:4000
npm run dev:web     # frontend → http://localhost:5173
npm run db:migrate  # migraciones Prisma (workspace @pemie/api)
npm run typecheck --workspace @pemie/api   # y @pemie/web
```

- DB local: Postgres (el entorno del autor usa Homebrew en `localhost:5432`; el
  `docker-compose.yml` expone `5433` — revisar `DATABASE_URL` según cuál uses).
- Correo de invitaciones: sin `RESEND_API_KEY` usa Ethereal (buzón de prueba, cero config,
  URL de preview); con la key, entrega real vía Resend.

## Antes de dar algo por terminado

- `typecheck` de `@pemie/api` y `@pemie/web` en verde.
- Toda vista nueva cubre loading (skeleton) / vacío / error / con datos.
- Ninguna regla de negocio se filtró a `rest/` o `mcp/`.
- Verifica el resultado real (endpoint responde, pantalla renderiza), no solo que compile.
