-- La preferencia es individual y conserva el comportamiento existente en español.
ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'es';
