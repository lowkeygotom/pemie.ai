-- Dueño explícito del agente (PEM-35).
--
-- `Agent` colgaba solo del proyecto: `createAgent` recibía el `userId` de quien
-- lo creaba, lo usaba para verificar permisos y lo descartaba. En un workspace
-- compartido eso deja agentes que nadie sabe a quién reclamar.
--
-- La columna es **nullable permanente**, no un paso intermedio hacia NOT NULL:
-- los agentes anteriores a esta migración no se pueden rellenar. `createAgent`
-- era la única operación de agentes sin `audit()`, así que no quedó registro de
-- quién los creó. Atribuirlos por conveniencia (p. ej. al dueño de alguna de sus
-- API keys) sería inventar un dato: las keys se revocan y se regeneran, y el
-- agente cambiaría de dueño solo. La UI los muestra como «sin dueño registrado».
ALTER TABLE "agents" ADD COLUMN "ownerId" TEXT;

-- ON DELETE SET NULL, no CASCADE: un agente con API keys vivas no puede
-- desaparecer porque se borre una persona. Es una red de seguridad, no el
-- mecanismo del criterio «el dueño ya no está en el equipo» — hoy el producto
-- no borra usuarios, solo membresías (`removeMember`), y en ese caso el `User`
-- sigue existiendo y este FK ni se entera. Presencia en el equipo se resuelve
-- contra las membresías, no contra este campo.
ALTER TABLE "agents" ADD CONSTRAINT "agents_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sin índice sobre ownerId a propósito: ninguna query filtra por dueño, solo lo
-- incluye en el payload de Equipo. Se agrega cuando llegue reasignar o filtrar.
