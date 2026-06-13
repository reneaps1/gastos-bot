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

CREATE OR REPLACE VIEW v_corte_liquidez AS
SELECT
    q.codigo                                                            AS quincena,
    q.fecha_fin                                                         AS fecha_corte_quincena,
    ls.fecha_corte,
    ls.bbva, ls.banamex, ls.uala, ls.uala_inversion,
    ls.efectivo, ls.vales_despensa, ls.vales_gasolina,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)             AS total_caja,
    ls.falta_pagar,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)
      - ls.falta_pagar                                                  AS margen_real,
    ls.teorico,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)
      - ls.teorico                                                       AS arqueo,
    ls.validado, ls.notas
FROM liquidez_snapshots ls
JOIN quincenas q ON q.id = ls.quincena_id
ORDER BY q.fecha_inicio;

CREATE OR REPLACE VIEW v_liquidez AS
SELECT
    ls.*,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)           AS total,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)
      - ls.falta_pagar                                                 AS margen,
    (ls.bbva + ls.banamex + ls.uala + ls.uala_inversion
     + ls.efectivo + ls.vales_despensa + ls.vales_gasolina)
      - ls.teorico                                                      AS arqueo
FROM liquidez_snapshots ls;
