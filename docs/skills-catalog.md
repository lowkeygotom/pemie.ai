# Catálogo de skills del workspace

**Decisión:** el workspace en Pemie es la fuente de verdad de las skills del
equipo. Un agente (o persona) las publica y otro las instala en *su* runtime
(Cursor, Claude, Codex, …), eligiendo si van al repo del proyecto o solo a su
usuario. El transporte de bytes va por `tar.gz` / multipart — **no** por el
contexto del modelo.

Esto refuerza el ROI diferenciador (menos impuesto humano↔agente): deja de
vivir cada skill en el laptop de alguien y en un hilo de Slack.

---

## Apuesta en una frase

> “Sube esta skill a Pemie” / “Revisa las skills del workspace e instala X”
> deben funcionar sin glue humano, en cualquier agente — aunque la skill pese
> varios megabytes.

---

## Quick path

### Publicar (agente)

1. Persona: *“Sube esta skill al workspace en Pemie.”*
2. Agente llama `publish_skill` (sin `files`) → recibe `uploadUrl` + `command`.
3. Agente ejecuta en su shell:
   `tar czf - -C ~/.claude/skills impeccable | curl --upload-file - "$UPLOAD_URL"`.
4. Queda versionada en el catálogo del workspace.

### Publicar (web)

1. En `/w/:slug/skills`, arrastrá la carpeta (debe incluir `SKILL.md`).
2. La UI pide el ticket y hace `PUT` multipart al mismo endpoint de upload.

### Instalar

1. Persona: *“Revisa las skills del workspace en Pemie e instala X.”*
2. Agente: `list_skills` → confirma con la persona si hace falta.
3. Persona elige destino: **proyecto** o **solo yo (usuario)**.
4. Agente: `get_skill({ slug, target, destination })`.
5. Si viene `downloadUrl`/`command`, baja el tar; si viene `files` inline (skill
   chica), escribe bajo `install.rootPath`.
6. Confirma path + versión.

Pemie **no** instala en remoto. Solo entrega el paquete instalable.

### Borrar

Hard delete. En la web hay que tipiar el slug; en MCP `delete_skill` avisa que
es irreversible y pide confirmación con la persona.

---

## Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Scope del catálogo | **Workspace** |
| Artefacto | Solo **skills** (MCPs después) |
| Contenido | **Canónico** y agnóstico de IDE |
| Transporte | `tar.gz` (agente) / multipart (web); bytes fuera del tool call |
| Install | El **agente local** materializa archivos |
| Runtime (`target`) | `cursor` \| `claude` \| `codex` \| `generic` |
| Destino (`destination`) | Lo decide la **persona**: `project` \| `user` |
| Si no dice destino | El agente **pregunta**; no asumir |
| Borrado | Hard delete en cascada (sin `deletedAt`) |
| Secretos | Nunca en el artefacto |

---

## Modelo de datos

```
WorkspaceSkill
  id, workspaceId, slug, name, description, version
  contentHash, totalBytes, publishedByType, publishedById
  files[] → WorkspaceSkillFile { path, content, bytes }
  downloads[] → SkillDownload { tokenHash, expiresAt }  // multi-uso, TTL 15 min

SkillUpload  // ticket de un solo uso, TTL 15 min
  workspaceId, slug, name, description, tokenHash, actor*, expiresAt
```

Límites (`packages/shared`): 8 MiB total, 500 archivos, 1 MiB por archivo;
inline hasta 64 KiB.

Migración: `project_skills` → `workspace_skills` (backfill). El DROP de
`project_skills` queda en `prisma/pending/` hasta verificar en prod.

---

## Contrato MCP (4 tools)

| Tool | Scope | Notas |
| --- | --- | --- |
| `list_skills` | `skills:read` | workspace-scoped |
| `get_skill` | `skills:read` | `files` inline o `downloadUrl`+`command` |
| `publish_skill` | `skills:write` | devuelve ticket; **sin** `files` |
| `delete_skill` | `skills:write` | irreversible |

---

## REST

Sesión (workspace):

- `GET/POST /api/workspaces/:slug/skills`
- `GET/DELETE /api/workspaces/:slug/skills/:skillSlug`

Token (curl pelado):

- `PUT /api/skill-uploads/:token` — `application/gzip` o `multipart/form-data`
- `GET /api/skill-downloads/:token` — `application/gzip`

---

## Checklist

- [ ] `publish_skill` → ticket → `tar \| curl` con skill real grande
- [ ] `get_skill` grande → `downloadUrl`; chica → `files`
- [ ] Re-subir sin cambios → `version` no sube
- [ ] Web: drag & drop + progreso + borrado tipando slug
- [ ] Backfill verificado → aplicar DROP pendiente
