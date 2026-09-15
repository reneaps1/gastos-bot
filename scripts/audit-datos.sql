-- Auditoria de integridad de datos de Milo Gastos.
--
-- SOLO LECTURA: no hay un solo INSERT/UPDATE/DELETE aqui. Es seguro correrlo
-- contra la base de produccion.
--
--   psql "$DATABASE_URL" -f scripts/audit-datos.sql
--
-- La PARTE 1 imprime un semaforo de una linea por comprobacion: cualquier
-- fila con cantidad > 0 significa que ese defecto ya dejo datos malos en la
-- base. La PARTE 2 trae el detalle de cada una para poder repararla a mano.
-- scripts/audit-datos.md explica que significa cada numero y que hacer.
--
-- Las comprobaciones 12 y 13 dependen de la tabla presupuesto_cambios
-- (migracion 20260907183000). Si esa migracion todavia no esta aplicada en el
-- entorno donde corres esto, esas dos consultas fallan con "relation does not
-- exist" y el resto sigue siendo valido.

\pset pager off
\timing off

-- ===========================================================================
-- PARTE 1 — Semaforo
-- ===========================================================================

\echo ''
\echo '=== RESUMEN DE AUDITORIA (cantidad > 0 = hay que revisar) ==='
\echo ''

SELECT * FROM (
  -- 1 (C4) Un gasto colgado de una linea de presupuesto de OTRA quincena.
  -- El presupuesto de esa otra quincena lo cuenta como ejercido, pero los
  -- totales de transacciones de su propia quincena tambien. Descuadra las dos.
  SELECT 1 AS n, 'CRITICO' AS sev,
         'Transacciones enlazadas a una linea de otra quincena' AS comprobacion,
         count(*) AS cantidad,
         COALESCE(SUM(t.monto), 0) AS monto_implicado
    FROM transacciones t
    JOIN presupuesto p ON p.id = t.presupuesto_id
   WHERE t.quincena_id <> p.quincena_id

  UNION ALL
  -- 2 (C2/M1) Ahorro sin direccion: un blind SUM lo cuenta como aporte.
  SELECT 2, 'CRITICO',
         'Transacciones de Ahorro sin direccion (Aporte/Retiro)',
         count(*), COALESCE(SUM(monto), 0)
    FROM transacciones
   WHERE tipo = 'Ahorro' AND direccion IS NULL

  UNION ALL
  -- 2b (A1) Lo contrario: direccion puesta en algo que no es Ahorro.
  SELECT 3, 'MEDIO',
         'Transacciones con direccion pero tipo distinto de Ahorro',
         count(*), COALESCE(SUM(monto), 0)
    FROM transacciones
   WHERE direccion IS NOT NULL AND tipo <> 'Ahorro'

  UNION ALL
  -- 3 (C2) Lineas de Ahorro donde el real bruto (lo que calcula hoy
  -- /api/presupuestos) difiere del real neteado por direccion. La diferencia
  -- es exactamente el doble de los retiros: se suman en vez de restarse.
  SELECT 4, 'CRITICO',
         'Lineas de Ahorro con retiros inflando el real',
         count(*), COALESCE(SUM(bruto - neto), 0)
    FROM (
      SELECT p.id,
             SUM(t.monto) AS bruto,
             SUM(CASE WHEN t.direccion = 'Retiro' THEN -t.monto ELSE t.monto END) AS neto
        FROM presupuesto p
        JOIN transacciones t ON t.presupuesto_id = p.id
        JOIN categorias c ON c.id = p.categoria_id
       WHERE c.tipo = 'Ahorro'
       GROUP BY p.id
      HAVING SUM(t.monto)
             <> SUM(CASE WHEN t.direccion = 'Retiro' THEN -t.monto ELSE t.monto END)
    ) x

  UNION ALL
  -- 4 (C3) Un CreditoPago Pagado sin fecha_pago_real nunca entra en el neto
  -- de caja de la conciliacion: el saldo esperado queda inflado para siempre.
  SELECT 5, 'CRITICO',
         'Pagos de credito Pagados sin fecha_pago_real',
         count(*), COALESCE(SUM(monto_total), 0)
    FROM credito_pagos
   WHERE estatus = 'Pagado' AND fecha_pago_real IS NULL

  UNION ALL
  -- 5 (C1) Un CreditoPago que sigue Pendiente pero ya tiene su transaccion de
  -- pago enlazada: se cuenta en los pagos por salir Y en los pendientes.
  SELECT 6, 'ALTO',
         'Pagos de credito Pendientes que ya tienen transaccion enlazada',
         count(*), COALESCE(SUM(monto_total), 0)
    FROM credito_pagos
   WHERE estatus = 'Pendiente' AND transaccion_id IS NOT NULL

  UNION ALL
  -- 5b (C1b) Un abono Pendiente enlazado a una linea de presupuesto se contaba
  -- en "pagos de la quincena" Y otra vez como linea sin ejercer.
  SELECT 20, 'ALTO',
         'Pagos de credito Pendientes enlazados a una linea de presupuesto',
         count(*), COALESCE(SUM(monto_total), 0)
    FROM credito_pagos
   WHERE estatus = 'Pendiente' AND presupuesto_id IS NOT NULL

  UNION ALL
  -- 6 (C1) Monto expuesto al doble conteo de credito: compras a credito ya
  -- marcadas Pagadas. La conciliacion las resta como gasto Y vuelve a restar
  -- el CreditoPago correspondiente.
  SELECT 7, 'CRITICO',
         'Compras a credito Pagadas (se restan dos veces en la conciliacion)',
         count(*), COALESCE(SUM(monto), 0)
    FROM transacciones
   WHERE credito_id IS NOT NULL AND estatus = 'Pagado' AND tipo = 'Gasto'

  UNION ALL
  -- 7 (A1) Linea de presupuesto cuyo tipo no coincide con el de su categoria:
  -- el forecast la cuenta de un lado y los totales del otro.
  SELECT 8, 'ALTO',
         'Lineas de presupuesto con tipo distinto al de su categoria',
         count(*), COALESCE(SUM(COALESCE(p.monto_revisado, p.monto_presupuestado)), 0)
    FROM presupuesto p
    JOIN categorias c ON c.id = p.categoria_id
   WHERE p.tipo <> c.tipo

  UNION ALL
  -- 8 (A1) Lo mismo en transacciones. Se excluye categoria Ahorro porque ahi
  -- la regla es a proposito: tipo siempre 'Ahorro' + direccion.
  SELECT 9, 'ALTO',
         'Transacciones con tipo distinto al de su categoria',
         count(*), COALESCE(SUM(t.monto), 0)
    FROM transacciones t
    JOIN categorias c ON c.id = t.categoria_id
   WHERE t.tipo <> c.tipo AND c.tipo <> 'Ahorro'

  UNION ALL
  -- 9 (M3) Lineas duplicadas en la misma quincena. skipDuplicates no hace
  -- nada porque presupuesto no tiene ningun indice UNIQUE.
  SELECT 10, 'ALTO',
         'Lineas de presupuesto duplicadas (misma quincena/descripcion/categoria)',
         COALESCE(SUM(veces - 1), 0), COALESCE(SUM(monto_extra), 0)
    FROM (
      SELECT count(*) AS veces,
             SUM(COALESCE(monto_revisado, monto_presupuestado))
               - MIN(COALESCE(monto_revisado, monto_presupuestado)) AS monto_extra
        FROM presupuesto
       GROUP BY quincena_id, descripcion, categoria_id
      HAVING count(*) > 1
    ) d

  UNION ALL
  -- 10 (A2) Linea Cancelada con movimientos reales: el trigger lo impide al
  -- cancelar, pero nada impide enlazar un gasto a una linea YA cancelada.
  -- Ese gasto desaparece de los agregados de presupuesto.
  SELECT 11, 'ALTO',
         'Lineas Canceladas que tienen transacciones enlazadas',
         count(DISTINCT p.id), COALESCE(SUM(t.monto), 0)
    FROM presupuesto p
    JOIN transacciones t ON t.presupuesto_id = p.id
   WHERE p.estado_linea = 'Cancelada'

  UNION ALL
  -- 11 (M6) Montos no positivos. Los CHECK son NOT VALID y ademas la
  -- migracion se marca rolled-back en cada arranque del dashboard.
  SELECT 12, 'MEDIO',
         'Transacciones con monto <= 0',
         count(*), COALESCE(SUM(monto), 0)
    FROM transacciones WHERE monto <= 0

  UNION ALL
  SELECT 13, 'MEDIO',
         'Lineas de presupuesto con monto <= 0',
         count(*), COALESCE(SUM(monto_presupuestado), 0)
    FROM presupuesto WHERE monto_presupuestado <= 0

  UNION ALL
  -- 12b (M7) El total de un pago de credito deberia ser capital + interes.
  SELECT 14, 'MEDIO',
         'Pagos de credito donde total <> capital + interes',
         count(*), COALESCE(SUM(monto_total - (monto_capital + monto_interes)), 0)
    FROM credito_pagos
   WHERE monto_total <> monto_capital + monto_interes

  UNION ALL
  -- 14 (datos sueltos) Ahorro sin apartado asignado.
  SELECT 15, 'BAJO',
         'Transacciones de Ahorro sin apartado asignado',
         count(*), COALESCE(SUM(monto), 0)
    FROM transacciones
   WHERE tipo = 'Ahorro' AND apartado_id IS NULL

  UNION ALL
  SELECT 16, 'BAJO',
         'Apartados sin ninguna transaccion',
         count(*), 0
    FROM apartados a
   WHERE NOT EXISTS (SELECT 1 FROM transacciones t WHERE t.apartado_id = a.id)

  UNION ALL
  -- 15 (datos sueltos) La misma deuda viviendo en dos tablas. deudas no tiene
  -- ninguna relacion con el resto del modelo.
  SELECT 17, 'BAJO',
         'Acreedores que existen a la vez en deudas y en creditos',
         count(*), 0
    FROM (
      SELECT DISTINCT lower(trim(d.acreedor))
        FROM deudas d
        JOIN creditos c ON lower(trim(c.acreedor)) = lower(trim(d.acreedor))
       WHERE d.activo
    ) dc

  UNION ALL
  -- 16 (migracion liquidez del 06-sep) Un corte sin ninguna linea por cuenta
  -- significa que la migracion perdio sus montos.
  SELECT 18, 'CRITICO',
         'Cortes de liquidez sin ninguna linea de cuenta',
         count(*), 0
    FROM liquidez_snapshots ls
   WHERE NOT EXISTS (
     SELECT 1 FROM liquidez_snapshot_cuentas lsc WHERE lsc.snapshot_id = ls.id
   )

  UNION ALL
  -- 17 (M5) Las vistas de ddl_plan.md nunca se aplicaron: views.sql vive
  -- fuera de una carpeta de migracion.
  SELECT 19, 'MEDIO',
         'Vistas v_* que SI existen en la base (esperado: 0 hoy, 7 si se aplican)',
         count(*), 0
    FROM information_schema.views
   WHERE table_schema = 'public' AND table_name LIKE 'v\_%'
) resumen
ORDER BY n;

