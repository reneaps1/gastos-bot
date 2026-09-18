// Escrituras que Milo puede hacer sobre el presupuesto desde Telegram, con su
// validacion. Vive aparte del handler para poder probarla sin levantar el
// servidor ni simular updates.
//
// ALCANCE A PROPOSITO: aqui viven dos operaciones sobre una transaccion ya
// registrada, y ninguna mueve montos de presupuesto:
//
//   1. `linkTransactionToBudget` la vincula a una linea. Cambia un unico campo
//      (`transaccion.presupuestoId`) -- el mismo alcance que el
//      `PUT /api/transacciones/[id]` del dashboard.
//   2. `alignTransactionCategory` mueve la categoria de la transaccion a la de
//      su linea, DESPUES de que el usuario lo confirma. Cambia
//      `categoriaId` (y lo que se deriva de el) y nunca toca `presupuestoId`.
//
// Son dos escrituras separadas a proposito: enlazar no cambia la categoria en
// silencio, y confirmar la categoria no puede mover el enlace. Esa separacion
// es lo que hace que "nunca se sobrescribe en silencio" sea literal.
//
// Los TRASPASOS entre lineas (cubrir un excedente moviendo `montoRevisado`) NO
// estan aqui y no deben estarlo: esa operacion valida que la linea donante no
// quede por debajo de lo ya gastado y escribe la bitacora en la misma
// transaccion de base de datos. Tener dos implementaciones de una operacion
// financiera auditada es como se terminan desincronizando. El bot detecta el
// excedido y lleva al dashboard, que es donde vive.

const prisma = require('./lib/prisma')
const { getBudgetLineStatus } = require('./budgetTracker')
const { resolverTipoYDireccion } = require('./tipoAhorro')
const { CLASIFICACION_POR_CATEGORIA } = require('./clasificacion')

// Motivos de rechazo, para que el llamador decida que mensaje mostrar sin
// interpretar cadenas libres.
const RECHAZO = {
  TX_NO_EXISTE: 'TX_NO_EXISTE',
  LINEA_NO_EXISTE: 'LINEA_NO_EXISTE',
  LINEA_CANCELADA: 'LINEA_CANCELADA',
  QUINCENA_DISTINTA: 'QUINCENA_DISTINTA',
  // Reemplaza a los viejos TX_NO_ES_GASTO / LINEA_NO_ES_GASTO: ahora Ingreso y
  // Ahorro tambien se cuelgan de una linea, y lo que se exige es que los dos
  // tipos coincidan. Ver el comentario de getActiveBudgetLines en
  // src/budgetTracker.js: cruzar TIPOS hace que el monto desaparezca de los
  // agregados, no que solo cambie de columna.
  TIPO_DISTINTO: 'TIPO_DISTINTO',
  // La transaccion no esta enlazada a esa linea, asi que no hay nada que
  // alinear. Solo lo usa alignTransactionCategory.
  NO_ENLAZADA: 'NO_ENLAZADA',
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

  const linea = await prisma.presupuesto.findUnique({
    where: { id: lineaId },
    include: { categoria: true },
  })
  if (!linea) return { ok: false, reason: RECHAZO.LINEA_NO_EXISTE }
  // Manda la categoria, no el `tipo` copiado en la fila: son dos campos que
  // pueden quedar desalineados y cada pantalla decidia distinto. Misma regla
  // que tipoDeLinea en dashboard/src/lib/presupuesto-totales.ts.
  const tipoLinea = linea.categoria?.tipo ?? linea.tipo
  // Los dos tipos tienen que coincidir. Antes ambos lados exigian 'Gasto', lo
  // que hacia el cruce imposible por accidente; ahora que Ingreso y Ahorro
  // tambien se enlazan, esta es la unica cosa que lo impide.
  if (tx.tipo !== tipoLinea) return { ok: false, reason: RECHAZO.TIPO_DISTINTO }
  if (linea.estadoLinea === 'Cancelada') return { ok: false, reason: RECHAZO.LINEA_CANCELADA }

  // Un gasto de esta quincena no puede colgarse de una linea de otra: el
  // presupuesto dejaria de cuadrar y nadie lo notaria hasta el cierre.
  if (linea.quincenaId !== tx.quincenaId) {
    return { ok: false, reason: RECHAZO.QUINCENA_DISTINTA }
  }

  // `cruzado` = la linea es de otra categoria que la transaccion. Es un estado
  // legal (el dashboard lleva tiempo permitiendolo desde el panel "Movimientos
  // sin presupuesto"), pero el llamador tiene que saberlo para PREGUNTAR si se
  // mueve tambien la categoria. Enlazar nunca la mueve solo.
  const cruzado = linea.categoriaId !== tx.categoriaId

  // Tocar el boton dos veces no debe escribir dos veces ni reportar algo
  // distinto la segunda vez.
  if (tx.presupuestoId === lineaId) {
    return { ok: true, yaEstaba: true, cruzado, linea, tx, status: await getBudgetLineStatus(lineaId) }
  }

  await prisma.transaccion.update({
    where: { id: txId },
    data: { presupuestoId: lineaId },
  })

  return { ok: true, yaEstaba: false, cruzado, linea, tx, status: await getBudgetLineStatus(lineaId) }
}

