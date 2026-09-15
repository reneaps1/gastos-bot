# Auditoria de integridad de datos

Como correrla:

```bash
psql "$DATABASE_URL" -f scripts/audit-datos.sql > /tmp/auditoria.txt
```

Es solo lectura. No modifica nada, se puede correr en produccion en cualquier
momento.

La PARTE 1 imprime un semaforo: cualquier fila con `cantidad > 0` es un
defecto que ya dejo datos malos. La PARTE 2 trae el detalle para repararlo.

Conviene guardar la salida antes y despues de cada correccion: ningun numero
deberia subir.

---

## Que significa cada linea del semaforo

### 1. Transacciones enlazadas a una linea de otra quincena — CRITICO

Un gasto de Q41 colgado de una linea de presupuesto de Q40. El presupuesto de
Q40 lo cuenta como ejercido (el `real` se calcula por `presupuesto_id`, sin
mirar la quincena) y a la vez los totales de transacciones de Q41 tambien lo
suman. Las dos quincenas quedan mal.

Como llego ahi: la API de transacciones no valida la quincena al asignar la
linea, y al mover una transaccion de quincena no revisa si su linea sigue
teniendo sentido. El bot de Telegram si lo valida (`src/budgetActions.js`).

Reparacion: por cada fila del detalle, decidir si lo correcto es mover la
transaccion a la quincena de la linea o soltar el enlace
(`presupuesto_id = NULL`) y reasignarla a una linea de su propia quincena.

### 2. Transacciones de Ahorro sin direccion — CRITICO

`monto` siempre se guarda positivo: sin `direccion`, nada distingue un aporte
de un retiro y todo suma. Cada fila aqui es un movimiento de ahorro que se
esta contando como aporte.

Reparacion: revisar la descripcion de cada una y poner `Aporte` o `Retiro`.

### 3. Transacciones con direccion pero tipo distinto de Ahorro — MEDIO

Lo contrario: `direccion` solo tiene sentido con `tipo = 'Ahorro'`. Si aparece
algo aqui, alguna escritura se salto `resolverTipoYDireccion`.

### 4. Lineas de Ahorro con retiros inflando el real — CRITICO

El detalle muestra las tres cifras juntas: `real_bruto_hoy` (lo que enseña hoy
el dashboard), `real_correcto` (neteando los retiros) y `retiros`. La
diferencia siempre es el doble de los retiros, porque en vez de restarse se
suman.

Esto no se repara con datos: es el defecto C2 del codigo. Una vez corregido,
la cifra se acomoda sola. Sirve para saber cuanto llevas mal en pantalla.

### 5. Pagos de credito Pagados sin fecha_pago_real — CRITICO

La conciliacion de caja solo cuenta un `CreditoPago` si tiene
`fecha_pago_real`. Un pago marcado Pagado sin fecha nunca se resta del saldo
esperado, asi que genera un descuadre que ningun ajuste cierra.

Reparacion: poner la fecha real en la que salio el dinero. Si ya no se
recuerda, `fecha_pago_programada` es la mejor aproximacion.

### 6. Pagos de credito Pendientes que ya tienen transaccion enlazada — ALTO

Si la transaccion de pago ya existe, ese abono cuenta dos veces en "lo que
falta pagar": una como pendiente directo y otra como abono de credito.

Reparacion: marcar el `CreditoPago` como Pagado con su fecha real.

### 7. Compras a credito Pagadas — CRITICO

Es el monto expuesto al defecto C1: la conciliacion resta la compra al
registrarse **y** vuelve a restar el `CreditoPago` cuando pagas la tarjeta. El
mismo dinero sale una vez y se descuenta dos.

No se repara con datos, se repara en el codigo. El detalle por quincena sirve
para estimar cuanto se ha desviado la proyeccion de caja.

### 8 y 9. Tipo distinto al de su categoria — ALTO

La categoria dice una cosa (`Gasto`) y la fila dice otra (`Ingreso`). Segun
que pantalla la mires, se cuenta de un lado o del otro: el forecast usa un
criterio (`p.tipo` O `categoria.tipo`) y los totales usan otro
(`categoria.tipo`). La misma fila puede sumar como ingreso en una vista y
como gasto en otra.

