-- Ejemplos sueltos para el clasificador (src/clasificador/), escritos por el
-- usuario en la sesion de entrenamiento "Yo te escribo palabras"
-- (src/entrenamientoPalabras.js).
--
-- Una fila por palabra o frase ("croquetas") que el usuario le escribio al bot
-- para que adivinara la linea. NO es un gasto: no tiene monto ni quincena.
-- Cuando el usuario confirma o corrige, se guarda el NOMBRE de la linea (las
-- lineas se repiten cada quincena con otro id) y la categoria de esa linea, y
-- la fila entra al entrenamiento de los dos modelos. Sin esta tabla, lo
-- aprendido con palabras sueltas se perderia en cada reinicio, porque el
-- modelo se reentrena desde Postgres.
--
-- `acerto` guarda si la linea que propuso el bot fue la correcta: es el
-- marcador de la sesion.
--
-- Tabla NUEVA y aditiva: no toca ninguna existente. IF NOT EXISTS porque dos
-- historias de migraciones (raiz y dashboard/) corren contra la misma base.
CREATE TABLE IF NOT EXISTS "clasificador_ejemplos" (
  "id" SERIAL NOT NULL,
  "texto" VARCHAR(200) NOT NULL,
  "linea_descripcion" VARCHAR(200),
  "categoria_id" INTEGER,
  "estado" VARCHAR(15) NOT NULL DEFAULT 'pendiente',
  "acerto" BOOLEAN,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resuelto_en" TIMESTAMPTZ,

  CONSTRAINT "clasificador_ejemplos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_clasif_ejemplos_estado"
  ON "clasificador_ejemplos" ("estado");
