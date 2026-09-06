-- Hilo de comentarios por linea de presupuesto (autor + fecha + texto),
-- distinto del campo notas (una sola nota sin autor que se sobreescribe).
-- Ver dashboard/prisma/schema.prisma: model ComentarioPresupuesto.
CREATE TABLE IF NOT EXISTS "comentarios_presupuesto" (
    "id" SERIAL NOT NULL,
    "presupuesto_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "texto" TEXT NOT NULL,
    "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comentarios_presupuesto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_comentario_presupuesto" ON "comentarios_presupuesto"("presupuesto_id");

ALTER TABLE "comentarios_presupuesto"
    ADD CONSTRAINT "comentarios_presupuesto_presupuesto_id_fkey"
    FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comentarios_presupuesto"
    ADD CONSTRAINT "comentarios_presupuesto_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
