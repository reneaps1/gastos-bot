// Mirror en CommonJS de dashboard/src/lib/presupuesto-cambios.ts (el bot no
// puede importar el modulo TS del dashboard, igual que pasa con
// src/tipoAhorro.js y transaccion-ahorro.ts).
//
// POR QUE EXISTE: `POST /api/presupuestos` del dashboard escribe una fila
// CREACION en `presupuesto_cambios` dentro de la misma transaccion que crea la
// linea. Si el bot creara lineas sin esa fila, seria el unico camino que
// produce lineas invisibles para el timeline, y los checks 12 y 13 de
// scripts/audit-datos.sql empezarian a reportar el invariante de historial roto
// (CREACION + suma de deltas debe reconstruir el monto vigente).
//
// SI CAMBIA LA REGLA ALLA, CAMBIARLA AQUI TAMBIEN. Solo se espeja lo que el bot
// necesita: el bot crea lineas y nunca hace traspasos ni ajustes, asi que aqui
// no vive el resto del vocabulario de TipoCambioPresupuesto.

function redondearMonto(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Escribe la fila de bitacora. `tx` es el cliente de una transaccion de Prisma,
 * no el cliente global: la bitacora y el cambio que describe tienen que
 * guardarse juntos o no guardarse.
 *
 * Va por SQL con parametros (igual que el dashboard) porque el enum
 * TipoCambioPresupuesto necesita el CAST explicito.
 */
async function registrarCambioPresupuesto(tx, input) {
  const anterior = redondearMonto(Number(input.montoAnterior) || 0)
  const nuevo = redondearMonto(Number(input.montoNuevo) || 0)
  const delta = redondearMonto(nuevo - anterior)

  // CREACION si se registra aunque el monto sea 0; el resto de no-op no aporta
  // historia y haria ruido en el timeline.
  if (input.tipo !== 'CREACION' && Math.abs(delta) < 0.005) return

  const fecha = input.fechaCreacion ?? new Date()

  await tx.$executeRaw`
    INSERT INTO "presupuesto_cambios" (
      "presupuesto_id",
      "quincena_id",
      "tipo",
      "monto_anterior",
      "monto_nuevo",
      "delta",
      "grupo_cambio_id",
      "presupuesto_relacionado_id",
      "motivo",
      "actor",
      "fecha_creacion"
    ) VALUES (
      ${input.presupuestoId},
      ${input.quincenaId},
      CAST(${input.tipo} AS "TipoCambioPresupuesto"),
      ${anterior},
      ${nuevo},
      ${delta},
      ${input.grupoCambioId ?? null},
      ${input.presupuestoRelacionadoId ?? null},
      ${input.motivo ?? null},
      ${input.actor ?? null},
      ${fecha}
    )
  `
}

async function registrarCreacionPresupuesto(tx, presupuesto, actor, motivo = 'Presupuesto creado') {
  const original = Number(presupuesto.montoPresupuestado) || 0
  await registrarCambioPresupuesto(tx, {
    presupuestoId: presupuesto.id,
    quincenaId: presupuesto.quincenaId,
    tipo: 'CREACION',
    montoAnterior: 0,
    montoNuevo: original,
    motivo,
    actor: actor ?? null,
    fechaCreacion: presupuesto.fechaRegistro,
  })
}

module.exports = { registrarCambioPresupuesto, registrarCreacionPresupuesto }
