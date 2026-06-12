# Plan DDL — Sistema de Control de Gastos (milo_tracker_v6)

## Comprensión del sistema

### Hojas del Excel y su rol

| Hoja | Rol | → Entidad SQL |
|------|-----|---------------|
| Categorias | Catálogo de categorías | Tabla `categorias` |
| semanas | Calendario de quincenas | Tabla `quincenas` |
| Entrada | Captura rápida (staging) | Tabla `entrada_rapida` |
| Registro | Ledger maestro (sin "quién") | → fusionada en `transacciones` |
| Captura | Ledger maestro + columna "Quién" | Tabla `transacciones` |
| Presupuesto | Planeación por quincena | Tabla `presupuesto` |
| Deudas v2 | Control de deudas activas | Tabla `deudas` |
| Liquidez | Snapshots de caja | Tabla `liquidez_snapshots` |
| Resumen Quincenal | Totales calculados | Vista `v_resumen_quincenal` |
| Corte de Liquidez | Reporte de caja | Vista `v_corte_liquidez` |
| Dashboard | Visualización | No aplica (frontend) |
| Pivot Table 1 | Pivot de análisis | No aplica |

### Flujo de datos
```
Entrada (captura rápida)
       ↓
transacciones (ledger maestro)
       ↓
presupuesto ←→ v_resumen_quincenal   (cálculos por quincena)
       ↓
liquidez_snapshots / v_corte_liquidez (snapshots de caja)
       ↓
Dashboard (visualización)
```

### Decisiones de diseño clave

| Decisión | Razón |
|----------|-------|
| `Registro` y `Captura` → una sola tabla `transacciones` | Son el mismo dato; Captura solo agrega `quien` |
| `Resumen Quincenal` → vista SQL | Es 100% calculado desde transacciones |
| `saldo_actual`, `pct_pagado` en deudas → vista | Evita doble escritura y desincronización |
| `clasificacion` en `transacciones` Y en `categorias` | Flexibilidad: puede sobreescribirse por registro |
| `entrada_rapida` con flag `procesado` + FK a `transacciones` | Trazabilidad del flujo staging → producción |
| Abonos a deudas = transacciones normales (categoría Deudas) | Evita duplicar montos en dos tablas |
| `liquidez_snapshots` guarda valores brutos | Los snapshots son datos históricos inmutables |

---

## DDL Completo (PostgreSQL)

### Enums

```sql
CREATE TYPE tipo_movimiento    AS ENUM ('Gasto', 'Ingreso', 'Ahorro');
CREATE TYPE clasificacion_gasto AS ENUM ('Fijo', 'Variable');
CREATE TYPE estatus_pago        AS ENUM ('Pagado', 'Pendiente');
```

### Catálogos

```sql
CREATE TABLE categorias (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(50)         NOT NULL UNIQUE,
    tipo          tipo_movimiento     NOT NULL,
    clasificacion clasificacion_gasto,          -- NULL para Ingreso/Ahorro
    ejemplos      TEXT,
    activo        BOOLEAN             DEFAULT TRUE
);

CREATE TABLE metodos_pago (
    id     SERIAL PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL UNIQUE   -- 'SPEI', 'Efectivo', 'Debito', 'Vales'
);

CREATE TABLE quincenas (
    id           SERIAL PRIMARY KEY,
    codigo       VARCHAR(5)  NOT NULL UNIQUE,   -- 'Q23', 'Q24', ..., 'Q42'
    fecha_inicio DATE        NOT NULL,
    fecha_fin    DATE        NOT NULL,
    CONSTRAINT chk_rango CHECK (fecha_fin > fecha_inicio)
);

CREATE TABLE cuentas (
    id     SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,  -- 'BBVA', 'Banamex', 'Ualá', etc.
    tipo   VARCHAR(30)                   -- 'Banco', 'Digital', 'Efectivo', 'Vales'
);
```

### Tabla central: Transacciones

```sql
CREATE TABLE transacciones (
    id              SERIAL PRIMARY KEY,
    fecha           DATE                NOT NULL,
    quincena_id     INT                 NOT NULL REFERENCES quincenas(id),
    descripcion     VARCHAR(200)        NOT NULL,
    categoria_id    INT                 NOT NULL REFERENCES categorias(id),
    clasificacion   clasificacion_gasto,                    -- puede sobreescribir la de la categoría
    tipo            tipo_movimiento     NOT NULL,
    monto           NUMERIC(12,2)       NOT NULL CHECK (monto > 0),
    metodo_pago_id  INT                 REFERENCES metodos_pago(id),
    estatus         estatus_pago        NOT NULL DEFAULT 'Pendiente',
    quien           VARCHAR(50),                            -- 'Rene' / 'Mariana'
    notas           TEXT,
    fecha_registro  TIMESTAMPTZ         DEFAULT NOW()
);

CREATE INDEX idx_tx_quincena  ON transacciones(quincena_id);
CREATE INDEX idx_tx_categoria ON transacciones(categoria_id);
CREATE INDEX idx_tx_fecha     ON transacciones(fecha);
CREATE INDEX idx_tx_tipo      ON transacciones(tipo);
```

