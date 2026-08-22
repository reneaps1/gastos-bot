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
CREATE TYPE tipo_credito        AS ENUM ('Tarjeta', 'CreditoTienda', 'Prestamo', 'MSI', 'LineaCredito', 'Informal', 'Otro');
CREATE TYPE estatus_credito_pago AS ENUM ('Pendiente', 'Pagado', 'Vencido', 'Cancelado');
```

### Usuarios

```sql
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(50)  NOT NULL UNIQUE,
    phone_whatsapp  VARCHAR(20)  UNIQUE,
    activo          BOOLEAN      DEFAULT TRUE,
    fecha_registro  TIMESTAMPTZ  DEFAULT NOW()
);
```

Reglas:
- Un usuario por cada persona que usa el sistema.
- `phone_whatsapp` se usa para identificar quién habla desde WhatsApp.
- Si el número no está registrado, se usa el nombre del perfil de WhatsApp.
- Si no hay nombre de perfil, se usa 'Rene' como fallback.

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

CREATE TYPE tipo_periodo AS ENUM ('QUINCENAL', 'SEMANAL', 'MENSUAL');

CREATE TABLE quincenas (
    id           SERIAL PRIMARY KEY,
    codigo       VARCHAR(5)  NOT NULL UNIQUE,   -- 'Q23', 'Q24', ..., 'Q42'
    fecha_inicio DATE        NOT NULL,
    fecha_fin    DATE        NOT NULL,
    tipo         tipo_periodo NOT NULL DEFAULT 'QUINCENAL',
    CONSTRAINT chk_rango CHECK (fecha_fin > fecha_inicio)
);

-- Ajustes globales, fila unica (id=1). frecuencia_pago_default solo controla
-- que cadencia se sugiere al agregar un periodo nuevo desde el dashboard
-- (Configuracion > Periodos de pago); no afecta periodos ya creados.
CREATE TABLE configuracion (
    id                       SERIAL PRIMARY KEY,
    frecuencia_pago_default  tipo_periodo NOT NULL DEFAULT 'QUINCENAL',
    fecha_actualizacion      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
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
    quincena_consumo_id INT             REFERENCES quincenas(id),
    user_id         INT                 REFERENCES users(id),
    descripcion     VARCHAR(200)        NOT NULL,
    categoria_id    INT                 NOT NULL REFERENCES categorias(id),
    clasificacion   clasificacion_gasto,                    -- puede sobreescribir la de la categoría
    tipo            tipo_movimiento     NOT NULL,
    monto           NUMERIC(12,2)       NOT NULL CHECK (monto > 0),
    metodo_pago_id  INT                 REFERENCES metodos_pago(id),
    credito_id      INT,                -- FK agregada después de crear creditos
    fecha_pago_programada DATE,
    estatus         estatus_pago        NOT NULL DEFAULT 'Pendiente',
    notas           TEXT,
    source          VARCHAR(20)         DEFAULT 'whatsapp', -- 'whatsapp', 'web', 'import', 'sheets'
    fecha_registro  TIMESTAMPTZ         DEFAULT NOW()
);

CREATE INDEX idx_tx_quincena  ON transacciones(quincena_id);
CREATE INDEX idx_tx_quincena_consumo ON transacciones(quincena_consumo_id);
CREATE INDEX idx_tx_categoria ON transacciones(categoria_id);
CREATE INDEX idx_tx_fecha     ON transacciones(fecha);
CREATE INDEX idx_tx_tipo      ON transacciones(tipo);
CREATE INDEX idx_tx_credito   ON transacciones(credito_id);
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

### Créditos y pagos programados

El módulo de `deudas` evoluciona a Créditos y Deudas. La tabla `creditos` representa la obligación financiera; `credito_pagos` representa cada impacto futuro en quincena, categoría y presupuesto.

```sql
CREATE TABLE creditos (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(100)       NOT NULL UNIQUE,
    tipo_credito      tipo_credito       NOT NULL DEFAULT 'Otro',
    acreedor          VARCHAR(100)       NOT NULL,
    user_id           INT                REFERENCES users(id),
    monto_original    NUMERIC(12,2),
    saldo_inicial     NUMERIC(12,2),
    limite_credito    NUMERIC(12,2),
    dia_corte         INT                CHECK (dia_corte BETWEEN 1 AND 31),
    dia_pago          INT                CHECK (dia_pago BETWEEN 1 AND 31),
    frecuencia_pago   VARCHAR(20),       -- quincenal, mensual, semanal, manual
    monto_pago_fijo   NUMERIC(12,2),
    plazo_meses       INT,
    tasa_interes      NUMERIC(7,4),
    cuenta_pago_id    INT                REFERENCES cuentas(id),
    activo            BOOLEAN            DEFAULT TRUE,
    notas             TEXT,
    fecha_inicio      DATE,
    fecha_registro    TIMESTAMPTZ        DEFAULT NOW()
);

