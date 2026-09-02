-- Apartados de ahorro + direccion (Aporte/Retiro) en transacciones.
-- Idempotente: esta migracion vive en dos historias de migracion separadas
-- (prisma/migrations y dashboard/prisma/migrations) que aplican contra la
-- misma base fisica, como ya hace 20260617000000_check_constraints.

-- CreateEnum (guardado, evita "type already exists" en la segunda historia)
DO $$ BEGIN
  CREATE TYPE "DireccionAhorro" AS ENUM ('Aporte', 'Retiro');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "apartados" (
  "id" SERIAL PRIMARY KEY,
  "nombre" VARCHAR(50) NOT NULL,
  "meta_monto" DECIMAL(12,2),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "apartados" ADD CONSTRAINT "apartados_nombre_key" UNIQUE ("nombre");
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "transacciones" ADD COLUMN IF NOT EXISTS "direccion" "DireccionAhorro";
ALTER TABLE "transacciones" ADD COLUMN IF NOT EXISTS "apartado_id" INTEGER;

ALTER TABLE "transacciones" DROP CONSTRAINT IF EXISTS "transacciones_apartado_id_fkey";
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_apartado_id_fkey"
  FOREIGN KEY ("apartado_id") REFERENCES "apartados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_tx_apartado" ON "transacciones"("apartado_id");

-- Backfill: toda transaccion existente de categoria "Ahorro" (identificada
-- por categorias.tipo, la clasificacion fija y confiable) debe quedar con
-- tipo='Ahorro' y una direccion correcta, sin importar como se guardo antes
-- de este fix (tipo='Gasto' -> Aporte, tipo='Ingreso' -> Retiro, tipo ya
-- 'Ahorro' -> se asume Aporte al no tener forma de saber la direccion
-- original). Idempotente: en una segunda corrida ya no hay filas que
-- cambien.
UPDATE "transacciones" t
SET "direccion" = CASE WHEN t."tipo" = 'Ingreso' THEN 'Retiro' ELSE 'Aporte' END::"DireccionAhorro",
    "tipo" = 'Ahorro'
FROM "categorias" c
WHERE t."categoria_id" = c."id" AND c."tipo" = 'Ahorro' AND t."direccion" IS NULL;
