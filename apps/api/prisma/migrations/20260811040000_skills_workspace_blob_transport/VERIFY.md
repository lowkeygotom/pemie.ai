# Verificación post-backfill (antes del DROP)

Correr contra la misma base donde se aplicó `20260811040000_skills_workspace_blob_transport`.

```sql
-- 1. Conteo de skills: cada fila de project_skills debe tener su espejo.
SELECT
  (SELECT COUNT(*) FROM project_skills) AS project_skills_count,
  (SELECT COUNT(*) FROM workspace_skills) AS workspace_skills_count;

-- 2. Filas huérfanas / faltantes por id (los ids se preservan en el backfill).
SELECT ps.id, ps.slug, p."workspaceId"
FROM project_skills ps
JOIN projects p ON p.id = ps."projectId"
LEFT JOIN workspace_skills ws ON ws.id = ps.id
WHERE ws.id IS NULL;

-- 3. Archivos expandidos: suma de jsonb_array_elements vs filas nuevas.
SELECT
  (SELECT COALESCE(SUM(jsonb_array_length(files)), 0) FROM project_skills) AS expected_files,
  (SELECT COUNT(*) FROM workspace_skill_files) AS actual_files;

-- 4. totalBytes coherente con la suma de bytes de archivos.
SELECT ws.id, ws.slug, ws."totalBytes", COALESCE(SUM(f.bytes), 0) AS sum_bytes
FROM workspace_skills ws
LEFT JOIN workspace_skill_files f ON f."skillId" = ws.id
GROUP BY ws.id
HAVING ws."totalBytes" <> COALESCE(SUM(f.bytes), 0);
```

Si (1) coincide, (2) y (4) están vacíos, y (3) coincide → aplicar
`20260811040100_drop_project_skills`.