/**
 * Mueve la categoria de una transaccion a la de su linea de presupuesto.
 *
 * Solo corre DESPUES de que el usuario lo confirma: enlazar y recategorizar son
 * dos escrituras separadas a proposito (ver el encabezado del archivo).
 *
 * `presupuestoId` llega por `callback_data`, o sea por el cliente del usuario.
 * Por eso no basta con que la linea exista: se exige que la transaccion YA este
 * enlazada a ESA linea. Sin esa comprobacion, un callback forjado podria mover
 * la categoria de cualquier transaccion a la de cualquier linea.
 *
 * @returns {{ok: boolean, reason?: string, yaEstaba?: boolean, categoriaAnterior?: object, categoriaNueva?: object}}
 */
async function alignTransactionCategory({ transaccionId, presupuestoId }) {
  const txId = Number(transaccionId)
  const lineaId = Number(presupuestoId)
  if (!Number.isInteger(txId) || !Number.isInteger(lineaId)) {
    return { ok: false, reason: RECHAZO.TX_NO_EXISTE }
  }

  const tx = await prisma.transaccion.findUnique({
    where: { id: txId },
    include: { categoria: true },
  })
  if (!tx) return { ok: false, reason: RECHAZO.TX_NO_EXISTE }

  const linea = await prisma.presupuesto.findUnique({
    where: { id: lineaId },
    include: { categoria: true },
  })
  if (!linea) return { ok: false, reason: RECHAZO.LINEA_NO_EXISTE }

  // El candado contra un callback forjado.
  if (tx.presupuestoId !== lineaId) return { ok: false, reason: RECHAZO.NO_ENLAZADA }

  // Ya estaban alineadas: tocar el boton dos veces no escribe dos veces.
  if (tx.categoriaId === linea.categoriaId) {
    return { ok: true, yaEstaba: true, categoriaAnterior: tx.categoria, categoriaNueva: linea.categoria }
  }

  const tipoLinea = linea.categoria?.tipo ?? linea.tipo
  // Imposible si linkTransactionToBudget hizo su trabajo, pero se revalida por
  // la misma razon que lo anterior: nada de lo que llega por callback_data se
  // da por bueno, ni siquiera lo que ya deberia estar garantizado.
  if (tx.tipo !== tipoLinea) return { ok: false, reason: RECHAZO.TIPO_DISTINTO }

  // La categoria manda sobre tipo/direccion/clasificacion -- por eso moverla es
  // una decision del usuario y no un efecto colateral de elegir una linea.
  const { tipo, direccion } = resolverTipoYDireccion(linea.categoria?.tipo, tx.tipo, tx.direccion)

  await prisma.transaccion.update({
    where: { id: txId },
    data: {
      categoriaId: linea.categoriaId,
      tipo,
      direccion,
      clasificacion: CLASIFICACION_POR_CATEGORIA[linea.categoria?.nombre] ?? null,
    },
  })

  return { ok: true, yaEstaba: false, categoriaAnterior: tx.categoria, categoriaNueva: linea.categoria }
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
      return 'Ese movimiento ya no existe. Quizá se borró desde el dashboard.'
    case RECHAZO.LINEA_NO_EXISTE:
      return 'Esa línea de presupuesto ya no existe.'
    case RECHAZO.TIPO_DISTINTO:
      return 'Esa línea es de otro tipo de movimiento (gasto, ingreso o ahorro).'
    case RECHAZO.LINEA_CANCELADA:
      return 'Esa línea está cancelada.'
    case RECHAZO.QUINCENA_DISTINTA:
      return 'Esa línea es de otra quincena.'
    case RECHAZO.NO_ENLAZADA:
      return 'Ese movimiento ya no está en esa línea.'
    default:
      return 'No pude vincular el movimiento.'
  }
}

module.exports = {
  linkTransactionToBudget,
  alignTransactionCategory,
  unlinkTransaction,
  findTransactionsByReference,
  describeRechazo,
  RECHAZO,
}
