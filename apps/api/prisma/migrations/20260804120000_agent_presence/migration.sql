-- Presencia de agentes por workspace.
--
-- Las API keys de alcance `workspace` y `user` no llevan `agentId` (createApiKey
-- lo rechaza) ni `projectId`, así que no existe fila en `agents` que las
-- represente. El roster de Equipo lista `agents` y solo eso: una key ajena que
-- opera en tu workspace es hoy invisible, y el AuditLog la nombra por el id de
-- la key. Esta tabla es el rastro que faltaba.
--
-- Puramente aditiva y sin backfill: no hay dato histórico del que deducir en qué
-- workspaces estuvo cada key (`lastUsedAt` guarda un instante, no un lugar).
-- La tabla se llena sola con el siguiente uso de cada key.
CREATE TABLE "agent_presences" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lastProjectId" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedById" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_presences_pkey" PRIMARY KEY ("id")
);

-- La unique es el candado de idempotencia del upsert de admisión: una presencia
-- por (key, workspace), sin importar cuántas tool calls entren en paralelo.
CREATE UNIQUE INDEX "agent_presences_apiKeyId_workspaceId_key" ON "agent_presences"("apiKeyId", "workspaceId");

-- El roster de Equipo lee siempre por workspace.
CREATE INDEX "agent_presences_workspaceId_idx" ON "agent_presences"("workspaceId");

-- CASCADE en key y workspace: la presencia es un rastro de uso, no tiene sentido
-- sin su key ni fuera de su workspace. `lastProjectId` va SET NULL porque es un
-- dato informativo: borrar el proyecto no debe borrar el rastro del agente.
ALTER TABLE "agent_presences" ADD CONSTRAINT "agent_presences_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_presences" ADD CONSTRAINT "agent_presences_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_presences" ADD CONSTRAINT "agent_presences_lastProjectId_fkey"
  FOREIGN KEY ("lastProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL: si se borra la persona que bloqueó, el bloqueo sigue en pie. Perder
-- la autoría es aceptable; levantar el bloqueo solo se hace explícitamente.
ALTER TABLE "agent_presences" ADD CONSTRAINT "agent_presences_blockedById_fkey"
  FOREIGN KEY ("blockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
