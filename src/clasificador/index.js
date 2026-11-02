// Servicio del clasificador: dos modelos que aprenden de lo que el usuario
// decide en Telegram (aprendizaje supervisado).
//
//   - CATEGORIA: propone la categoria de un gasto nuevo y pregunta "¿Es
//     correcta?". Aprende SOLO de las respuestas (feedback `aceptada` o
//     `corregida`).
//   - LINEA: sugiere la linea de presupuesto (la ⭐). Aprende de cada gasto
//     que ya tiene linea: esas las eligio una persona con un toque.
//
// POR QUE LA CATEGORIA NO APRENDE DEL HISTORIAL (Fase B, 2026-11-01)
//   Medido con los datos de produccion (CLASIFICADOR_ML.md): entrenado con
//   la categoria de las transacciones viejas, el modelo ACERTABA MENOS que las
//   palabras clave (60-65 % contra 68 %). Esas categorias casi nunca las
//   confirmo nadie -- las puso el mismo parser -- y son inconsistentes
//   ("tacos" esta en Familia, Personal y Diversion). Aprendia ruido. Las
//   respuestas Si/No, en cambio, son decisiones del usuario.
//   Las lineas si son confiables, y ahi el modelo casi duplica a la regla de
//   texto: la ⭐ correcta pasa de 34 % a 62 % de los gastos.
//
// CICLO
//   1. entrenar(): arma los dos modelos desde Postgres. Corre perezoso en la
//      primera llamada y se repite cada REENTRENAR_MS (asi tambien aprende lo
//      que se corrija desde el dashboard).
//   2. proponer() / sugerirLinea(): solo opinan si estan seguros; si no,
//      devuelven null y manda la regla de siempre.
//   3. registrarPropuesta() / resolver(): la pregunta de categoria y su
//      respuesta, en `clasificacion_feedback`. aprenderLinea(): el toque de
//      linea. Las dos aprenden EN ESE MOMENTO, sin esperar al reentreno.
//
// NADA DE ESTO PUEDE TIRAR EL REGISTRO DE UN GASTO: cada funcion publica
// atrapa sus errores, los loguea y devuelve null. Si el clasificador falla,
// el bot se comporta exactamente como antes de que existiera.

const prisma = require('../lib/prisma')
const { Modelo, normalizar } = require('./modelo')

const REENTRENAR_MS = 6 * 60 * 60 * 1000
// Por debajo de esto un modelo no opina: con 5 ejemplos cualquier
// probabilidad es ruido.
const MIN_EJEMPLOS = 20
// Categoria: el modelo reemplaza a las reglas solo si esta muy seguro.
const MIN_PROBABILIDAD = 0.8
const MIN_COBERTURA = 0.5
// Linea: el umbral que mejor resulto en la evaluacion con datos reales
// (con 0.4 la ⭐ acierta 62 %; con 0.5, 61 %).
const MIN_PROBABILIDAD_LINEA = 0.4
// Una correccion explicita pesa mas que una aceptacion. Con 3, una sola
// correccion de "uber eats" arrastraba tambien a "uber" solo; con 2 se
// separan (ver el caso M5 de scripts/test-clasificador.js).
const PESO_CORRECCION = 2

const ESTADO = { PENDIENTE: 'pendiente', ACEPTADA: 'aceptada', CORREGIDA: 'corregida' }

let modelo = null        // categoria
let modeloLineas = null  // linea (etiqueta = nombre normalizado de la linea)
let categorias = new Map() // id -> nombre (solo Gasto activas)
let entrenadoEn = 0
let entrenando = null

function habilitado() {
  return process.env.CLASIFICADOR_ML_ENABLED !== 'false'
}

// Las lineas se repiten cada quincena con el mismo nombre ("Super",
// "Gasolina Spark") pero con otro id. Por eso se aprende el NOMBRE.
function etiquetaLinea(descripcion) {
  return normalizar(descripcion)
}

