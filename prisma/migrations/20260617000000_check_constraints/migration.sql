-- CHECK constraints para garantizar integridad de montos y fechas
-- Identificados en auditoría de lógica financiera (2026-06-17)

-- Montos siempre positivos
ALTER TABLE transacciones
  ADD CONSTRAINT chk_transaccion_monto_positivo CHECK (monto > 0);

ALTER TABLE presupuesto
  ADD CONSTRAINT chk_presupuesto_monto_positivo CHECK (monto_presupuestado > 0);

ALTER TABLE credito_pagos
  ADD CONSTRAINT chk_credito_pago_monto_positivo CHECK (monto_total > 0);

-- Fechas de quincena coherentes
ALTER TABLE quincenas
  ADD CONSTRAINT chk_quincena_fechas CHECK (fecha_fin > fecha_inicio);

-- dia_cobro entre 1 y 31
ALTER TABLE presupuesto
  ADD CONSTRAINT chk_presupuesto_dia_cobro CHECK (dia_cobro IS NULL OR (dia_cobro >= 1 AND dia_cobro <= 31));
