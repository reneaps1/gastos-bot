# Auditoria de integridad de metricas y calculos

Fecha: 2026-09-15
Alcance: bot (`src/`) + dashboard (`dashboard/`) + migraciones, revisando
metricas, formulas, joins, duplicados y datos sueltos.
Motivo: verificar que los ~40 commits de las dos semanas previas (liquidez por
cuentas, direccion de ahorro, Original/Vigente/Ejercido, historial auditable,
conciliacion plan vs caja, asignacion de gastos desde Telegram) no rompieron la
integridad de los datos.

Metodo: lectura del codigo y de las 27 migraciones, mas una base PostgreSQL
levantada desde cero con todas las migraciones aplicadas y datos sembrados que
reproducen cada defecto, para confirmar cada hallazgo y cada correccion.

---

## Resumen

Se encontraron **5 defectos que producian cifras incorrectas** y **3
divergencias** donde dos pantallas mostraban numeros distintos para la misma
cosa. Todos corregidos y verificados. Quedan **2 decisiones pendientes** que no
son tecnicas (abajo).

Dos de los cinco son el mismo patron: una regla de negocio implementada en dos
sitios, con el filtro en uno y sin el en el otro (C1 y C1b). Es el riesgo que
deja tener la logica de calculo repartida sin una fuente unica.

Causa de fondo: la logica de calculo vive repartida en 31 archivos con
`reduce`/`_sum`/`groupBy`, sin una fuente unica por metrica. Cuatro copias del
mismo calculo derivaron; ahora son una.

Para saber que dejaron sucio en la base antes de corregirse:

```bash
psql "$DATABASE_URL" -f scripts/audit-datos.sql
```

Guia de interpretacion: `scripts/audit-datos.md`.

---

## Lo que estaba mal

### C1. Las compras a credito se restaban dos veces de la caja

`dashboard/src/lib/reconciliacion-plan-caja-server.ts`

La conciliacion calculaba `neto = ingresos - gastos - pagosCredito`, y `gastos`
incluia las transacciones con `creditoId`. Una compra con tarjeta se restaba al
registrarse **y** otra vez al pagar la tarjeta, aunque el dinero sale del banco
una sola vez. `lib/pagos-quincena.ts` ya excluia `creditoId` para esta misma
regla: eran dos implementaciones de lo mismo y solo una estaba bien.

Los PR #100 y #104 ("evitar doble conteo de ahorro en liquidez") perseguian
este sintoma, pero ambos arreglaron el lado del ahorro, no el del credito.

Corregido: `movimientosCajaEntre` filtra `creditoId: null`.
Verificado: con una compra a credito de 3000 y una a debito de 800 posteriores
al corte, la caja ahora mueve 800 (antes 3800).

### C1b. Un abono de credito enlazado a una linea se contaba dos veces

`dashboard/src/lib/pagos-quincena.ts`

Misma clase de defecto que C1, encontrado al revisar los pendientes: el calculo
de "lo que va a salir esta quincena" sumaba todos los `CreditoPago` Pendientes
sin mirar si estaban enlazados a una linea de presupuesto. Cuando lo estan, la
linea sin ejercer ya aporta ese monto, asi que el mismo dinero se contaba dos
veces. `/api/presupuesto-forecast` hace esta misma pregunta para los periodos
futuros y si filtraba `presupuestoId: null`.

Corregido: mismo filtro en los dos lados.
Verificado: con una linea "Pago TDC" de 1500 y su abono enlazado, el total pasa
de 10700 a 9200 — los 1500 duplicados.

### C2. Los retiros de ahorro sumaban en vez de restar

`api/presupuestos`, `lib/pagos-quincena`, `lib/reconciliacion-plan-caja-server`,
`src/budgetTracker.js`

El `real` de una linea de presupuesto se calculaba sumando `monto` en bruto.
Como `monto` siempre se guarda positivo y el signo vive en `direccion`, en una
linea de Ahorro cada Retiro **subia** el ejercido. El error es del doble del
retiro: una linea con 2000 de aporte y 600 de retiro reportaba 2600 en vez de
1400.

Ese `real` alimenta el ahorro pendiente y la proyeccion de caja de cierre, asi
que el error se propagaba. Ademas `/api/transacciones` **si** neteaba por
direccion: dos endpoints daban cifras distintas para la misma linea.

Corregido: nuevo `dashboard/src/lib/real-transacciones.ts` como punto unico, y
su espejo en `src/budgetTracker.js` para el bot. Las cuatro copias eliminadas.
Verificado end-to-end contra la API: la linea de ejemplo pasa de 2600 a 1400.

### C3. Un pago de credito Pagado sin fecha real nunca salia de la caja

