-- Evoluciona Deudas hacia Créditos y Deudas sin romper el flujo actual.

CREATE TYPE "TipoCredito" AS ENUM (
  'Tarjeta',
  'CreditoTienda',
  'Prestamo',
  'MSI',
  'LineaCredito',
  'Informal',
  'Otro'
);

CREATE TYPE "EstatusCreditoPago" AS ENUM (
  'Pendiente',
  'Pagado',
  'Vencido',
  'Cancelado'
);

ALTER TABLE "transacciones"
  ADD COLUMN "quincena_consumo_id" INTEGER,
  ADD COLUMN "credito_id" INTEGER,
  ADD COLUMN "fecha_pago_programada" DATE;

UPDATE "transacciones"
SET "quincena_consumo_id" = "quincena_id"
WHERE "quincena_consumo_id" IS NULL;

CREATE TABLE "creditos" (
  "id" SERIAL NOT NULL,
  "nombre" VARCHAR(100) NOT NULL,
  "tipo_credito" "TipoCredito" NOT NULL DEFAULT 'Otro',
  "acreedor" VARCHAR(100) NOT NULL,
  "user_id" INTEGER,
  "monto_original" DECIMAL(12,2),
  "saldo_inicial" DECIMAL(12,2),
  "limite_credito" DECIMAL(12,2),
  "dia_corte" INTEGER,
  "dia_pago" INTEGER,
  "frecuencia_pago" VARCHAR(20),
  "monto_pago_fijo" DECIMAL(12,2),
  "plazo_meses" INTEGER,
  "tasa_interes" DECIMAL(7,4),
  "cuenta_pago_id" INTEGER,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "notas" TEXT,
  "fecha_inicio" DATE,
  "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "creditos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creditos_nombre_key" UNIQUE ("nombre"),
  CONSTRAINT "creditos_dia_corte_check" CHECK ("dia_corte" IS NULL OR "dia_corte" BETWEEN 1 AND 31),
  CONSTRAINT "creditos_dia_pago_check" CHECK ("dia_pago" IS NULL OR "dia_pago" BETWEEN 1 AND 31)
);

CREATE TABLE "credito_pagos" (
  "id" SERIAL NOT NULL,
  "credito_id" INTEGER NOT NULL,
  "transaccion_id" INTEGER,
  "quincena_id" INTEGER NOT NULL,
  "categoria_id" INTEGER NOT NULL,
  "presupuesto_id" INTEGER,
  "numero_pago" INTEGER,
  "total_pagos" INTEGER,
  "fecha_pago_programada" DATE NOT NULL,
  "fecha_pago_real" DATE,
  "monto_capital" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "monto_interes" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "monto_total" DECIMAL(12,2) NOT NULL,
  "estatus" "EstatusCreditoPago" NOT NULL DEFAULT 'Pendiente',
  "notas" TEXT,
  "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "credito_pagos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credito_pagos_monto_total_check" CHECK ("monto_total" > 0)
);

CREATE INDEX "idx_tx_quincena_consumo" ON "transacciones"("quincena_consumo_id");
CREATE INDEX "idx_tx_credito" ON "transacciones"("credito_id");
CREATE INDEX "idx_creditos_tipo" ON "creditos"("tipo_credito");
CREATE INDEX "idx_creditos_user" ON "creditos"("user_id");
CREATE INDEX "idx_credito_pagos_credito" ON "credito_pagos"("credito_id");
CREATE INDEX "idx_credito_pagos_quincena" ON "credito_pagos"("quincena_id");
CREATE INDEX "idx_credito_pagos_categoria" ON "credito_pagos"("categoria_id");
CREATE INDEX "idx_credito_pagos_estatus" ON "credito_pagos"("estatus");
CREATE INDEX "idx_credito_pagos_fecha" ON "credito_pagos"("fecha_pago_programada");

ALTER TABLE "creditos"
  ADD CONSTRAINT "creditos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "creditos_cuenta_pago_id_fkey" FOREIGN KEY ("cuenta_pago_id") REFERENCES "cuentas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transacciones"
  ADD CONSTRAINT "transacciones_quincena_consumo_id_fkey" FOREIGN KEY ("quincena_consumo_id") REFERENCES "quincenas"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "transacciones_credito_id_fkey" FOREIGN KEY ("credito_id") REFERENCES "creditos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credito_pagos"
  ADD CONSTRAINT "credito_pagos_credito_id_fkey" FOREIGN KEY ("credito_id") REFERENCES "creditos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "credito_pagos_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transacciones"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "credito_pagos_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "credito_pagos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "credito_pagos_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "metodos_pago" ("nombre")
VALUES ('Credito')
ON CONFLICT ("nombre") DO NOTHING;
