-- Nullable: a diferencia de User.locale, una key sin preferencia propia cae al
-- dueño (scopeLevel = user) o a "es" en tiempo de ejecución, no en la DB.
ALTER TABLE "api_keys" ADD COLUMN "locale" TEXT;