`api/credito-pagos`

La conciliacion solo cuenta un `CreditoPago` si tiene `fechaPagoReal`, pero la
API permitia marcarlo Pagado sin ella. Ese pago no se restaba nunca del saldo
esperado: un descuadre permanente que ningun ajuste cerraba.

Corregido: al pasar a Pagado, si no viene fecha se deriva de la programada.
Tambien se valida que `montoTotal = montoCapital + montoInteres`, que no se
validaba en ningun lado.

### C4. Un gasto podia colgarse de una linea de otra quincena

`api/transacciones` (POST y PUT)

Nada validaba que la linea de presupuesto fuera de la misma quincena que la
transaccion, y mover una transaccion de quincena no revisaba su linea. Como el
`real` se calcula por `presupuestoId` sin mirar la quincena, ese gasto sumaba en
el presupuesto de una quincena mientras los totales lo contaban en la otra. Las
dos quedaban mal y no se notaba hasta el cierre.

El bot de Telegram ya lo rechazaba (`src/budgetActions.js`, motivo
`QUINCENA_DISTINTA`); el agujero estaba solo en el dashboard.

Corregido: `dashboard/src/lib/validar-enlace-presupuesto.ts`. Asignar una linea
de otra quincena da 400; mover la transaccion de quincena suelta el enlace que
dejo de tener sentido en vez de dejarlo sumando mal.

### A1. Tres criterios distintos para el tipo de una linea

Convivian cuatro formas de decidir si una linea es Gasto, Ingreso o Ahorro:
`categoria.tipo` (el criterio dominante, 58 usos), `categoria?.tipo ?? p.tipo`,
`p.tipo || categoria.tipo` (un OR laxo en el forecast) y `p.tipo` a secas en el
bot. Con una linea desalineada, el forecast la contaba como Ingreso y los
totales como Gasto: la misma fila sumando en dos lados opuestos.

Corregido: `tipoDeLinea()` en `lib/presupuesto-totales.ts` como regla unica
(manda la categoria), aplicada tambien en el bot. Y la causa: POST y PUT de
`/api/presupuestos` ya no aceptan el `tipo` del cliente, lo resuelven contra la
categoria.

**Confirmado en produccion.** Milo contesto "Presupuestado: $40,881.65" para
Q35 mientras el dashboard mostraba $17,446.65 de gasto presupuestado y
$23,435.00 de ingreso: 17,446.65 + 23,435.00 = 40,881.65. Las lineas de sueldo
tenian categoria de Ingreso con `tipo` en 'Gasto', y el bot filtraba por el
campo de la fila. Faltaban dos sitios del bot por alinear
(`telegramBrain.js` y `miloTools.js`), ya corregidos, y las filas existentes se
realinean con la migracion `20260915180000_realinear_tipo_presupuesto`.

### A2. Dos definiciones de "gasto sin presupuesto"

El reporte de quincena lo calculaba restando (`total de gastos - suma de los
reales`); el resto del sistema filtra por `presupuestoId IS NULL`. Divergen en
cuanto hay una linea Cancelada con movimientos o un enlace cruzado de quincena.

Corregido: el reporte usa el mismo criterio que todos.

### A3. El bot se contradecia a si mismo sobre el ahorro

`src/analytics.js` (resumen, balance, gasto del mes) filtraba solo por
`tipo === 'Gasto' | 'Ingreso'` y **omitia** `'Ahorro'`, mientras que
`src/database.js` si lo neteaba. Desde la migracion del 2 de septiembre que movio
todo el ahorro a `tipo:'Ahorro'`, esos resumenes dejaron de ver esos
movimientos: el "Disponible" que reportaba el bot ya no descontaba lo apartado.

Corregido: `analytics.js` netea Aporte menos Retiro y muestra el ahorro como
renglon propio.

### M. Riesgos estructurales cerrados

- **El bot no podia registrar retiros.** `parseMessage` no distinguia "meti al
  ahorro" de "saque del ahorro": todo se guardaba como Aporte, asi que cada
  retiro dictado al bot inflaba el saldo. Ahora el parser detecta el retiro y la
  direccion viaja hasta la escritura por los dos caminos (WhatsApp y Telegram).
- **`skipDuplicates` no prevenia nada.** El editor de recurrencias lo usa para no
  duplicar ocurrencias, pero `presupuesto` no tenia ningun indice UNIQUE. Nueva
  migracion `20260915120000_unique_recurrencia_por_quincena`, escrita para no
  tumbar el deploy si la base ya arrastra duplicados: en ese caso deja un
  WARNING en el log y el check 9 de la auditoria dice cuales resolver.
