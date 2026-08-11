-- Catálogo de skills: mudanza de proyecto → workspace + archivos normalizados + tickets de transfer.
-- IMPORTANTE: esta migración NO borra project_skills. El DROP vive en
-- 20260811040100_drop_project_skills y NO se aplica hasta verificar el backfill.

-- CreateTable
CREATE TABLE "workspace_skills" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "publishedByType" TEXT NOT NULL DEFAULT 'agent',
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_skill_files" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "workspace_skill_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_uploads" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_downloads" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_skills_workspaceId_updatedAt_idx" ON "workspace_skills"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_skills_workspaceId_slug_key" ON "workspace_skills"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_skill_files_skillId_path_key" ON "workspace_skill_files"("skillId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "skill_uploads_tokenHash_key" ON "skill_uploads"("tokenHash");

-- CreateIndex
CREATE INDEX "skill_uploads_expiresAt_idx" ON "skill_uploads"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "skill_downloads_tokenHash_key" ON "skill_downloads"("tokenHash");

-- CreateIndex
CREATE INDEX "skill_downloads_expiresAt_idx" ON "skill_downloads"("expiresAt");

-- AddForeignKey
ALTER TABLE "workspace_skills" ADD CONSTRAINT "workspace_skills_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_skill_files" ADD CONSTRAINT "workspace_skill_files_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "workspace_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_uploads" ADD CONSTRAINT "skill_uploads_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_downloads" ADD CONSTRAINT "skill_downloads_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "workspace_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: project_skills → workspace_skills (workspaceId del proyecto padre).
-- Colisión de slug en el mismo workspace: gana updatedAt más reciente; el otro
-- queda con sufijo -<projectKey> para no perder el artefacto.
-- project_skills queda intacta a propósito (ver migración 2).
WITH ranked AS (
  SELECT
    ps.*,
    p."workspaceId" AS "workspaceId",
    p.key AS "projectKey",
    ROW_NUMBER() OVER (
      PARTITION BY p."workspaceId", ps.slug
      ORDER BY ps."updatedAt" DESC, ps.id ASC
    ) AS rn
  FROM "project_skills" ps
  JOIN "projects" p ON p.id = ps."projectId"
)
INSERT INTO "workspace_skills" (
  "id", "workspaceId", "slug", "name", "description", "version",
  "contentHash", "totalBytes", "publishedByType", "publishedById",
  "createdAt", "updatedAt"
)
SELECT
  r.id,
  r."workspaceId",
  CASE WHEN r.rn = 1 THEN r.slug ELSE r.slug || '-' || lower(r."projectKey") END,
  r.name,
  r.description,
  r.version,
  r."contentHash",
  COALESCE((
    SELECT SUM(octet_length(f.elem->>'content'))::int
    FROM jsonb_array_elements(r.files) AS f(elem)
  ), 0),
  r."publishedByType",
  r."publishedById",
  r."createdAt",
  r."updatedAt"
FROM ranked r;

INSERT INTO "workspace_skill_files" ("id", "skillId", "path", "content", "bytes")
SELECT
  gen_random_uuid()::text,
  r.id,
  f.elem->>'path',
  COALESCE(f.elem->>'content', ''),
  octet_length(COALESCE(f.elem->>'content', ''))
FROM (
  SELECT
    ps.*,
    p."workspaceId" AS "workspaceId",
    p.key AS "projectKey",
    ROW_NUMBER() OVER (
      PARTITION BY p."workspaceId", ps.slug
      ORDER BY ps."updatedAt" DESC, ps.id ASC
    ) AS rn
  FROM "project_skills" ps
  JOIN "projects" p ON p.id = ps."projectId"
) r
CROSS JOIN LATERAL jsonb_array_elements(r.files) AS f(elem)
WHERE f.elem->>'path' IS NOT NULL;
