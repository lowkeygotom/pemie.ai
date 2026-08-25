-- Tramos de actividad de agentes por proyecto.
--
-- Un latido no merece una fila: la pantalla necesita saber qué trabajo sigue
-- vivo y la historia necesita tramos legibles. Por eso cada fila agrupa
-- latidos idénticos de la misma API key y conserva el primer y último instante.
CREATE TABLE "agent_activities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "agentId" TEXT,
    "ownerUserId" TEXT,
    "summary" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'working',
    "userStoryId" TEXT,
    "cardId" TEXT,
    "paths" TEXT[] NOT NULL,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "model" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beats" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "agent_activities_pkey" PRIMARY KEY ("id")
);

-- La franja viva vence tramos por proyecto y la traza los recorre por actor.
CREATE INDEX "agent_activities_projectId_lastSeenAt_idx" ON "agent_activities"("projectId", "lastSeenAt");
CREATE INDEX "agent_activities_projectId_apiKeyId_lastSeenAt_idx" ON "agent_activities"("projectId", "apiKeyId", "lastSeenAt");

-- CASCADE en proyecto y key: sin el proyecto no hay contexto y sin la key no
-- queda una identidad verificable que explique el latido.
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL en agente, dueño, HU y tarjeta: todos aportan contexto opcional;
-- borrarlos no debe borrar un tramo histórico que la key todavía identifica.
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_userStoryId_fkey"
  FOREIGN KEY ("userStoryId") REFERENCES "user_stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
