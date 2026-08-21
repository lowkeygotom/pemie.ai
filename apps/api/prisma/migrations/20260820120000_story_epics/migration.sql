-- PEM-57: unifica el concepto de "épica" dentro de user_stories. Una épica
-- deja de ser un modelo aparte (Epic) y pasa a ser una UserStory más, marcada
-- con isEpic=true, que agrupa HUs normales vía epicId (auto-relación, un solo
-- nivel: assertLinkableEpic en services/stories.ts impide épica-dentro-de-épica).
--
-- Este SQL está escrito a mano (no `prisma migrate dev`: no hay Postgres
-- conectado en este entorno) y contempla explícitamente el caso de 0 filas en
-- "epics" (los pasos de migración de datos son no-ops sobre una tabla vacía)
-- y el caso de N filas.

-- 1) Discriminador nuevo. Default false: toda HU existente sigue siendo una
--    HU normal hasta que se convierta explícitamente.
ALTER TABLE "user_stories" ADD COLUMN "isEpic" BOOLEAN NOT NULL DEFAULT false;

-- 2) Se dropea la FK vieja (epicId -> epics.id) antes de tocar los datos: la
--    FK nueva (epicId -> user_stories.id) se crea recién en el paso 5, una vez
--    que las filas de "epics" ya viven en "user_stories" con el mismo id.
ALTER TABLE "user_stories" DROP CONSTRAINT "user_stories_epicId_fkey";

-- 3) Migra cada fila de "epics" a "user_stories", reusando el mismo "id".
--    Reusar el id evita remapear "epicId" en las HUs que ya apuntaban a esa
--    épica: el valor que tenían sigue siendo válido sin tocarlas.
--
--    La key nueva (obligatoria en user_stories, key vive en PRJ-123) se
--    genera con una window function sobre "projects"."storySeq" — nunca
--    derivada del máximo de key existente (ver el comentario de
--    nextStoryKey en services/stories.ts: storySeq solo crece, y derivar la
--    key del máximo existente puede reciclar un número ya usado).
--
--    "epics" no tenía columnas equivalentes a narrative/acceptanceCriteria/
--    storyPoints/assignee: quedan NULL. "description" de la épica no tiene
--    columna equivalente en user_stories (el campo de texto libre de una HU
--    es narrative, con forma estructurada role/want/benefit, no un string
--    plano) y no se migra; se pierde en este cambio.
WITH numbered_epics AS (
  SELECT
    e."id",
    e."projectId",
    e."title",
    e."createdAt",
    p."key" AS "projectKey",
    p."storySeq" AS "baseSeq",
    ROW_NUMBER() OVER (PARTITION BY e."projectId" ORDER BY e."createdAt" ASC, e."id" ASC) AS "rn"
  FROM "epics" e
  JOIN "projects" p ON p."id" = e."projectId"
)
INSERT INTO "user_stories" (
  "id", "projectId", "key", "title", "narrative", "acceptanceCriteria",
  "priority", "storyPoints", "status", "isEpic", "epicId", "assigneeId",
  "createdById", "createdByAgentId", "createdAt", "updatedAt"
)
SELECT
  ne."id",
  ne."projectId",
  ne."projectKey" || '-' || (ne."baseSeq" + ne."rn")::text,
  ne."title",
  NULL,
  NULL,
  'medium',
  NULL,
  'backlog',
  true,
  NULL,
  NULL,
  NULL,
  NULL,
  ne."createdAt",
  ne."createdAt"
FROM numbered_epics ne;

-- 4) storySeq solo crece (invariante de nextStoryKey): se avanza acá el
--    contador de cada proyecto con épicas migradas, en la misma cantidad de
--    keys que se acaban de reservar arriba. No-op para proyectos sin épicas.
UPDATE "projects" p
SET "storySeq" = p."storySeq" + sub."epicCount"
FROM (
  SELECT "projectId", COUNT(*) AS "epicCount"
  FROM "epics"
  GROUP BY "projectId"
) sub
WHERE p."id" = sub."projectId";

-- 5) FK nueva: auto-relación dentro de user_stories. ON DELETE RESTRICT (no
--    SET NULL ni CASCADE): borrar una épica con hijas debe rechazarse en la
--    capa de servicios (opDeleteStory ya lo valida) antes de llegar a la DB;
--    si algo se escapa igual, Postgres corta en vez de dejar HUs huérfanas o
--    arrastrar un borrado en cascada no pedido.
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "user_stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) Índices nuevos: filtrar HUs normales vs. épicas por proyecto, y resolver
--    las hijas de una épica sin escanear toda la tabla.
CREATE INDEX "user_stories_projectId_isEpic_idx" ON "user_stories"("projectId", "isEpic");
CREATE INDEX "user_stories_epicId_idx" ON "user_stories"("epicId");

-- 7) La tabla vieja ya no tiene consumidores: sus índices/constraints propios
--    (epics_pkey, epics_projectId_idx, epics_projectId_fkey) caen con ella.
DROP TABLE "epics";
