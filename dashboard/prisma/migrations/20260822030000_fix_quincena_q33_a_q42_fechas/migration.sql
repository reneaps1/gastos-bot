-- La base de datos se sembro originalmente con la tabla vieja de ddl_plan.md
-- (antes de que se definiera la regla de "ultimo dia habil del mes" para los
-- cierres de fin de mes de Q33 en adelante). La migracion
-- 20260616000000_fix_quincena_q28_q29_q36_q37_dates ya corrigio 4 campos
-- puntuales (Q28.fecha_fin, Q29.fecha_inicio, Q36.fecha_fin, Q37.fecha_inicio)
-- pero dejo sin corregir estos 10 campos de Q33 a Q42. Esto era invisible
-- porque el bot resolvia la quincena con un arreglo fijo en el codigo
-- (src/quincenas.js, con las fechas correctas) y solo usaba esta tabla para
-- buscar el renglon por codigo, no por fecha. Ahora que el bot lee las
-- fechas de esta tabla en vivo, hay que corregirlas para que coincidan con
-- src/quincenas.js / DEVELOPMENT_POLICY.md.

UPDATE "quincenas" SET "fecha_fin"    = '2026-08-31' WHERE "codigo" = 'Q33';
UPDATE "quincenas" SET "fecha_inicio" = '2026-09-01' WHERE "codigo" = 'Q34';
UPDATE "quincenas" SET "fecha_fin"    = '2026-09-30' WHERE "codigo" = 'Q35';
UPDATE "quincenas" SET "fecha_inicio" = '2026-10-01' WHERE "codigo" = 'Q36';
UPDATE "quincenas" SET "fecha_fin"    = '2026-10-30' WHERE "codigo" = 'Q37';
UPDATE "quincenas" SET "fecha_inicio" = '2026-10-31' WHERE "codigo" = 'Q38';
UPDATE "quincenas" SET "fecha_fin"    = '2026-11-30' WHERE "codigo" = 'Q39';
UPDATE "quincenas" SET "fecha_inicio" = '2026-12-01' WHERE "codigo" = 'Q40';
UPDATE "quincenas" SET "fecha_fin"    = '2026-12-31' WHERE "codigo" = 'Q41';
UPDATE "quincenas" SET "fecha_inicio" = '2027-01-01' WHERE "codigo" = 'Q42';