-- ===========================================================================
-- PARTE 2 — Detalle de cada hallazgo
-- ===========================================================================

\echo ''
\echo '=== 1. Transacciones enlazadas a una linea de otra quincena (C4) ==='
SELECT t.id AS tx_id, t.fecha, t.descripcion, t.monto,
       qt.codigo AS quincena_tx, qp.codigo AS quincena_linea,
       p.id AS presupuesto_id, p.descripcion AS linea
  FROM transacciones t
  JOIN presupuesto p ON p.id = t.presupuesto_id
  JOIN quincenas qt ON qt.id = t.quincena_id
  JOIN quincenas qp ON qp.id = p.quincena_id
 WHERE t.quincena_id <> p.quincena_id
 ORDER BY t.fecha DESC;

\echo ''
\echo '=== 3. Lineas de Ahorro con retiros inflando el real (C2) ==='
SELECT p.id AS presupuesto_id, q.codigo AS quincena, p.descripcion,
       SUM(t.monto) AS real_bruto_hoy,
       SUM(CASE WHEN t.direccion = 'Retiro' THEN -t.monto ELSE t.monto END) AS real_correcto,
       SUM(CASE WHEN t.direccion = 'Retiro' THEN t.monto ELSE 0 END) AS retiros
  FROM presupuesto p
  JOIN transacciones t ON t.presupuesto_id = p.id
  JOIN categorias c ON c.id = p.categoria_id
  JOIN quincenas q ON q.id = p.quincena_id
 WHERE c.tipo = 'Ahorro'
 GROUP BY p.id, q.codigo, p.descripcion
