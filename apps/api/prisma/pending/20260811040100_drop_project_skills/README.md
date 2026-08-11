# NO APLICAR todavía

Esta migración borra `project_skills` de forma irreversible.

Solo aplicar **después** de haber corrido `migrations/20260811040000_skills_workspace_blob_transport`
en producción y verificado el backfill con las queries de
`../migrations/20260811040000_skills_workspace_blob_transport/VERIFY.md`.

Para aplicarla: mover esta carpeta a `prisma/migrations/` y correr `prisma migrate deploy`.
