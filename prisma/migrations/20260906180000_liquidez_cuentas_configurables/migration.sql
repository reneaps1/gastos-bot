-- Convierte las cuentas de un corte de liquidez (antes columnas fijas
-- bbva/banamex/uala/uala_inversion/efectivo/vales_despensa/vales_gasolina/
-- otros) en líneas dinámicas contra el catálogo "cuentas" (el mismo que ya
-- se usa como cuenta de pago de un Crédito), para que se puedan
-- activar/crear/eliminar/renombrar cuentas desde Configuración > Cuentas sin
-- tocar el esquema.

-- 1. Metadata de UI + activo/orden en el catálogo de cuentas.
ALTER TABLE "cuentas" ADD COLUMN "icono" VARCHAR(30);
ALTER TABLE "cuentas" ADD COLUMN "color" VARCHAR(20);
ALTER TABLE "cuentas" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "cuentas" ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cuentas" ADD COLUMN "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Asigna icono/color/orden/tipo por defecto a las cuentas ya sembradas
-- (ver prisma/seed.js), si existen con esos nombres exactos.
UPDATE "cuentas" SET tipo = 'Debito',    icono = 'Landmark',         color = 'blue',    orden = 1 WHERE nombre = 'BBVA';
UPDATE "cuentas" SET tipo = 'Debito',    icono = 'Landmark',         color = 'rose',    orden = 2 WHERE nombre = 'Banamex';
UPDATE "cuentas" SET tipo = 'Debito',    icono = 'Wallet',           color = 'violet',  orden = 3 WHERE nombre = 'Ualá';
UPDATE "cuentas" SET tipo = 'Inversion', icono = 'TrendingUp',       color = 'emerald', orden = 4 WHERE nombre = 'Ualá Inversión';
UPDATE "cuentas" SET tipo = 'Efectivo',  icono = 'Banknote',         color = 'teal',    orden = 5 WHERE nombre = 'Efectivo';
UPDATE "cuentas" SET tipo = 'Vales',     icono = 'ShoppingBag',      color = 'amber',   orden = 6 WHERE nombre = 'Vales Despensa';
UPDATE "cuentas" SET tipo = 'Vales',     icono = 'Fuel',             color = 'orange',  orden = 7 WHERE nombre = 'Vales Gasolina';

-- 3. Si el entorno no tenía ya estas cuentas sembradas (o le faltaba
-- "Otros", que antes era solo un par de columnas sueltas), se crean para
-- poder migrar los snapshots existentes sin perder datos.
INSERT INTO "cuentas" (nombre, tipo, icono, color, activo, orden)
VALUES
  ('BBVA',            'Debito',    'Landmark',    'blue',    true, 1),
  ('Banamex',         'Debito',    'Landmark',    'rose',    true, 2),
  ('Ualá',            'Debito',    'Wallet',      'violet',  true, 3),
  ('Ualá Inversión',  'Inversion', 'TrendingUp',  'emerald', true, 4),
  ('Efectivo',        'Efectivo',  'Banknote',    'teal',    true, 5),
  ('Vales Despensa',  'Vales',     'ShoppingBag', 'amber',   true, 6),
  ('Vales Gasolina',  'Vales',     'Fuel',        'orange',  true, 7),
  ('Otros',           'Otro',      'CircleDollarSign', 'slate', true, 8)
ON CONFLICT (nombre) DO NOTHING;

-- 4. Tabla de líneas por cuenta de un corte de liquidez.
CREATE TABLE "liquidez_snapshot_cuentas" (
  "id"          SERIAL PRIMARY KEY,
  "snapshot_id" INTEGER NOT NULL REFERENCES "liquidez_snapshots"("id") ON DELETE CASCADE,
  "cuenta_id"   INTEGER NOT NULL REFERENCES "cuentas"("id"),
  "monto"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "nota"        TEXT,
  CONSTRAINT "liquidez_snapshot_cuentas_snapshot_id_cuenta_id_key" UNIQUE ("snapshot_id", "cuenta_id")
);
CREATE INDEX "idx_liquidez_snapshot_cuentas_cuenta" ON "liquidez_snapshot_cuentas"("cuenta_id");

-- 5. Migra los montos de las columnas fijas de liquidez_snapshots a filas
-- dinámicas por cuenta, preservando el histórico. otros_nota pasa a ser la
-- "nota" de la línea de la cuenta "Otros" (generaliza a cualquier cuenta).
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.bbva FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'BBVA';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.banamex FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Banamex';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.uala FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Ualá';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.uala_inversion FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Ualá Inversión';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.efectivo FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Efectivo';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.vales_despensa FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Vales Despensa';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto)
SELECT ls.id, c.id, ls.vales_gasolina FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Vales Gasolina';
INSERT INTO "liquidez_snapshot_cuentas" (snapshot_id, cuenta_id, monto, nota)
SELECT ls.id, c.id, ls.otros, ls.otros_nota FROM "liquidez_snapshots" ls, "cuentas" c WHERE c.nombre = 'Otros';

-- 6. Ya migrados, las columnas fijas sobran.
ALTER TABLE "liquidez_snapshots" DROP COLUMN "bbva";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "banamex";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "uala";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "uala_inversion";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "efectivo";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "vales_despensa";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "vales_gasolina";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "otros";
ALTER TABLE "liquidez_snapshots" DROP COLUMN "otros_nota";