HAVING SUM(CASE WHEN t.direccion = 'Retiro' THEN t.monto ELSE 0 END) > 0
 ORDER BY retiros DESC;

\echo ''
\echo '=== 4. Pagos de credito Pagados sin fecha_pago_real (C3) ==='
SELECT cp.id, c.nombre AS credito, q.codigo AS quincena,
       cp.fecha_pago_programada, cp.monto_total
  FROM credito_pagos cp
  JOIN creditos c ON c.id = cp.credito_id
  JOIN quincenas q ON q.id = cp.quincena_id
 WHERE cp.estatus = 'Pagado' AND cp.fecha_pago_real IS NULL
 ORDER BY cp.fecha_pago_programada DESC;

\echo ''
\echo '=== 20. Pagos de credito Pendientes enlazados a una linea (C1b) ==='
SELECT cp.id, c.nombre AS credito, q.codigo AS quincena, cp.monto_total,
       p.descripcion AS linea_enlazada,
       COALESCE(p.monto_revisado, p.monto_presupuestado) AS monto_de_la_linea
  FROM credito_pagos cp
  JOIN creditos c ON c.id = cp.credito_id
  JOIN quincenas q ON q.id = cp.quincena_id
  JOIN presupuesto p ON p.id = cp.presupuesto_id
 WHERE cp.estatus = 'Pendiente'
 ORDER BY q.codigo DESC;