ALTER TABLE transacciones
  ADD CONSTRAINT transacciones_credito_id_fkey
  FOREIGN KEY (credito_id) REFERENCES creditos(id) ON DELETE SET NULL;

CREATE TABLE credito_pagos (
    id                    SERIAL PRIMARY KEY,
    credito_id             INT                 NOT NULL REFERENCES creditos(id),
    transaccion_id         INT                 REFERENCES transacciones(id) ON DELETE SET NULL,
    quincena_id            INT                 NOT NULL REFERENCES quincenas(id),
    categoria_id           INT                 NOT NULL REFERENCES categorias(id),
    presupuesto_id         INT                 REFERENCES presupuesto(id) ON DELETE SET NULL,
    numero_pago            INT,
    total_pagos            INT,
    fecha_pago_programada  DATE                NOT NULL,
    fecha_pago_real        DATE,
    monto_capital          NUMERIC(12,2)       NOT NULL DEFAULT 0,
    monto_interes          NUMERIC(12,2)       NOT NULL DEFAULT 0,
    monto_total            NUMERIC(12,2)       NOT NULL CHECK (monto_total > 0),
    estatus                estatus_credito_pago NOT NULL DEFAULT 'Pendiente',
    notas                  TEXT,
    fecha_registro         TIMESTAMPTZ         DEFAULT NOW()
);