async function entrenar() {
  const [feedback, cats, conLinea, ejemplos] = await Promise.all([
    prisma.clasificacionFeedback.findMany({
      where: { estado: { in: [ESTADO.ACEPTADA, ESTADO.CORREGIDA] } },
      select: { texto: true, categoriaFinalId: true, estado: true },
    }),
    prisma.categoria.findMany({ where: { activo: true, tipo: 'Gasto' } }),
    prisma.transaccion.findMany({
      where: { presupuestoId: { not: null } },
      select: { descripcion: true, presupuesto: { select: { descripcion: true } } },
    }),
    // Palabras sueltas del entrenamiento "Yo te escribo palabras". Si la tabla
    // falla, se entrena sin ellas: no puede tumbar a los otros dos origenes.
    (async () => prisma.clasificadorEjemplo.findMany({
      where: { estado: 'confirmado' },
      select: { texto: true, lineaDescripcion: true, categoriaId: true, acerto: true },
    }))().catch(error => {
      console.error('CLASIFICADOR_EJEMPLOS_ERROR:', error.message)
      return []
    }),
  ])

  const permitidas = new Set((cats || []).map(c => c.id))
  const nuevo = new Modelo()
  for (const f of feedback || []) {
    if (permitidas.has(f.categoriaFinalId)) {
      nuevo.aprender(f.texto, f.categoriaFinalId, f.estado === ESTADO.CORREGIDA ? PESO_CORRECCION : 1)
    }
  }

  const lineas = new Modelo()
  for (const t of conLinea || []) {
    if (t.presupuesto?.descripcion) lineas.aprender(t.descripcion, etiquetaLinea(t.presupuesto.descripcion))
  }

  // Una palabra que el bot fallo y el usuario corrigio pesa como cualquier
  // correccion: es la senal mas clara de que habia que cambiar de opinion.
  for (const e of ejemplos || []) {
    const peso = e.acerto === false ? PESO_CORRECCION : 1
    if (e.lineaDescripcion) lineas.aprender(e.texto, etiquetaLinea(e.lineaDescripcion), peso)
    if (permitidas.has(e.categoriaId)) nuevo.aprender(e.texto, e.categoriaId, peso)
  }

  modelo = nuevo
  modeloLineas = lineas
  categorias = new Map((cats || []).map(c => [c.id, c.nombre]))
  entrenadoEn = Date.now()
  console.log(`CLASIFICADOR_ENTRENADO: categoria=${nuevo.ejemplos} respuestas; lineas=${lineas.ejemplos} gastos; palabras=${(ejemplos || []).length}; categorias=${categorias.size}`)
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

/**
 * Respuesta de la sesion de entrenamiento: el usuario confirmo (o corrigio) la
 * categoria de un gasto. A diferencia de resolver(), puede no existir una
 * propuesta previa (gastos viejos, de antes del clasificador): entonces se
 * crea la fila ya resuelta. Si existe y ya estaba resuelta, la respuesta
 * nueva la reemplaza: es la decision mas reciente del usuario.
 *
 * @returns {Promise<{estado:string}|null>}
 */
async function confirmar({ transaccionId, texto, categoriaPropuestaId, categoriaFinalId, fuente, confianza = null }) {
  if (!habilitado()) return null
  try {
    const txId = Number(transaccionId)
    const propuestaId = Number(categoriaPropuestaId)
    const finalId = Number(categoriaFinalId)
    const estado = propuestaId === finalId ? ESTADO.ACEPTADA : ESTADO.CORREGIDA
    const data = {
      categoriaPropuestaId: propuestaId,
      categoriaFinalId: finalId,
      fuente,
      confianza: confianza == null ? null : Number(confianza.toFixed(4)),
      estado,
      resueltaEn: new Date(),
    }
    const fb = await prisma.clasificacionFeedback.findUnique({ where: { transaccionId: txId } })
    if (fb) {
      await prisma.clasificacionFeedback.updateMany({ where: { id: fb.id }, data })
    } else {
      await prisma.clasificacionFeedback.create({ data: { transaccionId: txId, texto: String(texto ?? '').slice(0, 200), ...data } })
    }
    if (modelo && categorias.has(finalId)) {
      modelo.aprender(fb?.texto ?? texto, finalId, estado === ESTADO.CORREGIDA ? PESO_CORRECCION : 1)
    }
    console.log(`CLASIFICADOR_ENTRENAMIENTO: tx=${txId}; estado=${estado}; fuente=${fuente}; propuesta=${propuestaId}; final=${finalId}`)
    return { estado }
  } catch (error) {
    console.error('CLASIFICADOR_CONFIRMAR_ERROR:', error.message)
    return null
  }
}

/**
 * La linea de presupuesto mas probable para una descripcion, ELEGIDA ENTRE
 * `candidatas` (las de la quincena y el tipo del movimiento), o null si el
 * modelo no esta seguro.
 *
 * @param {Array<{id:number, descripcion:string}>} candidatas
 * @returns {Promise<{id:number, confianza:number}|null>}
 */
async function sugerirLinea(descripcion, candidatas) {
  if (!habilitado() || !candidatas?.length) return null
  try {
    await asegurarModelo()
    if (!modeloLineas || modeloLineas.ejemplos < MIN_EJEMPLOS) return null
    const porEtiqueta = new Map()
    for (const c of candidatas) {
      const e = etiquetaLinea(c.descripcion)
      if (e && !porEtiqueta.has(e)) porEtiqueta.set(e, c)
    }
    const { ranking, cobertura } = modeloLineas.predecir(descripcion, porEtiqueta.keys())
    const top = ranking[0]
    if (!top || top.probabilidad < MIN_PROBABILIDAD_LINEA || cobertura < MIN_COBERTURA) return null
    return { id: porEtiqueta.get(top.etiqueta).id, confianza: top.probabilidad }
  } catch (error) {
    console.error('CLASIFICADOR_LINEA_ERROR:', error.message)
    return null
  }
}

// Una palabra suelta confirmada en el entrenamiento: entra a los dos modelos
// en ese momento (y queda en clasificador_ejemplos para los reentrenos).
function aprenderEjemplo(texto, lineaDescripcion, categoriaId, { corregida = false } = {}) {
  if (!habilitado()) return false
  try {
    const peso = corregida ? PESO_CORRECCION : 1
    if (modeloLineas && lineaDescripcion) modeloLineas.aprender(texto, etiquetaLinea(lineaDescripcion), peso)
    if (modelo && categorias.has(Number(categoriaId))) modelo.aprender(texto, Number(categoriaId), peso)
    return true
  } catch (error) {
    console.error('CLASIFICADOR_EJEMPLO_ERROR:', error.message)
    return false
  }
}

/**
 * La MEJOR APUESTA de linea entre `candidatas`, sin umbral: aunque el modelo
 * no este seguro, dice cual es la mas probable y con que confianza. La usa el
 * entrenamiento de palabras, donde el usuario siempre confirma (pidio que el
 * bot "siempre mande la aproximacion"). Null solo si el modelo no tiene ni un
 * ejemplo o no hay candidatas.
 *
 * @returns {Promise<{id:number, confianza:number, cobertura:number}|null>}
 */
async function mejorLinea(descripcion, candidatas) {
  if (!habilitado() || !candidatas?.length) return null
  try {
    await asegurarModelo()
    if (!modeloLineas || modeloLineas.ejemplos === 0) return null
    const porEtiqueta = new Map()
    for (const c of candidatas) {
      const e = etiquetaLinea(c.descripcion)
      if (e && !porEtiqueta.has(e)) porEtiqueta.set(e, c)
    }
    const { ranking, cobertura } = modeloLineas.predecir(descripcion, porEtiqueta.keys())
    const top = ranking[0]
    if (!top) return null
    return { id: porEtiqueta.get(top.etiqueta).id, confianza: top.probabilidad, cobertura }
  } catch (error) {
    console.error('CLASIFICADOR_LINEA_ERROR:', error.message)
    return null
  }
}

// El usuario enlazo un gasto a una linea: ese es el ejemplo.
function aprenderLinea(descripcion, lineaDescripcion) {
  if (!habilitado() || !modeloLineas) return false
  try {
    return modeloLineas.aprender(descripcion, etiquetaLinea(lineaDescripcion))
  } catch (error) {
    console.error('CLASIFICADOR_LINEA_ERROR:', error.message)
    return false
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
  modeloLineas = null
  categorias = new Map()
  entrenadoEn = 0
  entrenando = null
}

module.exports = {
  proponer,
  registrarPropuesta,
  resolver,
  confirmar,
  pendiente,
  sugerirLinea,
  mejorLinea,
  aprenderLinea,
  aprenderEjemplo,
  entrenar,
  habilitado,
  ESTADO,
  MIN_EJEMPLOS,
  MIN_PROBABILIDAD,
  MIN_COBERTURA,
  MIN_PROBABILIDAD_LINEA,
  _reiniciar,
}
