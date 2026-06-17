-- CHECK constraints para garantizar integridad de montos y fechas
-- NOT VALID: aplica solo a filas nuevas, no valida datos históricos existentes
-- DROP IF EXISTS: idempotente por si una ejecución previa fue parcial

ALTER TABLE transacciones DROP CONSTRAINT IF EXISTS chk_transaccion_monto_positivo;
ALTER TABLE transacciones
  ADD CONSTRAINT chk_transaccion_monto_positivo CHECK (monto > 0) NOT VALID;

ALTER TABLE presupuesto DROP CONSTRAINT IF EXISTS chk_presupuesto_monto_positivo;
ALTER TABLE presupuesto
  ADD CONSTRAINT chk_presupuesto_monto_positivo CHECK (monto_presupuestado > 0) NOT VALID;

ALTER TABLE credito_pagos DROP CONSTRAINT IF EXISTS chk_credito_pago_monto_positivo;
ALTER TABLE credito_pagos
  ADD CONSTRAINT chk_credito_pago_monto_positivo CHECK (monto_total > 0) NOT VALID;

ALTER TABLE quincenas DROP CONSTRAINT IF EXISTS chk_quincena_fechas;
ALTER TABLE quincenas
  ADD CONSTRAINT chk_quincena_fechas CHECK (fecha_fin > fecha_inicio) NOT VALID;

ALTER TABLE presupuesto DROP CONSTRAINT IF EXISTS chk_presupuesto_dia_cobro;
ALTER TABLE presupuesto
  ADD CONSTRAINT chk_presupuesto_dia_cobro CHECK (dia_cobro IS NULL OR (dia_cobro >= 1 AND dia_cobro <= 31)) NOT VALID;
