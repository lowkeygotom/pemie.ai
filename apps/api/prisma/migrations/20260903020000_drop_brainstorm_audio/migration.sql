-- Se retira el almacenamiento de audio de las sesiones de brainstorming.
--
-- El audio nunca fue necesario para la feature: Deepgram entrega el texto en vivo, y el grafo,
-- el acta y las propuestas de HU se construyen enteramente desde esa transcripción. Guardarlo
-- solo agregaba una dependencia (@vercel/blob), un store que provisionar y —lo que pesa de
-- verdad— grabaciones de voz de personas reales sin política de retención definida.
--
-- El borrado es seguro: la subida nunca llegó a funcionar en producción (el token del store no
-- existía y el endpoint respondía 500), así que ambas columnas están vacías. La evidencia de
-- cada idea sigue siendo su cita textual anclada al segmento, que es lo que el producto usa.
ALTER TABLE "brainstorm_sessions" DROP COLUMN IF EXISTS "audioUrl";
ALTER TABLE "brainstorm_sessions" DROP COLUMN IF EXISTS "audioBytes";
