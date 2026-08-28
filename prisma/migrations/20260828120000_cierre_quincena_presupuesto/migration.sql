-- CreateEnum
CREATE TYPE "EstadoLineaPresupuesto" AS ENUM ('Abierta', 'Cumplida', 'Cancelada', 'Absorbida');

-- AlterTable
ALTER TABLE "presupuesto" ADD COLUMN "estado_linea" "EstadoLineaPresupuesto" NOT NULL DEFAULT 'Abierta';

-- AlterTable
ALTER TABLE "quincenas" ADD COLUMN "fecha_cierre" TIMESTAMPTZ,
ADD COLUMN "cerrada_por" VARCHAR(50);