- **El schema del bot podia borrar el historial.** `prisma/schema.prisma` no
  declaraba `PresupuestoCambio`, `Presupuesto.fechaVencimiento` ni las columnas
  de credenciales, aunque sus migraciones si estaban. Un `prisma migrate dev` o
  `db push` desde la raiz habria emitido un `DROP` del historial auditable y del
  login. Los dos schemas ahora son identicos y las dos historias de migracion
  estan alineadas.

---

## Lo que reviso y estaba bien

- **El historial de presupuesto.** `registrarCambioPresupuesto` mantiene
  `delta = nuevo - anterior` por construccion, y el backfill de la migracion
  crea un `CREACION` por cada linea existente mas un `MIGRACION_VIGENTE` donde
  hacia falta: la invariante "CREACION + suma de deltas = vigente" se sostiene.
  Aun asi, los checks 12 y 13 de la auditoria la verifican contra los datos
  reales, porque una edicion por fuera de la API la romperia sin avisar.
- **Los triggers de proteccion.** El Original es inmutable a nivel de
  PostgreSQL, no solo de la API, y no se puede cancelar una linea que ya tiene
  movimientos.
- **`/api/tendencia` grafica el plan Original a proposito.** Lo di por
  sospechoso al principio: es deliberado y esta documentado en el codigo (mide
  calidad de planeacion, y usar el Vigente haria que siempre "cumplas"). La
  grafica ya lo etiqueta "Plan original". Sin cambios.
- **`resolverTipoYDireccion`** como punto unico de tipo/direccion, con su espejo
  en CommonJS para el bot. Los dos caminos de escritura lo respetan.
- **La separacion plan vs caja** (`financial-position.ts` frente a
  `proyeccion-caja.ts`) esta bien planteada y bien comentada.

---

## Dos decisiones que quedan pendientes (no son tecnicas)

### 1. `quincenaConsumoId`: implementarlo o quitarlo

Hoy es un campo muerto. Se escribe siempre igual a `quincenaId` (los tres
caminos de escritura lo hacen), y **ninguna metrica lo lee**. Su unica lectura
real esta en `prisma/migrations/views.sql`, que nunca se ha aplicado porque vive
fuera de una carpeta de migracion y `prisma migrate deploy` lo ignora siempre
(ya senalado en `DIAGNOSTICO.md` desde agosto; el check 19 de la auditoria
confirma que ninguna vista `v_*` existe en la base).

Esto significa que la regla de negocio del `ddl_plan.md` -- "para credito,
`quincena_consumo_id` es la quincena de compra y `credito_pagos.quincena_id` es
la quincena donde se paga" -- **no existe en el sistema**. Todo se reporta por
quincena de impacto.

Dos salidas, y conviene elegir una:

- **Implementarlo**: que las metricas de gasto por quincena usen
  `COALESCE(quincena_consumo_id, quincena_id)` y que la UI permita capturar una
  quincena de consumo distinta. Es la unica forma de que una compra a meses se
  refleje en el periodo en que se consumio.
- **Quitarlo**: borrar la columna y `views.sql`, y actualizar `ddl_plan.md`. Hoy
  la documentacion describe un comportamiento que el codigo no tiene.

Mientras no se decida, no es un error de calculo, pero si documentacion que
miente.

### 2. Los CHECK constraints no protegen nada

`dashboard/package.json` marca la migracion `20260617000000_check_constraints`
como revertida (`migrate resolve --rolled-back`) **en cada arranque**, y los
cinco CHECK se crearon como `NOT VALID`, asi que nunca validaron el historico.
La ultima consulta de `scripts/audit-datos.sql` lo confirma: los cinco salen con
`validado = f`.

No lo toque a proposito: ese `--rolled-back` parece un parche a un fallo de
deploy que no puedo reproducir aqui, y quitarlo a ciegas puede dejar la
migracion en estado fallido y bloquear los despliegues. Lo correcto es, en un
momento tranquilo:

1. Correr los checks 12 y 13 de la auditoria (montos <= 0). Si dan 0,
2. `ALTER TABLE ... VALIDATE CONSTRAINT ...` para los cinco, y
3. quitar el `migrate resolve --rolled-back` del script `start`.

---

## Como verificar

```bash
# Reglas de calculo (15 checks nuevos, ademas de los 124 que ya existian)
npm test

# Tipos del dashboard
cd dashboard && npx tsc --noEmit

# Estado de los datos reales
psql "$DATABASE_URL" -f scripts/audit-datos.sql
```

Conviene correr la auditoria **antes y despues** de reparar datos a mano: los
conteos deben bajar y ninguno subir. Los checks 4, 7 y 19 no se reparan con
datos, dependian de codigo y ya estan corregidos.
