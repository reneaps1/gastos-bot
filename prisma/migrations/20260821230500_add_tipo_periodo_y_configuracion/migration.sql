-- CreateEnum
CREATE TYPE "TipoPeriodo" AS ENUM ('QUINCENAL', 'SEMANAL', 'MENSUAL');

-- AlterTable: cada quincena/periodo registra su cadencia (todas las existentes
-- se marcan QUINCENAL por default, que es lo que ya eran).
ALTER TABLE "quincenas" ADD COLUMN "tipo" "TipoPeriodo" NOT NULL DEFAULT 'QUINCENAL';

-- CreateTable: fila unica (id=1) de ajustes globales. frecuencia_pago_default
-- controla la cadencia sugerida al agregar un periodo nuevo desde
-- Configuracion > Periodos de pago.
CREATE TABLE "configuracion" (
    "id" SERIAL NOT NULL,
    "frecuencia_pago_default" "TipoPeriodo" NOT NULL DEFAULT 'QUINCENAL',
    "fecha_actualizacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "configuracion" ("frecuencia_pago_default") VALUES ('QUINCENAL');
