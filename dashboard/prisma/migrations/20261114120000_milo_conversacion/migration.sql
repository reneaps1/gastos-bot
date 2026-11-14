-- Memoria de conversacion de Milo (src/memoriaMilo.js): las ultimas vueltas
-- (pregunta + respuesta) por chat.
--
-- Por que una tabla: la memoria vivia solo en el proceso, y en el plan gratis
-- Render duerme el servicio a los 15 minutos y cada deploy lo reinicia. Milo
-- perdia el hilo a media platica (2026-11-14, corte de liquidez).
--
-- No es un historial: el bot lee solo los ultimos 30 minutos y borra lo que
-- tenga mas de 24 horas cada vez que escribe.
--
-- Tabla NUEVA y aditiva. IF NOT EXISTS porque dos historias de migraciones
-- (raiz y dashboard/) corren contra la misma base.
CREATE TABLE IF NOT EXISTS "milo_conversacion" (
  "id" SERIAL NOT NULL,
  "chat_id" VARCHAR(40) NOT NULL,
  "autor" VARCHAR(40),
  "pregunta" TEXT NOT NULL,
  "respuesta" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "milo_conversacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_milo_conversacion_chat_fecha"
  ON "milo_conversacion" ("chat_id", "created_at");
