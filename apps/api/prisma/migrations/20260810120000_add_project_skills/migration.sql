-- CreateTable
CREATE TABLE "project_skills" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "files" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedByType" TEXT NOT NULL DEFAULT 'agent',
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_skills_projectId_updatedAt_idx" ON "project_skills"("projectId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_skills_projectId_slug_key" ON "project_skills"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

