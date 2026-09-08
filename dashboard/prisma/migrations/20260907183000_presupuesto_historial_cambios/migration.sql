-- Historial auditable de cambios de monto en presupuesto.
-- El monto_presupuestado queda como Original; monto_revisado representa el Vigente.
CREATE TYPE "TipoCambioPresupuesto" AS ENUM (
  'CREACION',
  'AJUSTE_MANUAL',
  'DESDE_SIN_ASIGNAR',
  'TRASPASO_ENTRADA',
  'TRASPASO_SALIDA',
  'MIGRACION_VIGENTE'
);

CREATE TABLE "presupuesto_cambios" (
  "id" SERIAL NOT NULL,
  "presupuesto_id" INTEGER NOT NULL,
  "quincena_id" INTEGER NOT NULL,
  "tipo" "TipoCambioPresupuesto" NOT NULL,
  "monto_anterior" DECIMAL(12,2) NOT NULL,
  "monto_nuevo" DECIMAL(12,2) NOT NULL,
  "delta" DECIMAL(12,2) NOT NULL,
  "grupo_cambio_id" VARCHAR(36),
  "presupuesto_relacionado_id" INTEGER,
  "motivo" VARCHAR(300),
  "actor" VARCHAR(50),
  "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "presupuesto_cambios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_presupuesto_cambios_presupuesto" ON "presupuesto_cambios"("presupuesto_id");
CREATE INDEX "idx_presupuesto_cambios_quincena" ON "presupuesto_cambios"("quincena_id");
CREATE INDEX "idx_presupuesto_cambios_grupo" ON "presupuesto_cambios"("grupo_cambio_id");
CREATE INDEX "idx_presupuesto_cambios_fecha" ON "presupuesto_cambios"("fecha_creacion");

ALTER TABLE "presupuesto_cambios"
  ADD CONSTRAINT "presupuesto_cambios_presupuesto_id_fkey"
  FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "presupuesto_cambios"
  ADD CONSTRAINT "presupuesto_cambios_quincena_id_fkey"
  FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "presupuesto_cambios"
  ADD CONSTRAINT "presupuesto_cambios_presupuesto_relacionado_id_fkey"
  FOREIGN KEY ("presupuesto_relacionado_id") REFERENCES "presupuesto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Toda línea existente obtiene un punto de partida explícito. La fecha de
-- creación real ya existía en presupuesto.fecha_registro, así que el backfill
-- conserva ese momento en vez de fingir que se creó hoy.
INSERT INTO "presupuesto_cambios" (
  "presupuesto_id", "quincena_id", "tipo", "monto_anterior", "monto_nuevo",
  "delta", "motivo", "fecha_creacion"
)
SELECT
  p."id",
  p."quincena_id",
  'CREACION'::"TipoCambioPresupuesto",
  0,
  p."monto_presupuestado",
  p."monto_presupuestado",
  'Alta inicial (backfill)',
  p."fecha_registro"
FROM "presupuesto" p;

-- Si una línea ya tenía monto_revisado antes de activar el historial, se
-- preserva el estado Vigente actual. No conocemos la fecha histórica exacta
-- de ese ajuste, por eso se marca con un tipo especial de migración.
INSERT INTO "presupuesto_cambios" (
  "presupuesto_id", "quincena_id", "tipo", "monto_anterior", "monto_nuevo",
  "delta", "motivo"
)
SELECT
  p."id",
  p."quincena_id",
  'MIGRACION_VIGENTE'::"TipoCambioPresupuesto",
  p."monto_presupuestado",
  p."monto_revisado",
  p."monto_revisado" - p."monto_presupuestado",
  'Estado vigente previo a activar historial de cambios'
FROM "presupuesto" p
WHERE p."monto_revisado" IS NOT NULL
  AND p."monto_revisado" <> p."monto_presupuestado";
