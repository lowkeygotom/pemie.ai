# Catálogo de skills del proyecto

**Decisión:** el proyecto en Pemie es la fuente de verdad de las skills del
equipo. Un agente las publica y otro las instala en *su* runtime (Cursor,
Claude, Codex, …), eligiendo si van al repo del proyecto o solo a su usuario.
MCPs quedan fuera del MVP.

Esto refuerza el ROI diferenciador (menos impuesto humano↔agente): deja de
vivir cada skill en el laptop de alguien y en un hilo de Slack.

---

## Apuesta en una frase

> “Sube esta skill a Pemie” / “Revisa las skills del proyecto e instala X”
> deben funcionar sin glue humano, en cualquier agente.

---

## Quick path (loops del MVP)

### Publicar

1. Persona (o agente): *“Sube esta skill al proyecto en Pemie.”*
2. Agente llama `publish_skill` con el contenido canónico.
3. Queda versionada en el catálogo del proyecto.

### Instalar

1. Persona: *“Revisa las skills del proyecto en Pemie e instala X.”*
2. Agente: `list_skills` → confirma con la persona si hace falta.
3. Persona elige destino: **proyecto** o **solo yo (usuario)**.
4. Agente: `get_skill({ slug, target, destination })`.
5. Agente escribe `install.files` bajo `install.rootPath` en su máquina.
6. Confirma path + versión.

Pemie **no** instala en remoto. Solo entrega el paquete instalable.

---

## Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Scope del catálogo | **Proyecto** (no workspace en MVP) |
| Artefacto MVP | Solo **skills** (MCPs después) |
| Contenido | **Canónico** y agnóstico de IDE; no N forks por runtime |
| Install | El **agente local** materializa archivos |
| Runtime (`target`) | `cursor` \| `claude` \| `codex` \| `generic` (+ extensible) |
| Destino (`destination`) | Lo decide la **persona**: `project` \| `user` |
| Si no dice destino | El agente **pregunta**; no asumir |
| Workspace share | Fase 2 (“promover a workspace”) |
| Secretos | Nunca en el artefacto |

---

## Modelo de datos (borrador)

Una skill por proyecto, identificada por `slug` estable; cada publish sube
`version` (entero monotónico).

```
ProjectSkill
  id, projectId
  slug              // unique por project; kebab-case
  name              // display / frontmatter name
  description       // trigger + qué hace (texto corto)
  version           // Int, ++ en cada publish que cambia contenido
  files             // Json: [{ path, content }]  — canónico (SKILL.md, assets/…)
  publishedByType   // user | agent
  publishedById
  createdAt, updatedAt

  @@unique([projectId, slug])
```

Notas:

- `files` es el canónico. Los paths relativos son *dentro* del paquete
  (`SKILL.md`, `assets/foo.json`), no el root del IDE.
- Historial completo de versiones: opcional en v1. Con `version` actual basta;
  si hace falta rollback, fase 2 con `ProjectSkillRevision`.

### Scopes API (nuevos)

| Scope | Uso |
| --- | --- |
| `skills:read` | `list_skills`, `get_skill` |
| `skills:write` | `publish_skill` |

---

## Contrato MCP (3 tools)

### `list_skills`

**In:** `projectId?` (omitido si la key es project-scoped)  
**Out:**

```json
{
  "skills": [
    {
      "slug": "review-bugbot",
      "name": "review-bugbot",
      "description": "Trigger: …",
      "version": 3,
      "updatedAt": "…"
    }
  ]
}
```

### `get_skill`

**In:**

```json
{
  "slug": "review-bugbot",
  "target": "cursor",
  "destination": "user"
}
```

- `target`: `cursor` | `claude` | `codex` | `generic`
- `destination`: `project` | `user` — **requerido** (el agente debe haberlo
  resuelto con la persona)

**Out:**

```json
{
  "slug": "review-bugbot",
  "name": "review-bugbot",
  "description": "…",
  "version": 3,
  "install": {
    "target": "cursor",
    "destination": "user",
    "rootPath": "~/.cursor/skills/review-bugbot",
    "files": [
      { "path": "SKILL.md", "content": "---\nname: review-bugbot\n…" }
    ]
  },
  "availableTargets": ["cursor", "claude", "codex", "generic"]
}
```

