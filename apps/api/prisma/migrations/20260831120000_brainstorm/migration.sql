-- Memoria persistente del modo mesa: la sesión agrupa transcripción, grafo y
-- propuestas sin hacer que ninguno de esos detalles pese en el listado.
CREATE TABLE "brainstorm_sessions" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recording', "startedById" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3),
  "lastRecorderBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorderTokenHash" TEXT, "summary" TEXT, "audioUrl" TEXT, "audioBytes" INTEGER,
  "extractCursor" INTEGER NOT NULL DEFAULT 0, "extractLockId" TEXT,
  "extractLockUntil" TIMESTAMP(3), "extractRuns" INTEGER NOT NULL DEFAULT 0,
  "extractFailures" INTEGER NOT NULL DEFAULT 0, "lastExtractAt" TIMESTAMP(3),
  "extractionMode" TEXT NOT NULL DEFAULT 'auto', "nodeSeq" INTEGER NOT NULL DEFAULT 0,
  "segmentSeq" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "brainstorm_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_speakers" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "speakerTag" INTEGER NOT NULL,
  "label" TEXT NOT NULL, "contributorId" TEXT,
  CONSTRAINT "brainstorm_speakers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_segments" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "seq" INTEGER NOT NULL,
  "speakerTag" INTEGER, "text" TEXT NOT NULL, "startMs" INTEGER NOT NULL, "endMs" INTEGER NOT NULL,
  CONSTRAINT "brainstorm_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_nodes" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "key" TEXT NOT NULL,
  "type" TEXT NOT NULL, "title" TEXT NOT NULL, "detail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open', "firstSeq" INTEGER NOT NULL,
  "lastSeq" INTEGER NOT NULL, "editedByUserId" TEXT,
  CONSTRAINT "brainstorm_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_citations" (
  "id" TEXT NOT NULL, "nodeId" TEXT NOT NULL, "segmentSeq" INTEGER NOT NULL,
  "quote" VARCHAR(400) NOT NULL, "verbatim" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brainstorm_citations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_edges" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "fromNodeId" TEXT NOT NULL,
  "toNodeId" TEXT NOT NULL, "type" TEXT NOT NULL, "rationale" TEXT,
  CONSTRAINT "brainstorm_edges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brainstorm_story_proposals" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "nodeId" TEXT,
  "title" TEXT NOT NULL, "narrative" JSONB NOT NULL, "acceptanceCriteria" JSONB NOT NULL,
  "priority" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "userStoryId" TEXT,
  "decidedById" TEXT, "decidedAt" TIMESTAMP(3),
  CONSTRAINT "brainstorm_story_proposals_pkey" PRIMARY KEY ("id")
);

-- Cada pasada del motor deja telemetría durable: permite distinguir un motor
-- ocioso de uno roto y comprobar uso real del cache sin depender de logs efímeros.
CREATE TABLE "brainstorm_runs" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "runIndex" INTEGER NOT NULL,
  "fromSeq" INTEGER NOT NULL, "toSeq" INTEGER NOT NULL, "status" TEXT NOT NULL,
  "reason" TEXT, "model" TEXT, "latencyMs" INTEGER, "inputTokens" INTEGER,
  "cachedInputTokens" INTEGER, "outputTokens" INTEGER, "opsApplied" INTEGER NOT NULL DEFAULT 0,
  "opsRejected" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brainstorm_runs_pkey" PRIMARY KEY ("id")
);

-- Los uniques son los candados de idempotencia de reintentos de transcripción,
-- evidencia y extracción; los índices sostienen listados y ventanas por sesión.
CREATE UNIQUE INDEX "brainstorm_sessions_recorderTokenHash_key" ON "brainstorm_sessions"("recorderTokenHash");
CREATE UNIQUE INDEX "brainstorm_speakers_sessionId_speakerTag_key" ON "brainstorm_speakers"("sessionId", "speakerTag");
CREATE UNIQUE INDEX "brainstorm_segments_sessionId_seq_key" ON "brainstorm_segments"("sessionId", "seq");
CREATE UNIQUE INDEX "brainstorm_nodes_sessionId_key_key" ON "brainstorm_nodes"("sessionId", "key");
CREATE UNIQUE INDEX "brainstorm_citations_nodeId_segmentSeq_quote_key" ON "brainstorm_citations"("nodeId", "segmentSeq", "quote");
CREATE UNIQUE INDEX "brainstorm_edges_fromNodeId_toNodeId_type_key" ON "brainstorm_edges"("fromNodeId", "toNodeId", "type");
CREATE UNIQUE INDEX "brainstorm_runs_sessionId_runIndex_key" ON "brainstorm_runs"("sessionId", "runIndex");
CREATE INDEX "brainstorm_sessions_projectId_startedAt_idx" ON "brainstorm_sessions"("projectId", "startedAt");
CREATE INDEX "brainstorm_sessions_projectId_status_lastRecorderBeatAt_idx" ON "brainstorm_sessions"("projectId", "status", "lastRecorderBeatAt");
CREATE INDEX "brainstorm_speakers_sessionId_idx" ON "brainstorm_speakers"("sessionId");
CREATE INDEX "brainstorm_nodes_sessionId_status_idx" ON "brainstorm_nodes"("sessionId", "status");
CREATE INDEX "brainstorm_edges_sessionId_idx" ON "brainstorm_edges"("sessionId");
CREATE INDEX "brainstorm_runs_sessionId_createdAt_idx" ON "brainstorm_runs"("sessionId", "createdAt");
CREATE INDEX "brainstorm_story_proposals_sessionId_status_idx" ON "brainstorm_story_proposals"("sessionId", "status");

-- CASCADE desde el proyecto y la sesión: sin esa conversación, transcripción,
-- grafo y propuestas no tienen significado independiente que preservar.
ALTER TABLE "brainstorm_sessions" ADD CONSTRAINT "brainstorm_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_sessions" ADD CONSTRAINT "brainstorm_sessions_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_speakers" ADD CONSTRAINT "brainstorm_speakers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_segments" ADD CONSTRAINT "brainstorm_segments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_nodes" ADD CONSTRAINT "brainstorm_nodes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_citations" ADD CONSTRAINT "brainstorm_citations_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "brainstorm_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_edges" ADD CONSTRAINT "brainstorm_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_edges" ADD CONSTRAINT "brainstorm_edges_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "brainstorm_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_edges" ADD CONSTRAINT "brainstorm_edges_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "brainstorm_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_story_proposals" ADD CONSTRAINT "brainstorm_story_proposals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brainstorm_runs" ADD CONSTRAINT "brainstorm_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "brainstorm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL en referencias informativas: borrar una persona, contributor, nodo
-- derivado o HU no debe borrar la memoria histórica de la sesión.
ALTER TABLE "brainstorm_speakers" ADD CONSTRAINT "brainstorm_speakers_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "contributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brainstorm_nodes" ADD CONSTRAINT "brainstorm_nodes_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brainstorm_story_proposals" ADD CONSTRAINT "brainstorm_story_proposals_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "brainstorm_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brainstorm_story_proposals" ADD CONSTRAINT "brainstorm_story_proposals_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "user_stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brainstorm_story_proposals" ADD CONSTRAINT "brainstorm_story_proposals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
