-- Permite fijar ingreso/limite de gasto de referencia por quincena especifica,
-- sobreescribiendo (solo para ese periodo) el valor global de Configuracion.
-- NULL = usa el global. Ver dashboard/src/lib/referencia.ts.
ALTER TABLE "quincenas" ADD COLUMN "ingreso_referencia" DECIMAL(12,2);
ALTER TABLE "quincenas" ADD COLUMN "limite_gasto_referencia" DECIMAL(12,2);