El agente escribe cada `files[].path` relativo a `rootPath`.

### `publish_skill`

**In:**

```json
{
  "slug": "review-bugbot",
  "name": "review-bugbot",
  "description": "Trigger: … Qué hace.",
  "files": [
    { "path": "SKILL.md", "content": "…" }
  ]
}
```

**Out:** skill summary con `version` nueva (o la misma si el contenido no
cambió — idempotente por hash de `files`).

Reglas:

- Debe existir `SKILL.md` en `files`.
- `slug` kebab-case, estable; renombrar = publish nuevo + deprecate (no en MVP).
- Tamaño razonable por skill (límite duro en servicio; p. ej. 512 KiB total).

---

## Mapa `target` × `destination` → `rootPath`

| target | destination=`project` | destination=`user` |
| --- | --- | --- |
| `cursor` | `.cursor/skills/{slug}` | `~/.cursor/skills/{slug}` |
| `claude` | `.claude/skills/{slug}` | `~/.claude/skills/{slug}` |
| `codex` | `.codex/skills/{slug}` *(ajustar si el runtime documenta otro path)* | `~/.codex/skills/{slug}` |
| `generic` | `.pemie/skills/{slug}` | `~/.pemie/skills/{slug}` |

`generic`: para runtimes sin convención de skills; el agente aplica el
contenido en sesión o deja el paquete ahí para referencia.

Los paths `~` los resuelve el **agente local**, no el servidor.

---

## Capas (Clean Architecture)

```
services/skills.ts     ← validación, authz, Prisma, resolución rootPath
rest/…                 ← list/get/publish HTTP (UI web)
mcp/…                  ← las 3 tools
packages/shared        ← tipos, scopes, tabla de install targets
```

UI web (tab o sección en proyecto): lista + detalle + “copiar prompt de
install”. Puede ir en el mismo slice o justo después de las tools MCP;
las tools son el MVP de valor.

---

## Anti-features (MVP)

- Catálogo a nivel workspace / marketplace público
- MCPs, hooks, rules como tipos del mismo catálogo (mismo *modelo mental*
  después; no el mismo schema aún)
- Install remoto o agent-to-agent push
- Ratings, likes, “skill of the week”
- Diff UI rico / editor web de skills (upload vía agente basta)
- Sync automático al abrir el IDE
- Guardar API keys o secretos dentro de `files`

---

## Cómo medimos que vale

Señal de ROI diferenciador (capa 2 de `docs/roi.md`):

1. Minutos/semana en “pásame tu skill de X” / buscar skills en chats.
2. Al menos un ciclo completo publish → install en **otro** runtime/persona
   sin pegar el markdown a mano.
3. (Opcional) % de agentes del proyecto que hicieron `list_skills` en la
   ventana de medición.

No contar “skills publicadas” como éxito: es actividad.

---

## Checklist de aceptación del MVP

- [ ] `list_skills` / `get_skill` / `publish_skill` vía MCP con scopes
- [ ] Catálogo scoped a `projectId`
- [ ] `get_skill` exige `target` + `destination` y devuelve `rootPath` + `files`
- [ ] Publish idempotente si el contenido no cambia
- [ ] Un humano puede instalar en `user` sin ensuciar el repo
- [ ] Otro humano/agente puede instalar la misma skill en `project` en Cursor
  o Claude
- [ ] UI mínima opcional: ver catálogo del proyecto
- [ ] Nada de lógica de negocio en `rest/` o `mcp/`

---

## Next step

Implementar en este orden:

1. Tipos + scopes en `@pemie/shared` + migración `ProjectSkill`
2. `services/skills.ts` (ops autorizadas)
3. Tools MCP + rutas REST
4. Prompt de agente actualizado (`buildAgentPrompt`) para mencionar el catálogo
5. Tab/sección web de solo lectura (+ CTA de publish/install por prompt)

Cuando el loop skills esté adoptado, abrir el mismo patrón para **MCPs**
(trust/auth distinto; no reutilizar el schema a ciegas).