### Staging: Entrada rápida

```sql
CREATE TABLE entrada_rapida (
    id              SERIAL PRIMARY KEY,
    fecha           DATE                NOT NULL,
    descripcion     VARCHAR(200)        NOT NULL,
    monto           NUMERIC(12,2)       NOT NULL CHECK (monto > 0),
    categoria_id    INT                 REFERENCES categorias(id),
    tipo            tipo_movimiento,
    quincena_id     INT                 REFERENCES quincenas(id),
    notas           TEXT,
    procesado       BOOLEAN             DEFAULT FALSE,
    transaccion_id  INT                 REFERENCES transacciones(id),  -- FK al registro creado
    fecha_registro  TIMESTAMPTZ         DEFAULT NOW()
);
```

### Presupuesto

```sql
CREATE TABLE presupuesto (
    id                  SERIAL PRIMARY KEY,
    quincena_id         INT                 NOT NULL REFERENCES quincenas(id),
    descripcion         VARCHAR(200)        NOT NULL,
    categoria_id        INT                 NOT NULL REFERENCES categorias(id),
    clasificacion       clasificacion_gasto,
    tipo                tipo_movimiento     NOT NULL,
    monto_presupuestado NUMERIC(12,2)       NOT NULL CHECK (monto_presupuestado > 0),
    notas               TEXT,
    fecha_registro      TIMESTAMPTZ         DEFAULT NOW()
    -- monto_real, pendiente, pct_consumido → calculados en v_ejecucion_presupuesto
);

CREATE INDEX idx_presupuesto_quincena ON presupuesto(quincena_id);
```

### Deudas

```sql
CREATE TABLE deudas (
    id              SERIAL PRIMARY KEY,
    acreedor        VARCHAR(100)    NOT NULL,
    deuda_original  NUMERIC(12,2)   NOT NULL CHECK (deuda_original > 0),
    abono_mensual   NUMERIC(12,2),              -- compromiso de pago mensual
    activo          BOOLEAN         DEFAULT TRUE,
    notas           TEXT,
    fecha_inicio    DATE,
    fecha_registro  TIMESTAMPTZ     DEFAULT NOW()
    -- total_abonado, saldo_actual, pct_pagado, meses_restantes → vista v_estado_deudas
    -- los abonos se registran como transacciones con categoria = 'Deudas'
);
```

### Liquidez (snapshots de caja)

```sql
CREATE TABLE liquidez_snapshots (
    id              SERIAL PRIMARY KEY,
    fecha_corte     TIMESTAMPTZ     NOT NULL,
    quincena_id     INT             NOT NULL REFERENCES quincenas(id),
    bbva            NUMERIC(12,2)   DEFAULT 0,
    banamex         NUMERIC(12,2)   DEFAULT 0,
    uala            NUMERIC(12,2)   DEFAULT 0,
    uala_inversion  NUMERIC(12,2)   DEFAULT 0,
    efectivo        NUMERIC(12,2)   DEFAULT 0,
    vales_despensa  NUMERIC(12,2)   DEFAULT 0,
    vales_gasolina  NUMERIC(12,2)   DEFAULT 0,
    -- total = suma de los 7 campos anteriores (calculado en vista)
    falta_pagar     NUMERIC(12,2)   DEFAULT 0,  -- compromisos pendientes al corte
    teorico         NUMERIC(12,2),              -- saldo esperado según presupuesto
    notas           TEXT,
    validado        BOOLEAN         DEFAULT FALSE,  -- ✅ en Excel
    fecha_registro  TIMESTAMPTZ     DEFAULT NOW()
    -- margen  = total - falta_pagar    → calculado en vista
    -- arqueo  = total - teorico        → calculado en vista
);

CREATE INDEX idx_liquidez_quincena ON liquidez_snapshots(quincena_id);
```

---

## Vistas calculadas

### v_resumen_quincenal

```sql
CREATE VIEW v_resumen_quincenal AS
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
```

### v_estado_deudas

```sql
CREATE VIEW v_estado_deudas AS
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
```

### v_ejecucion_presupuesto

