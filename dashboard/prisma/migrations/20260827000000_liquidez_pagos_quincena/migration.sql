-- "Pagos que caen esta quincena": cuanto efectivo va a salir del banco EN
-- esta quincena (pendientes directos + abonos de credito/TDC programados via
-- credito_pagos + presupuesto sin ejecutar), a diferencia de "falta_pagar"
-- que mide ejecucion de presupuesto por linea, sin importar cuando sale la
-- caja. Antes de esto no habia forma de saber que una compra a credito
-- comprometia el efectivo de una quincena futura distinta a la de compra.
ALTER TABLE "liquidez_snapshots" ADD COLUMN "pagos_quincena" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: en todo el historial, pagos-que-caen-esta-quincena coincidia
-- exactamente con falta-por-pagar (no se usaba TDC), asi que es un punto de
-- partida correcto para snapshots existentes.
UPDATE "liquidez_snapshots" SET "pagos_quincena" = "falta_pagar";
