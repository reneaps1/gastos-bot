-- Q29 debe iniciar el 15-jun (Lunes hábil), no el 16-jun
-- Q37 debe iniciar el 15-oct (Jueves hábil), no el 14-oct
-- Se extiende Q28 fin a 14-jun y Q36 fin a 14-oct para no dejar dias sin quincena

UPDATE "quincenas" SET "fecha_fin"    = '2026-06-14' WHERE "codigo" = 'Q28';
UPDATE "quincenas" SET "fecha_inicio" = '2026-06-15' WHERE "codigo" = 'Q29';

UPDATE "quincenas" SET "fecha_fin"    = '2026-10-14' WHERE "codigo" = 'Q36';
UPDATE "quincenas" SET "fecha_inicio" = '2026-10-15' WHERE "codigo" = 'Q37';

-- Reasignar transacciones del 15-jun de Q28 a Q29
UPDATE "transacciones"
SET
  "quincena_id"         = (SELECT id FROM "quincenas" WHERE "codigo" = 'Q29'),
  "quincena_consumo_id" = (SELECT id FROM "quincenas" WHERE "codigo" = 'Q29')
WHERE
  "quincena_id" = (SELECT id FROM "quincenas" WHERE "codigo" = 'Q28')
  AND "fecha" = '2026-06-15';
