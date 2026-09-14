// Escrituras que Milo puede hacer sobre el presupuesto desde Telegram, con su
// validacion. Vive aparte del handler para poder probarla sin levantar el
// servidor ni simular updates.
//
// ALCANCE A PROPOSITO: aqui solo se vincula una transaccion ya registrada a una
// linea de presupuesto. Eso cambia un unico campo (`transaccion.presupuestoId`)
// y no mueve montos ni pasa por `presupuesto_cambios` -- el mismo alcance que
// el `PUT /api/transacciones/[id]` del dashboard.
//
// Los TRASPASOS entre lineas (cubrir un excedente moviendo `montoRevisado`) NO
// estan aqui y no deben estarlo: esa operacion valida que la linea donante no
// quede por debajo de lo ya gastado y escribe la bitacora en la misma
// transaccion de base de datos. Tener dos implementaciones de una operacion
// financiera auditada es como se terminan desincronizando. El bot detecta el
// excedido y lleva al dashboard, que es donde vive.

const prisma = require('./lib/prisma')
const { getBudgetLineStatus } = require('./budgetTracker')

// Motivos de rechazo, para que el llamador decida que mensaje mostrar sin
// interpretar cadenas libres.
const RECHAZO = {
  TX_NO_EXISTE: 'TX_NO_EXISTE',
  TX_NO_ES_GASTO: 'TX_NO_ES_GASTO',
  LINEA_NO_EXISTE: 'LINEA_NO_EXISTE',
  LINEA_NO_ES_GASTO: 'LINEA_NO_ES_GASTO',
  LINEA_CANCELADA: 'LINEA_CANCELADA',
  QUINCENA_DISTINTA: 'QUINCENA_DISTINTA',
}

/**
 * Vincula una transaccion a una linea de presupuesto.
 *
 * Los ids llegan desde `callback_data` de Telegram, que viaja por el cliente del
 * usuario: un cliente modificado puede mandar cualquier par de numeros. Por eso
 * NADA de lo que llega se da por bueno y todo se verifica contra la base.
 *
 * @returns {{ok: boolean, reason?: string, yaEstaba?: boolean, status?: object, linea?: object}}
 */
async function linkTransactionToBudget({ transaccionId, presupuestoId }) {
  const txId = Number(transaccionId)
  const lineaId = Number(presupuestoId)
  if (!Number.isInteger(txId) || !Number.isInteger(lineaId)) {
    return { ok: false, reason: RECHAZO.TX_NO_EXISTE }
  }

  const tx = await prisma.transaccion.findUnique({ where: { id: txId } })
  if (!tx) return { ok: false, reason: RECHAZO.TX_NO_EXISTE }
  if (tx.tipo !== 'Gasto') return { ok: false, reason: RECHAZO.TX_NO_ES_GASTO }

  const linea = await prisma.presupuesto.findUnique({ where: { id: lineaId } })
  if (!linea) return { ok: false, reason: RECHAZO.LINEA_NO_EXISTE }
  if (linea.tipo !== 'Gasto') return { ok: false, reason: RECHAZO.LINEA_NO_ES_GASTO }
  if (linea.estadoLinea === 'Cancelada') return { ok: false, reason: RECHAZO.LINEA_CANCELADA }

  // Un gasto de esta quincena no puede colgarse de una linea de otra: el
  // presupuesto dejaria de cuadrar y nadie lo notaria hasta el cierre.
  if (linea.quincenaId !== tx.quincenaId) {
    return { ok: false, reason: RECHAZO.QUINCENA_DISTINTA }
  }

  // Tocar el boton dos veces no debe escribir dos veces ni reportar algo
  // distinto la segunda vez.
  if (tx.presupuestoId === lineaId) {
    return { ok: true, yaEstaba: true, linea, status: await getBudgetLineStatus(lineaId) }
  }

  await prisma.transaccion.update({
    where: { id: txId },
    data: { presupuestoId: lineaId },
  })

  return { ok: true, yaEstaba: false, linea, status: await getBudgetLineStatus(lineaId) }
}

// Deja la transaccion explicitamente sin linea. Existe para que "Dejar sin
// asignar" sea una decision registrada y no simplemente ignorar los botones:
// asi el mensaje se cierra y el gasto no queda en el limbo visual.
async function unlinkTransaction({ transaccionId }) {
  const txId = Number(transaccionId)
  if (!Number.isInteger(txId)) return { ok: false, reason: RECHAZO.TX_NO_EXISTE }

  const tx = await prisma.transaccion.findUnique({ where: { id: txId } })
  if (!tx) return { ok: false, reason: RECHAZO.TX_NO_EXISTE }

  if (tx.presupuestoId === null) return { ok: true, yaEstaba: true }

  await prisma.transaccion.update({
    where: { id: txId },
    data: { presupuestoId: null },
  })
  return { ok: true, yaEstaba: false }
}

// Busca los gastos a los que puede referirse una frase como "el de suerox".
//
// Acotado a la quincena activa y a `tipo: 'Gasto'`, y ordenado por fecha
// descendente: sin eso "super" podria traer un gasto de hace tres meses y nadie
// lo notaria al confirmar el boton.
//
// Es LECTURA. Vive aqui porque es el mismo dominio que la escritura que la
// acompaña, y asi las dos se prueban juntas.
async function findTransactionsByReference({ referencia, quincenaId, limit = 4 }) {
  const texto = String(referencia || '').trim()
  if (texto.length < 3 || !quincenaId) return []

  return prisma.transaccion.findMany({
    where: {
      quincenaId,
      tipo: 'Gasto',
      descripcion: { contains: texto, mode: 'insensitive' },
    },
    include: { categoria: true, presupuesto: true },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    take: limit,
  })
}

// Mensajes para el usuario. Se mantienen aqui, junto a los motivos, para que
// agregar un motivo sin su mensaje sea imposible de pasar por alto.
function describeRechazo(reason) {
  switch (reason) {
    case RECHAZO.TX_NO_EXISTE:
      return 'Ese gasto ya no existe. Quizá se borró desde el dashboard.'
    case RECHAZO.TX_NO_ES_GASTO:
      return 'Solo los gastos se vinculan a una línea de presupuesto.'
    case RECHAZO.LINEA_NO_EXISTE:
      return 'Esa línea de presupuesto ya no existe.'
    case RECHAZO.LINEA_NO_ES_GASTO:
      return 'Esa línea no es de gasto.'
    case RECHAZO.LINEA_CANCELADA:
      return 'Esa línea está cancelada.'
    case RECHAZO.QUINCENA_DISTINTA:
      return 'Esa línea es de otra quincena.'
    default:
      return 'No pude vincular el gasto.'
  }
}

module.exports = { linkTransactionToBudget, unlinkTransaction, findTransactionsByReference, describeRechazo, RECHAZO }