Reparacion: elegir el tipo correcto. La regla del sistema es que manda la
categoria, salvo en categoria Ahorro, donde `tipo` siempre es `Ahorro` y el
signo lo da `direccion` (por eso el check 9 excluye Ahorro).

### 10. Lineas de presupuesto duplicadas — ALTO

Misma quincena, misma descripcion, misma categoria. Normalmente vienen de
editar una serie recurrente: `skipDuplicates` no protege nada porque la tabla
`presupuesto` no tiene ningun indice UNIQUE.

Ojo con `suma_vigente`: si las dos lineas tienen movimientos, borrar una
implica reasignar sus transacciones antes.

### 11. Lineas Canceladas con transacciones enlazadas — ALTO

`Cancelada` significa "esto nunca paso", y los agregados la ignoran. Si tiene
movimientos reales colgando, ese gasto desaparece del presupuesto pero sigue
en los totales de transacciones.

Hay un trigger que impide cancelar una linea con movimientos, pero nada impide
enlazar un movimiento a una linea que ya estaba cancelada.

Reparacion: reasignar esos gastos a una linea viva, o reabrir la linea.

### 12 y 13. Montos <= 0 — MEDIO

Los CHECK existen pero son `NOT VALID`: nunca validaron el historico. Al final
del reporte hay una tabla que muestra `validado = f` para los cinco.

### 14. Pagos de credito donde total <> capital + interes — MEDIO

Nadie valida esa suma al guardar. `monto_implicado` es la suma de las
diferencias.

### 15 y 16. Ahorro sin apartado, apartados sin uso — BAJO

Informativo. Un apartado sin transacciones puede ser uno recien creado o uno
que quedo huerfano al reasignar sus movimientos.

### 17. Acreedores que estan en deudas y en creditos — BAJO

`deudas` es una tabla suelta, sin ninguna relacion con el resto del modelo, y
`ddl_plan.md` dice que los abonos a deudas deben ser transacciones normales
para no duplicar montos en dos tablas. Si el mismo acreedor vive en las dos,
probablemente la misma deuda esta contada dos veces.

### 18. Cortes de liquidez sin ninguna linea de cuenta — CRITICO

La migracion del 6 de septiembre convirtio las columnas fijas
(bbva, banamex, uala...) en filas de `liquidez_snapshot_cuentas`. Un corte sin
lineas significa que sus montos se perdieron en esa conversion.

El detalle lista todos los cortes con su total: conviene comparar los
anteriores al 6 de septiembre contra lo que recuerdes o contra un reporte
viejo.

### 19. Vistas v_* — MEDIO

Hoy deberia dar 0. `prisma/migrations/views.sql` nunca se ha aplicado porque
vive fuera de una carpeta de migracion, asi que `prisma migrate deploy` lo
ignora siempre. Ninguna vista de `ddl_plan.md` existe en la base.

### Invariante del historial (check 12 del detalle)

Para cada linea: `CREACION + suma de todos los deltas` debe dar el monto
vigente (`monto_revisado` si existe, si no `monto_presupuestado`). Una fila
aqui significa que el historial no reconstruye el monto actual: o la linea se
creo sin pasar por la API, o falta registrar un cambio.

### Traspasos que no suman cero (check 13 del detalle)

Un traspaso mueve dinero de una linea a otra: la entrada y la salida deben
cancelarse. Si `suma_deltas` no es 0, el traspaso creo o destruyo presupuesto.

---

## Orden sugerido

1. Correr la auditoria y guardar la salida.
2. Reparar a mano lo que es dato malo: checks 1, 2, 5, 6, 8, 9, 10, 11, 14, 18.
3. Aplicar las correcciones de codigo (C1 a C4, A1 a A4).
4. Volver a correr y comparar contra la primera salida.

Los checks 4, 7 y 19 no se reparan con datos: dependen de cambios en el
codigo y se acomodan solos una vez corregido.
