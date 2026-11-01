// Servicio del clasificador de categorias: lo entrena con lo que ya hay en
// Postgres, propone una categoria para cada gasto nuevo y aprende de la
// respuesta del usuario (aprendizaje supervisado).
//
// CICLO
//   1. entrenar(): lee `transacciones` de tipo Gasto y arma el modelo. Corre
//      perezoso en la primera propuesta y se repite cada REENTRENAR_MS, asi
//      que lo que se corrija desde el dashboard tambien termina aprendido.
//   2. proponer(descripcion): la categoria mas probable, SOLO si el modelo
//      esta seguro. Si no, devuelve null y el llamador usa las reglas de
//      siempre (palabras clave de src/parser.js y la IA).
//   3. registrarPropuesta(): guarda en `clasificacion_feedback` que se
//      propuso, con que confianza y de donde salio (modelo o reglas).
//   4. resolver(): el usuario contesto. Se marca `aceptada` o `corregida`, y
//      el ejemplo entra al modelo EN ESE MOMENTO, sin esperar al reentreno.
//
// QUE CUENTA COMO EJEMPLO AL ENTRENAR
//   Toda transaccion de tipo Gasto, MENOS las que el bot propuso y nadie ha
//   confirmado todavia (feedback `pendiente` con la misma categoria que se
//   propuso). Sin esta exclusion el modelo se entrenaria con sus propias
//   adivinanzas y un error se reforzaria solo. Si una pendiente se cambio
//   desde el dashboard (su categoria ya no es la propuesta), eso SI es una
//   decision humana y cuenta.
//
// NADA DE ESTO PUEDE TIRAR EL REGISTRO DE UN GASTO: cada funcion publica
// atrapa sus errores, los loguea y devuelve null. Si el clasificador falla,
// el bot se comporta exactamente como antes de que existiera.

const prisma = require('../lib/prisma')
const { Modelo } = require('./modelo')

const REENTRENAR_MS = 6 * 60 * 60 * 1000
// Por debajo de esto el modelo no opina: con 5 ejemplos cualquier
// probabilidad es ruido.
const MIN_EJEMPLOS = 20
// Umbrales para que la propuesta del modelo reemplace a las reglas. Se
// ajustan con scripts/evaluar-clasificador.js contra los datos reales.
const MIN_PROBABILIDAD = 0.6
const MIN_COBERTURA = 0.5
// Una correccion explicita pesa mas que un dato historico: es la senal mas
// clara que existe de que el modelo (o las reglas) se equivocaron. Con 3, una
// sola correccion de "uber eats" arrastraba tambien a "uber" solo; con 2 se
// separan (ver el caso M5 de scripts/test-clasificador.js).
const PESO_CORRECCION = 2

const ESTADO = { PENDIENTE: 'pendiente', ACEPTADA: 'aceptada', CORREGIDA: 'corregida' }

let modelo = null
let categorias = new Map() // id -> nombre (solo Gasto activas)
let entrenadoEn = 0
let entrenando = null

function habilitado() {
  return process.env.CLASIFICADOR_ML_ENABLED !== 'false'
}

async function cargarEjemplos() {
  const [txs, feedback, cats] = await Promise.all([
    prisma.transaccion.findMany({
      where: { tipo: 'Gasto' },
      select: { id: true, descripcion: true, categoriaId: true },
    }),
    prisma.clasificacionFeedback.findMany({
      where: { estado: { in: [ESTADO.PENDIENTE, ESTADO.CORREGIDA] } },
      select: { transaccionId: true, categoriaPropuestaId: true, estado: true },
    }),
    prisma.categoria.findMany({ where: { activo: true, tipo: 'Gasto' } }),
  ])

  const propuestaPendiente = new Map()
  const corregidas = new Set()
  for (const f of feedback || []) {
    if (f.estado === ESTADO.PENDIENTE) propuestaPendiente.set(f.transaccionId, f.categoriaPropuestaId)
    else corregidas.add(f.transaccionId)
  }

  const ejemplos = []
  for (const tx of txs || []) {
    if (propuestaPendiente.get(tx.id) === tx.categoriaId) continue
    ejemplos.push({
      texto: tx.descripcion,
      categoriaId: tx.categoriaId,
      peso: corregidas.has(tx.id) ? PESO_CORRECCION : 1,
    })
  }
  return { ejemplos, cats: cats || [] }
}

async function entrenar() {
  const { ejemplos, cats } = await cargarEjemplos()
  const nuevo = new Modelo()
  const permitidas = new Set(cats.map(c => c.id))
  for (const e of ejemplos) {
    if (permitidas.has(e.categoriaId)) nuevo.aprender(e.texto, e.categoriaId, e.peso)
  }
  modelo = nuevo
  categorias = new Map(cats.map(c => [c.id, c.nombre]))
  entrenadoEn = Date.now()
  console.log(`CLASIFICADOR_ENTRENADO: ejemplos=${nuevo.ejemplos}; categorias=${categorias.size}`)
  return nuevo
}

