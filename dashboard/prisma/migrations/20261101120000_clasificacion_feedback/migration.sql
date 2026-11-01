-- Retroalimentacion del clasificador de categorias (src/clasificador/).
--
-- Una fila por gasto de Telegram al que el bot le propuso una categoria y le
-- pregunto "¿Es correcta?". Guarda que se propuso, de donde salio (el modelo
-- o las reglas de siempre), con que confianza y que contesto el usuario.
-- Sirve para tres cosas:
--   1. Que el modelo NO se entrene con sus propias adivinanzas sin confirmar
--      (las `pendiente` se excluyen al entrenar).
--   2. Que una correccion pese mas que un dato historico.
--   3. Medir: que porcentaje de propuestas acepta el usuario, por fuente.
--
-- Es una tabla NUEVA y aditiva: no toca ninguna existente. Todo es
-- IF NOT EXISTS porque dos historias de migraciones (raiz y dashboard/) corren
-- contra la misma base.
--
-- Las categorias se guardan como enteros sin FK a proposito: esto es una
-- bitacora; si un dia se borra una categoria, la historia de lo que se
-- propuso no debe impedirlo ni desaparecer con ella.
CREATE TABLE IF NOT EXISTS "clasificacion_feedback" (
  "id" SERIAL NOT NULL,
  "transaccion_id" INTEGER NOT NULL,
  "texto" VARCHAR(200) NOT NULL,
  "categoria_propuesta_id" INTEGER NOT NULL,
  "categoria_final_id" INTEGER,
  "fuente" VARCHAR(20) NOT NULL,
  "confianza" DECIMAL(5,4),
  "estado" VARCHAR(15) NOT NULL DEFAULT 'pendiente',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resuelta_en" TIMESTAMPTZ,

  CONSTRAINT "clasificacion_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clasificacion_feedback_transaccion_id_key"
  ON "clasificacion_feedback" ("transaccion_id");

CREATE INDEX IF NOT EXISTS "idx_clasif_feedback_estado"
  ON "clasificacion_feedback" ("estado");

-- Si se borra el gasto, su retroalimentacion ya no describe nada real.
DO $$
BEGIN
  ALTER TABLE "clasificacion_feedback"
    ADD CONSTRAINT "clasificacion_feedback_transaccion_id_fkey"
    FOREIGN KEY ("transaccion_id") REFERENCES "transacciones"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
