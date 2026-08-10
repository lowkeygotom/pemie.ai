-- `repos.url` se validaba con `z.string().url()`, que acepta cualquier esquema
-- (`javascript:` incluido), y ese valor se pinta como `href` en la pestaña
-- Commits. El schema ya solo admite http(s); esto limpia lo que entró antes.
-- Se anula en vez de borrar la fila: el repo y sus commits siguen siendo válidos,
-- lo único que sobra es el enlace.
UPDATE "repos"
SET "url" = NULL
WHERE "url" IS NOT NULL
  AND "url" !~* '^https?://';
