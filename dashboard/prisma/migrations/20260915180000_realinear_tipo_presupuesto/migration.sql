-- Realinea Presupuesto.tipo con el tipo de su categoria.
--
-- `presupuesto.tipo` es una copia derivada del tipo de la categoria, no un dato
-- independiente: la API ya no acepta otro valor y lo resuelve contra la
-- categoria en cada alta y en cada edicion. Pero las filas creadas antes de esa
-- validacion pudieron quedar con los dos campos en desacuerdo, y entonces cada
-- pantalla decidia distinto:
--
--   - el dashboard clasifica por categoria (ver tipoDeLinea en
--     dashboard/src/lib/presupuesto-totales.ts), asi que separaba bien;
--   - el bot filtraba por el campo de la fila, asi que metia las lineas de
--     Ingreso dentro del gasto. En Q35 eso hizo que Milo contestara "hay que
--     cubrir 40,881.65" -- los 17,446.65 de gasto presupuestado mas los
--     23,435.00 de sueldos.
--
-- Realinear es seguro y no pierde informacion: el tipo correcto se deriva de la
-- categoria, que no se toca. Lo que hoy ve el dashboard no cambia; lo que
-- cambia es que el bot pase a coincidir con el.
--
-- El check 8 de scripts/audit-datos.sql cuenta estas filas: despues de esta
-- migracion debe dar 0. Las transacciones con el mismo sintoma (check 9) NO se
-- tocan aqui a proposito: en una transaccion ni el tipo ni la categoria son
-- claramente el campo correcto, asi que cada caso necesita que alguien decida.

UPDATE "presupuesto" p
SET "tipo" = c."tipo"
FROM "categorias" c
WHERE c."id" = p."categoria_id"
  AND p."tipo" <> c."tipo";
