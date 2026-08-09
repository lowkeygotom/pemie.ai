ALTER TABLE "contributors" ADD COLUMN "email" TEXT;

CREATE TABLE "assignment_notifications" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignment_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assignment_notifications_storyId_contributorId_key" ON "assignment_notifications"("storyId", "contributorId");
CREATE INDEX "assignment_notifications_notifiedAt_idx" ON "assignment_notifications"("notifiedAt");
