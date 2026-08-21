-- Las keys personales pertenecen a la persona, no a su primer workspace: por eso
-- `workspaceId` pasa a ser opcional y las keys `user` existentes lo pierden.
--
-- Las FK siguen en CASCADE a propósito: sobre una columna nullable, borrar un
-- workspace se sigue llevando sus keys y su auditoría de equipo (comportamiento
-- de siempre) sin tocar las filas personales, que ya tienen NULL.
ALTER TABLE "api_keys" ALTER COLUMN "workspaceId" DROP NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "workspaceId" DROP NOT NULL;

UPDATE "api_keys" SET "workspaceId" = NULL WHERE "scopeLevel" = 'user';
