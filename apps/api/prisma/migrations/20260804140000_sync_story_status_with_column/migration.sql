-- Alinea el estado de las HUs con la columna donde ya está su tarjeta.
--
-- Hasta ahora `user_stories.status` y la columna de la Card vivían sueltos: crear
-- la HU dejaba la tarjeta en Backlog aunque el estado fuera otro, editar el estado
-- no movía la tarjeta y arrastrarla no tocaba el estado. El código pasa a
-- sincronizar los tres caminos; esta migración arregla lo que quedó desalineado.
--
-- Gana la columna: es lo que alguien movió a propósito en el tablero, mientras que
-- el `status` divergente suele ser el default de creación que nadie eligió.
--
-- El mapeo order -> estado es el mismo de STATUS_COLUMN_ORDER (@pemie/shared) y
-- DEFAULT_COLUMNS (services/board.ts). Una columna con otro `order` no aparece en
-- el VALUES y el JOIN la descarta: su HU se queda como está, igual que hace
-- `statusForColumnOrder` al devolver null.
UPDATE "user_stories" us
SET "status" = m."status",
    -- El contenido de la fila cambió de verdad; dejar `updatedAt` viejo haría que
    -- la UI muestre como reciente un estado que ya no es el guardado.
    "updatedAt" = NOW()
FROM "cards" c
JOIN "columns" col ON col."id" = c."columnId"
JOIN (
  VALUES (0, 'backlog'), (1, 'ready'), (2, 'in_progress'), (3, 'review'), (4, 'done')
) AS m("order", "status") ON m."order" = col."order"
WHERE c."userStoryId" = us."id"
  AND us."status" <> m."status";