CREATE INDEX idx_creditos_tipo ON creditos(tipo_credito);
CREATE INDEX idx_creditos_user ON creditos(user_id);
CREATE INDEX idx_credito_pagos_credito ON credito_pagos(credito_id);
CREATE INDEX idx_credito_pagos_quincena ON credito_pagos(quincena_id);
CREATE INDEX idx_credito_pagos_categoria ON credito_pagos(categoria_id);
CREATE INDEX idx_credito_pagos_estatus ON credito_pagos(estatus);
CREATE INDEX idx_credito_pagos_fecha ON credito_pagos(fecha_pago_programada);
```

Reglas:
- Para efectivo, débito, SPEI y vales, `quincena_consumo_id` y `quincena_id` son la misma quincena.
- Para crédito, `quincena_consumo_id` es la quincena de compra y `credito_pagos.quincena_id` es la quincena donde se paga.
- `credito_pagos.categoria_id` conserva la categoría real del consumo para presupuesto.
- `credito_pagos.presupuesto_id` es opcional; si no existe se calcula por `quincena_id + categoria_id`.
- El pago de crédito liquida `credito_pagos`; no crea un segundo gasto presupuestal.

### Mensajes WhatsApp (audit trail del bot)

```sql
CREATE TABLE whatsapp_messages (
    id              SERIAL PRIMARY KEY,
    wa_message_id   VARCHAR(100)    UNIQUE,          -- ID de Meta API
    from_number     VARCHAR(20)     NOT NULL,
    from_name       VARCHAR(100),
    user_id         INT             REFERENCES users(id),
    body            TEXT            NOT NULL,
    tipo            VARCHAR(20),                     -- 'text', 'image', 'audio', etc.
    procesado       BOOLEAN         DEFAULT FALSE,
    transaccion_id  INT             REFERENCES transacciones(id),
    error           TEXT,                            -- descripcion del error si fallo
    fecha_mensaje   TIMESTAMPTZ     NOT NULL,
    fecha_registro  TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_wa_from    ON whatsapp_messages(from_number);
CREATE INDEX idx_wa_fecha   ON whatsapp_messages(fecha_mensaje);
CREATE INDEX idx_wa_user    ON whatsapp_messages(user_id);
```

### Lotes de importacion

```sql
CREATE TABLE import_batches (
    id              SERIAL PRIMARY KEY,
    fuente          VARCHAR(30)     NOT NULL,         -- 'excel', 'sheets', 'manual'
    archivo         VARCHAR(200),                    -- nombre del archivo original
    total_filas     INT             DEFAULT 0,
    importadas      INT             DEFAULT 0,
    rechazadas      INT             DEFAULT 0,
    errores         TEXT,
    estado          VARCHAR(20)     DEFAULT 'pendiente',  -- 'pendiente', 'en_proceso', 'completado', 'fallido'
    fecha_inicio    TIMESTAMPTZ     DEFAULT NOW(),
    fecha_fin       TIMESTAMPTZ,
    usuario_id      INT             REFERENCES users(id)
);
```

### Auditoria de cambios

```sql
CREATE TABLE audit_log (
    id              SERIAL PRIMARY KEY,
    tabla           VARCHAR(50)     NOT NULL,
    registro_id     INT             NOT NULL,
    operacion       VARCHAR(10)     NOT NULL,         -- 'INSERT', 'UPDATE', 'DELETE'
    campo           VARCHAR(50),                     -- campo modificado (para UPDATE)
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    user_id         INT             REFERENCES users(id),
    source          VARCHAR(20),                     -- 'whatsapp', 'web', 'import'
    fecha           TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_audit_tabla  ON audit_log(tabla, registro_id);
CREATE INDEX idx_audit_fecha  ON audit_log(fecha);
```

Reglas de auditoria (segun DEVELOPMENT_POLICY.md):
- Se auditan: transacciones editadas/eliminadas, presupuestos modificados,
  deudas modificadas, cortes de liquidez modificados.
- Operaciones INSERT desde bot (source='whatsapp') no requieren auditoria si
  el mensaje original esta en `whatsapp_messages`.

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

### v_consumo_quincenal

Mide lo consumido en una quincena, aunque el impacto financiero ocurra después por crédito.

```sql
CREATE VIEW v_consumo_quincenal AS
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
```

### v_credito_pagos_quincena

Lista pagos programados por crédito, quincena, categoría y presupuesto opcional.

```sql
CREATE VIEW v_credito_pagos_quincena AS
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
```

### v_corte_liquidez (reporte de caja por quincena)

```sql
CREATE VIEW v_corte_liquidez AS
SELECT
    q.codigo                                                            AS quincena,
    q.fecha_fin                                                         AS fecha_corte_quincena,
    ls.fecha_corte,
    ls.bbva,
    ls.banamex,
    ls.uala,
    ls.uala_inversion,
    ls.efectivo,
    ls.vales_despensa,
    ls.vales_gasolina,
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
    ls.validado,
    ls.notas
FROM liquidez_snapshots ls
JOIN quincenas q ON q.id = ls.quincena_id
ORDER BY q.fecha_inicio;
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
-- Usuarios
INSERT INTO users (nombre, phone_whatsapp) VALUES
  ('Rene',    NULL),   -- Se actualizará con su número real de WhatsApp
  ('Mariana', NULL);   -- Se actualizará con su número real de WhatsApp

-- Categorias oficiales (Fase 0 - Cerrado)
INSERT INTO categorias (nombre, tipo, clasificacion, ejemplos) VALUES
  ('Hogar',         'Gasto',   'Fijo',     'Renta, Agua, Luz, Gas, Internet'),
  ('Salud',         'Gasto',   'Fijo',     'Medicamentos, Terapia, Pediatra, Gine, Tradea, Sertralina'),
  ('Familia',       'Gasto',   'Variable', 'Super, Pañales, Niñera, Guardería, Croquetas, Fórmula Leo'),
  ('Transporte',    'Gasto',   'Variable', 'Gasolina, Gas auto, Casetas, Control vehicular'),
  ('Suscripciones', 'Gasto',   'Fijo',     'Netflix, Spotify, Disney+, YouTube, ChatGPT, Claude'),
  ('Deudas',        'Gasto',   'Fijo',     'Préstamos, Coppel, Tanda, Kueski, Pago truck'),
  ('Personal',      'Gasto',   'Variable', 'Diversión, Yoga, GYM, Audífonos, Educación, Ropa'),
  ('Ingresos',      'Ingreso',  NULL,      'Salario, Vales Despensa, Bono, Prima, Anticipo'),
  ('Ahorro',        'Ahorro',   NULL,      'Fondo emergencia, Meta vacaciones, Ahorro pareja');

-- Métodos de pago
INSERT INTO metodos_pago (nombre) VALUES
  ('SPEI'), ('Efectivo'), ('Debito'), ('Vales'), ('Credito');

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
--
-- NOTA (post Fase 10): este INSERT es la foto de planeacion original y ya no
-- coincide con las fechas reales (Q28/Q29/Q36/Q37 se corrigieron por
-- migracion, y Q33+ sigue la regla de "ultimo dia habil del mes" que no
-- estaba definida cuando se escribio esta lista). La fuente de verdad actual
-- es la tabla `quincenas` en Postgres, editable desde el dashboard en
-- Configuracion > Periodos de pago -- no se reescriben estas 20 filas a mano
-- para no perder el registro historico de la planeacion inicial.
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

## Fuente de Migración

Fuente oficial: `milo_tracker_v6.xlsm`

| Hoja | Destino | Notas |
|------|---------|-------|
| Captura | transacciones | Ledger principal, 1056 filas, incluye "Quien" |
| Presupuesto | presupuestos | 503 filas |
| Liquidez | liquidez_snapshots | 40 filas |
| Deudas v2 | deudas | 7 acreedores |
| Semanas | quincenas | 16 registros (Q23-Q34) |
| Registro | **NO MIGRAR** | Subconjunto de Captura sin "Quien" |
| Categorias | **NO MIGRAR** | Ya en seeds del DDL |

Rango de datos: 2026-03-01 a 2027-02-02 (Q23-Q34)

## Verificación

1. Ejecutar el DDL en PostgreSQL
2. Insertar seed data y verificar integridad referencial
3. Importar filas de `Captura` y validar que `v_resumen_quincenal` coincide con los valores del Excel:
   - Q24: Ingresos 28,330.65 | Gastos 26,029.42 | Balance 2,301.23
   - Q25: Ingresos 23,346 | Gastos 22,412.74 | Balance 933.26
4. Verificar `v_estado_deudas` contra hoja "Deudas v2":
   - Total saldo: 249,696.72
