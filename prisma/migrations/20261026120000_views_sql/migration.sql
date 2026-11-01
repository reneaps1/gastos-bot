-- Vistas calculadas para el dashboard
-- Ejecutar después de la migración inicial

CREATE OR REPLACE VIEW v_resumen_quincenal AS
SELECT
    q.codigo                                                        AS quincena,
    q.fecha_inicio,
    q.fecha_fin,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Ingreso')                  AS ingresos,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto'
                           AND t.clasificacion = 'Fijo')            AS gastos_fijos,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto'
                           AND t.clasificacion = 'Variable')        AS gastos_variables,
    SUM(t.monto) FILTER (WHERE c.nombre = 'Deudas')                 AS deudas_abono,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto')                    AS total_gastos,
    COALESCE(SUM(t.monto) FILTER (WHERE t.tipo = 'Ingreso'), 0)
      - COALESCE(SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto'), 0)   AS balance
FROM transacciones t
JOIN quincenas     q ON q.id = t.quincena_id
JOIN categorias    c ON c.id = t.categoria_id
GROUP BY q.id, q.codigo, q.fecha_inicio, q.fecha_fin
ORDER BY q.fecha_inicio;

CREATE OR REPLACE VIEW v_estado_deudas AS
SELECT
    d.id,
    d.acreedor,
    d.deuda_original,
    d.abono_mensual,
    COALESCE(SUM(t.monto), 0)                                               AS total_abonado,
    d.deuda_original - COALESCE(SUM(t.monto), 0)                            AS saldo_actual,
    ROUND(COALESCE(SUM(t.monto), 0) / d.deuda_original * 100, 1)            AS pct_pagado,
    CASE
        WHEN d.abono_mensual > 0
        THEN CEIL((d.deuda_original - COALESCE(SUM(t.monto), 0)) / d.abono_mensual)
        ELSE NULL
    END                                                                      AS meses_restantes
FROM deudas d
LEFT JOIN transacciones t
       ON t.categoria_id = (SELECT id FROM categorias WHERE nombre = 'Deudas')
      AND t.notas ILIKE '%' || d.acreedor || '%'
WHERE d.activo = TRUE
GROUP BY d.id, d.acreedor, d.deuda_original, d.abono_mensual;

CREATE OR REPLACE VIEW v_ejecucion_presupuesto AS
SELECT
    q.codigo                                                AS quincena,
    p.descripcion,
    c.nombre                                                AS categoria,
    p.monto_presupuestado,
    COALESCE(SUM(t.monto), 0)                              AS monto_real,
    p.monto_presupuestado - COALESCE(SUM(t.monto), 0)      AS pendiente,
    ROUND(
        COALESCE(SUM(t.monto), 0) / p.monto_presupuestado * 100
    , 1)                                                    AS pct_consumido
FROM presupuesto p
JOIN quincenas   q ON q.id = p.quincena_id
JOIN categorias  c ON c.id = p.categoria_id
LEFT JOIN transacciones t
       ON t.quincena_id  = p.quincena_id
      AND t.categoria_id = p.categoria_id
GROUP BY q.codigo, p.descripcion, c.nombre, p.monto_presupuestado;

CREATE OR REPLACE VIEW v_consumo_quincenal AS
SELECT
    q.codigo                                                        AS quincena,
    q.fecha_inicio,
    q.fecha_fin,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Ingreso')                  AS ingresos,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto')                    AS gastos,
    SUM(t.monto) FILTER (WHERE t.tipo = 'Ahorro')                   AS ahorros,
    COALESCE(SUM(t.monto) FILTER (WHERE t.tipo = 'Ingreso'), 0)
      - COALESCE(SUM(t.monto) FILTER (WHERE t.tipo = 'Gasto'), 0)
      - COALESCE(SUM(t.monto) FILTER (WHERE t.tipo = 'Ahorro'), 0)  AS balance_consumo
FROM transacciones t
JOIN quincenas q ON q.id = COALESCE(t.quincena_consumo_id, t.quincena_id)
GROUP BY q.id, q.codigo, q.fecha_inicio, q.fecha_fin
ORDER BY q.fecha_inicio;

CREATE OR REPLACE VIEW v_credito_pagos_quincena AS
SELECT
    cp.id,
    cr.nombre                                                       AS credito,
    cr.tipo_credito,
    q.codigo                                                        AS quincena,
    q.fecha_inicio,
    q.fecha_fin,
    c.nombre                                                        AS categoria,
    cp.fecha_pago_programada,
    cp.fecha_pago_real,
    cp.monto_capital,
    cp.monto_interes,
    cp.monto_total,
    cp.estatus,
    cp.numero_pago,
    cp.total_pagos,
    cp.transaccion_id,
    cp.presupuesto_id
FROM credito_pagos cp
JOIN creditos cr ON cr.id = cp.credito_id
JOIN quincenas q ON q.id = cp.quincena_id
JOIN categorias c ON c.id = cp.categoria_id
ORDER BY cp.fecha_pago_programada, cr.nombre;

-- v_corte_liquidez y v_liquidez se quitaron de esta migracion (2026-11-01).
--
-- Las dos sumaban ls.bbva, ls.banamex, ls.uala... columnas que la migracion
-- 20260906180000_liquidez_cuentas_configurables ya habia movido a
-- liquidez_snapshot_cuentas. Por eso esta migracion fallo en produccion el
-- 2026-10-26 (42703, "column ls.bbva does not exist") y Prisma dejo de aplicar
-- TODAS las migraciones posteriores (P3009). Ningun codigo las usa; si hacen
-- falta, se reescriben sobre liquidez_snapshot_cuentas en una migracion nueva.
-- src/index.js marca esta migracion como rolled-back al arrancar para que se
-- vuelva a aplicar ya corregida (las 5 vistas de arriba son CREATE OR REPLACE).