\echo ''
\echo '=== 6. Compras a credito Pagadas, por quincena (C1) ==='
\echo '    Este monto es el que la conciliacion resta dos veces.'
SELECT q.codigo AS quincena, c.nombre AS credito,
       count(*) AS compras, SUM(t.monto) AS monto
  FROM transacciones t
  JOIN creditos c ON c.id = t.credito_id
  JOIN quincenas q ON q.id = t.quincena_id
 WHERE t.credito_id IS NOT NULL AND t.estatus = 'Pagado' AND t.tipo = 'Gasto'
 GROUP BY q.codigo, c.nombre
 ORDER BY q.codigo DESC;

\echo ''
\echo '=== 7. Lineas de presupuesto con tipo distinto al de su categoria (A1) ==='
SELECT p.id, q.codigo AS quincena, p.descripcion,
       p.tipo AS tipo_linea, c.nombre AS categoria, c.tipo AS tipo_categoria,
       COALESCE(p.monto_revisado, p.monto_presupuestado) AS vigente
  FROM presupuesto p
  JOIN categorias c ON c.id = p.categoria_id
  JOIN quincenas q ON q.id = p.quincena_id
 WHERE p.tipo <> c.tipo
 ORDER BY q.codigo DESC;

\echo ''
\echo '=== 8. Transacciones con tipo distinto al de su categoria (A1) ==='
SELECT t.id, t.fecha, t.descripcion, t.monto,
       t.tipo AS tipo_tx, c.nombre AS categoria, c.tipo AS tipo_categoria
  FROM transacciones t
  JOIN categorias c ON c.id = t.categoria_id
 WHERE t.tipo <> c.tipo AND c.tipo <> 'Ahorro'
 ORDER BY t.fecha DESC;

\echo ''
\echo '=== 9. Lineas de presupuesto duplicadas (M3) ==='
SELECT q.codigo AS quincena, p.descripcion, c.nombre AS categoria,
       count(*) AS veces,
       array_agg(p.id ORDER BY p.id) AS ids,
       SUM(COALESCE(p.monto_revisado, p.monto_presupuestado)) AS suma_vigente
  FROM presupuesto p
  JOIN quincenas q ON q.id = p.quincena_id
  JOIN categorias c ON c.id = p.categoria_id
 GROUP BY q.codigo, p.descripcion, c.nombre
HAVING count(*) > 1
 ORDER BY count(*) DESC, q.codigo DESC;

\echo ''
\echo '=== 10. Lineas Canceladas con transacciones enlazadas (A2) ==='
SELECT p.id AS presupuesto_id, q.codigo AS quincena, p.descripcion,
       count(t.id) AS movimientos, SUM(t.monto) AS monto_escondido
  FROM presupuesto p
  JOIN transacciones t ON t.presupuesto_id = p.id
  JOIN quincenas q ON q.id = p.quincena_id
 WHERE p.estado_linea = 'Cancelada'
 GROUP BY p.id, q.codigo, p.descripcion
 ORDER BY monto_escondido DESC;

