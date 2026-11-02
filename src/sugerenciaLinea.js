// La linea de presupuesto sugerida (la ⭐) y las candidatas de un movimiento.
//
// Vive aparte porque la usan DOS flujos y tienen que coincidir: los botones de
// linea de un gasto nuevo (src/index.js, budgetPickerContext) y la sesion de
// entrenamiento (src/entrenamiento.js). Si cada uno decidiera la ⭐ a su modo,
// el entrenamiento estaria ensenando algo distinto de lo que el bot propone.

const { getBudgetCandidates, resolveBudgetLine } = require('./budgetTracker')
const clasificador = require('./clasificador')

/**
 * @param {{quincenaId:number, categoriaId:number, descripcion:string, tipo:string}} tx
 * @returns {Promise<{candidatas:Array, sugeridaId:number|null, sugeridaConfianza:number|null}>}
 */
async function lineasPara(tx) {
  const lookup = {
    quincenaId: tx.quincenaId,
    categoriaId: tx.categoriaId,
    descripcion: tx.descripcion,
    // El tipo sale de la transaccion, no hardcodeado: un ingreso o un ahorro
    // tambien se cuelgan de una linea.
    tipo: tx.tipo,
  }

  // resolveBudgetLine YA NO ENLAZA NADA: solo dice cual linea es la apuesta
  // fuerte, para ponerla primera y marcarla.
  //
  // Se recalcula en cada llamada, y no se arrastra desde la captura, porque la
  // paginacion es sin estado: `pp:<tx>:<pagina>` vuelve a pedir la lista y a
  // cortarla. Si la pagina 0 pusiera la sugerida primero y las demas no, habria
  // lineas duplicadas entre paginas y otras inalcanzables.
  const [candidatas, sugerida] = await Promise.all([
    getBudgetCandidates(lookup),
    resolveBudgetLine(lookup),
  ])

  // Primero la regla (cuando opina acierta ~94 %, pero opina en 1 de cada 3
  // gastos); si no opina, el modelo que aprende de las lineas que el usuario
  // ya eligio. Ese orden fue el mejor con los datos reales: la ⭐ correcta
  // pasa de 34 % a 62 % (ver CLASIFICADOR_ML.md). Determinista entre
  // llamadas mientras no se aprenda nada nuevo, que es lo que la paginacion
  // sin estado necesita.
  let sugeridaId = sugerida?.id ?? null
  let sugeridaConfianza = null
  if (sugeridaId === null) {
    const delModelo = await clasificador.sugerirLinea(tx.descripcion, candidatas)
    if (delModelo) {
      sugeridaId = delModelo.id
      sugeridaConfianza = delModelo.confianza
    }
  }

  const ordenadas = sugeridaId === null ? candidatas : [
    ...candidatas.filter(c => c.id === sugeridaId),
    ...candidatas.filter(c => c.id !== sugeridaId),
  ]
  return { candidatas: ordenadas, sugeridaId, sugeridaConfianza }
}

module.exports = { lineasPara }