async function asegurarModelo() {
  if (modelo && Date.now() - entrenadoEn < REENTRENAR_MS) return modelo
  if (!entrenando) {
    entrenando = entrenar().finally(() => { entrenando = null })
  }
  return entrenando
}

/**
 * Categoria propuesta para una descripcion de gasto, o null si el modelo no
 * esta seguro (o no hay suficientes datos, o esta apagado).
 *
 * @returns {Promise<{categoriaId:number, nombre:string, confianza:number, cobertura:number}|null>}
 */
async function proponer(descripcion) {
  if (!habilitado()) return null
  try {
    const m = await asegurarModelo()
    if (!m || m.ejemplos < MIN_EJEMPLOS) return null
    const { ranking, cobertura } = m.predecir(descripcion, categorias.keys())
    const top = ranking[0]
    if (!top || top.probabilidad < MIN_PROBABILIDAD || cobertura < MIN_COBERTURA) return null
    const categoriaId = Number(top.etiqueta)
    return { categoriaId, nombre: categorias.get(categoriaId), confianza: top.probabilidad, cobertura }
  } catch (error) {
    console.error('CLASIFICADOR_PROPONER_ERROR:', error.message)
    return null
  }
}

// Deja constancia de lo que se le propuso al usuario. `fuente` = 'modelo' si
// la categoria salio de aqui, 'reglas' si salio del parser o de la IA. Las
// dos se preguntan: una respuesta a una propuesta de las reglas tambien es un
// ejemplo etiquetado.
async function registrarPropuesta({ transaccionId, texto, categoriaPropuestaId, fuente, confianza = null }) {
  if (!habilitado()) return null
  try {
    return await prisma.clasificacionFeedback.create({
      data: {
        transaccionId: Number(transaccionId),
        texto: String(texto ?? '').slice(0, 200),
        categoriaPropuestaId: Number(categoriaPropuestaId),
        fuente,
        confianza: confianza == null ? null : Number(confianza.toFixed(4)),
        estado: ESTADO.PENDIENTE,
      },
    })
  } catch (error) {
    console.error('CLASIFICADOR_REGISTRO_ERROR:', error.message)
    return null
  }
}

/**
 * El usuario contesto. Idempotente: si ya no hay propuesta pendiente para esa
 * transaccion (se contesto antes, o nunca hubo), no hace nada.
 *
 * @returns {Promise<{estado:string, categoriaPropuestaId:number, categoriaFinalId:number}|null>}
 */
async function resolver({ transaccionId, categoriaFinalId }) {
  if (!habilitado()) return null
  try {
    const txId = Number(transaccionId)
    const finalId = Number(categoriaFinalId)
    const fb = await prisma.clasificacionFeedback.findUnique({ where: { transaccionId: txId } })
    if (!fb || fb.estado !== ESTADO.PENDIENTE) return null

    const estado = fb.categoriaPropuestaId === finalId ? ESTADO.ACEPTADA : ESTADO.CORREGIDA
    // updateMany con el estado en el where: si dos toques llegan a la vez,
    // solo uno encuentra la fila pendiente y solo ese aprende.
    const { count } = await prisma.clasificacionFeedback.updateMany({
      where: { id: fb.id, estado: ESTADO.PENDIENTE },
      data: { estado, categoriaFinalId: finalId, resueltaEn: new Date() },
    })
    if (!count) return null

    if (modelo && categorias.has(finalId)) {
      modelo.aprender(fb.texto, finalId, estado === ESTADO.CORREGIDA ? PESO_CORRECCION : 1)
    }
    console.log(`CLASIFICADOR_FEEDBACK: tx=${txId}; estado=${estado}; fuente=${fb.fuente}; propuesta=${fb.categoriaPropuestaId}; final=${finalId}`)
    return { estado, categoriaPropuestaId: fb.categoriaPropuestaId, categoriaFinalId: finalId, fuente: fb.fuente }
  } catch (error) {
    console.error('CLASIFICADOR_RESOLVER_ERROR:', error.message)
    return null
  }
}

// La propuesta que sigue esperando respuesta para esa transaccion, o null.
async function pendiente(transaccionId) {
  if (!habilitado()) return null
  try {
    const fb = await prisma.clasificacionFeedback.findUnique({ where: { transaccionId: Number(transaccionId) } })
    return fb && fb.estado === ESTADO.PENDIENTE ? fb : null
  } catch (error) {
    console.error('CLASIFICADOR_PENDIENTE_ERROR:', error.message)
    return null
  }
}

// Solo para pruebas: olvida el modelo en memoria.
function _reiniciar() {
  modelo = null
  categorias = new Map()
  entrenadoEn = 0
  entrenando = null
}

module.exports = {
  proponer,
  registrarPropuesta,
  resolver,
  pendiente,
  entrenar,
  habilitado,
  ESTADO,
  MIN_EJEMPLOS,
  MIN_PROBABILIDAD,
  MIN_COBERTURA,
  _reiniciar,
}