\echo ''
\echo '=== 12. Invariante del historial: CREACION + suma de deltas = vigente ==='
\echo '    Cada fila que salga aqui es una linea cuyo historial no reconstruye'
\echo '    su monto actual: o se edito por fuera de la API, o falta un cambio.'
SELECT p.id AS presupuesto_id, q.codigo AS quincena, p.descripcion,
       COALESCE(p.monto_revisado, p.monto_presupuestado) AS vigente_real,
       COALESCE(SUM(pc.delta), 0) AS vigente_segun_historial,
       COALESCE(p.monto_revisado, p.monto_presupuestado) - COALESCE(SUM(pc.delta), 0) AS diferencia
  FROM presupuesto p
  JOIN quincenas q ON q.id = p.quincena_id
  LEFT JOIN presupuesto_cambios pc ON pc.presupuesto_id = p.id
 GROUP BY p.id, q.codigo, p.descripcion, p.monto_revisado, p.monto_presupuestado
HAVING abs(COALESCE(p.monto_revisado, p.monto_presupuestado) - COALESCE(SUM(pc.delta), 0)) > 0.005
 ORDER BY abs(COALESCE(p.monto_revisado, p.monto_presupuestado) - COALESCE(SUM(pc.delta), 0)) DESC;

\echo ''
\echo '=== 13. Traspasos cuyo par entrada/salida no suma cero ==='
\echo '    Un traspaso mueve dinero entre dos lineas: el total no debe cambiar.'
SELECT pc.grupo_cambio_id,
       count(*) AS movimientos,
       SUM(pc.delta) AS suma_deltas,
       min(pc.fecha_creacion) AS fecha,
       array_agg(pc.tipo::text ORDER BY pc.id) AS tipos
  FROM presupuesto_cambios pc
 WHERE pc.grupo_cambio_id IS NOT NULL
 GROUP BY pc.grupo_cambio_id
HAVING abs(SUM(pc.delta)) > 0.005
 ORDER BY min(pc.fecha_creacion) DESC;

\echo ''
\echo '=== 16. Cortes de liquidez y su total por cuentas ==='
\echo '    Un total en 0 con cuentas vacias = la migracion del 06-sep perdio el corte.'
SELECT ls.id, ls.fecha_corte, q.codigo AS quincena,
       count(lsc.id) AS lineas_de_cuenta,
       COALESCE(SUM(lsc.monto), 0) AS total_liquido
  FROM liquidez_snapshots ls
  JOIN quincenas q ON q.id = ls.quincena_id
  LEFT JOIN liquidez_snapshot_cuentas lsc ON lsc.snapshot_id = ls.id
 GROUP BY ls.id, ls.fecha_corte, q.codigo
 ORDER BY ls.fecha_corte DESC;

\echo ''
\echo '=== 17. Vistas v_* presentes en la base (M5) ==='
SELECT table_name
  FROM information_schema.views
 WHERE table_schema = 'public' AND table_name LIKE 'v\_%'
 ORDER BY table_name;

\echo ''
\echo '=== Extra: estado de las migraciones (drift entre bot y dashboard) ==='
\echo '    marcada_revertida = t en check_constraints es lo esperado hoy: el'
\echo '    script start del dashboard la marca asi en cada arranque.'
SELECT (to_regclass('public._prisma_migrations') IS NOT NULL) AS tiene_tabla_migraciones \gset
\if :tiene_tabla_migraciones
SELECT migration_name,
       finished_at IS NOT NULL AS aplicada,
       rolled_back_at IS NOT NULL AS marcada_revertida
  FROM _prisma_migrations
 ORDER BY migration_name;
\else
\echo '    (esta base no tiene _prisma_migrations: se aplico sin prisma migrate)'
\endif

\echo ''
\echo '=== Extra: indice que impide duplicar una serie recurrente ==='
\echo '    Si no aparece, la migracion no pudo crearlo porque hay duplicados:'
\echo '    resuelve los del check 9 y vuelve a aplicarla.'
SELECT indexname, tablename
  FROM pg_indexes
 WHERE indexname = 'presupuesto_quincena_recurrencia_grupo_key';

\echo ''
\echo '=== Extra: CHECK constraints y si estan validados ==='
\echo '    validado = f significa que el CHECK solo aplica a filas nuevas:'
\echo '    nunca se comprobo el historico (se crearon como NOT VALID).'
SELECT conname AS constraint_name,
       conrelid::regclass AS tabla,
       convalidated AS validado
  FROM pg_constraint
 WHERE contype = 'c' AND conname LIKE 'chk\_%'
 ORDER BY conrelid::regclass::text, conname;