```sql
CREATE VIEW v_ejecucion_presupuesto AS
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
```

### v_liquidez (snapshot más reciente con campos calculados)

```sql
CREATE VIEW v_liquidez AS
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
```

---

## Datos semilla

```sql
-- Categorías
INSERT INTO categorias (nombre, tipo, clasificacion, ejemplos) VALUES
  ('Hogar',         'Gasto',   'Fijo',     'Renta, Agua, Luz, Gas, Internet'),
  ('Salud',         'Gasto',   'Fijo',     'Medicamentos, Terapia, Pediatra, Ginecólogo'),
  ('Familia',       'Gasto',   'Variable', 'Super, Pañales, Niñera, Guardería, Croquetas'),
  ('Transporte',    'Gasto',   'Variable', 'Gasolina, Gas auto, Casetas'),
  ('Suscripciones', 'Gasto',   'Fijo',     'Netflix, Spotify, Disney+, YouTube, ChatGPT'),
  ('Deudas',        'Gasto',   'Fijo',     'Préstamos, Coppel, Tanda, Kueski'),
  ('Personal',      'Gasto',   'Variable', 'Diversión, Yoga, GYM, Maestría, Corte pelo'),
  ('Ingresos',      'Ingreso',  NULL,      'Salario, Vales, Bono, Prima'),
  ('Ahorro',        'Ahorro',   NULL,      'Fondo emergencia, Meta vacaciones, Colchón');

-- Métodos de pago
INSERT INTO metodos_pago (nombre) VALUES
  ('SPEI'), ('Efectivo'), ('Debito'), ('Vales');

-- Cuentas
INSERT INTO cuentas (nombre, tipo) VALUES
  ('BBVA',           'Banco'),
  ('Banamex',        'Banco'),
  ('Ualá',           'Digital'),
  ('Ualá Inversión', 'Digital'),
  ('Efectivo',       'Efectivo'),
  ('Vales Despensa', 'Vales'),
  ('Vales Gasolina', 'Vales');

-- Quincenas oficiales Q23-Q42 (fuente: hoja "semanas" del Excel milo_tracker_v6.xlsm)
-- Q23-Q24: historicas, inferidas del historial de la hoja "Captura" (no aparecen en "semanas")
-- Q25-Q36: oficiales, copiadas textualmente de la hoja "semanas"
-- Q37-Q42: proyectadas siguiendo el patron de dias de pago; validar contra nomina real
--          (Q39-Q42 aparecen en "semanas" solo como codigo, sin fechas; Q37-Q38 no aparecen)
-- Nota: los rangos siguen dias reales de pago, por lo que existen fechas sin quincena
--       (ej. 2026-05-14 entre Q26 y Q27). Una fecha fuera de todo rango = "Sin quincena".
INSERT INTO quincenas (codigo, fecha_inicio, fecha_fin) VALUES
  ('Q23', '2026-03-01', '2026-03-29'),
  ('Q24', '2026-03-30', '2026-04-14'),
  ('Q25', '2026-04-15', '2026-04-29'),
  ('Q26', '2026-04-30', '2026-05-13'),
  ('Q27', '2026-05-15', '2026-05-28'),
  ('Q28', '2026-05-29', '2026-06-15'),
  ('Q29', '2026-06-16', '2026-06-29'),
  ('Q30', '2026-06-30', '2026-07-14'),
  ('Q31', '2026-07-15', '2026-07-29'),
  ('Q32', '2026-07-30', '2026-08-13'),
  ('Q33', '2026-08-14', '2026-08-27'),
  ('Q34', '2026-08-28', '2026-09-14'),
  ('Q35', '2026-09-15', '2026-09-29'),
  ('Q36', '2026-09-30', '2026-10-13'),
  ('Q37', '2026-10-14', '2026-10-29'),
  ('Q38', '2026-10-30', '2026-11-12'),
  ('Q39', '2026-11-13', '2026-11-29'),
  ('Q40', '2026-11-30', '2026-12-14'),
  ('Q41', '2026-12-15', '2026-12-30'),
  ('Q42', '2026-12-31', '2027-01-14');
```

---

## Verificación

1. Ejecutar el DDL en PostgreSQL
2. Insertar seed data y verificar integridad referencial
3. Importar ~20 filas de `Captura` y validar que `v_resumen_quincenal` coincide con los valores del Excel:
   - Q24: Ingresos 28,330.65 | Gastos 26,029.42 | Balance 2,301.23
   - Q25: Ingresos 23,346 | Gastos 22,412.74 | Balance 933.26
4. Verificar `v_estado_deudas` contra hoja "Deudas v2":
   - Total saldo: 249,696.72
