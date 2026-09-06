-- Icono y color elegibles por Apartado (meta de ahorro). Nullable -- las
-- filas existentes quedan sin icono/color; la UI cae al PiggyBank azul de
-- siempre en ese caso (ver dashboard/src/lib/apartado-icons.ts).
ALTER TABLE "apartados" ADD COLUMN IF NOT EXISTS "icono" VARCHAR(30);
ALTER TABLE "apartados" ADD COLUMN IF NOT EXISTS "color" VARCHAR(20);
