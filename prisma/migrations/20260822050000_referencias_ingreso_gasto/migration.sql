-- Valores de referencia (no restrictivos) de ingreso y limite de gasto por
-- periodo, configurables desde Configuracion > Periodos de pago.
ALTER TABLE "configuracion" ADD COLUMN "ingreso_referencia" DECIMAL(12,2);
ALTER TABLE "configuracion" ADD COLUMN "limite_gasto_referencia" DECIMAL(12,2);

-- Permite excluir categorias puntuales (ej. Deudas) del calculo de "gasto
-- que cuenta para el limite de referencia". Todas cuentan por default.
ALTER TABLE "categorias" ADD COLUMN "cuenta_para_limite" BOOLEAN NOT NULL DEFAULT true;
