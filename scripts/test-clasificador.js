// Pruebas del clasificador de categorias (src/clasificador/), sin red ni
// Postgres.
//
// Dos partes:
//   1. El modelo puro (modelo.js): que aprenda, que tolere errores de dedo,
//      que diga "no se" cuando no sabe, y que una correccion le cambie la
//      opinion.
//   2. El servicio (index.js) con un doble de Prisma: que reglas decide QUE
//      entra al entrenamiento (sobre todo, que NO se entrene con sus propias
//      adivinanzas sin confirmar) y que nunca truene hacia el llamador.

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

// --- Doble de Prisma para el servicio ---

let txs = []
let conLinea = []
let feedbacks = []
let categorias = []
let falla = false
const llamadas = []

function cumple(f, where = {}) {
  return Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && Array.isArray(v.in) ? v.in.includes(f[k]) : f[k] === v))
}
function registrar(tabla, metodo) {
  llamadas.push(`${tabla}.${metodo}`)
  if (falla) throw new Error('la base no responde')
}

const fakePrisma = {
  transaccion: {
    // La unica firma que usa el servicio: los gastos con linea (modelo de
    // lineas). Si algun dia vuelve a leer otra cosa, el registro lo delata.
    findMany: async ({ where }) => {
      registrar('transaccion', where?.presupuestoId?.not === null ? 'findMany:lineas' : 'findMany:categoria')
      return where?.presupuestoId?.not === null ? conLinea : txs
    },
  },
  categoria: {
    findMany: async ({ where }) => { registrar('categoria', 'findMany'); return categorias.filter(c => cumple(c, where)) },
  },
  clasificacionFeedback: {
    findMany: async ({ where }) => { registrar('feedback', 'findMany'); return feedbacks.filter(f => cumple(f, where)) },
    findUnique: async ({ where }) => { registrar('feedback', 'findUnique'); return feedbacks.find(f => f.transaccionId === where.transaccionId) || null },
    create: async ({ data }) => { registrar('feedback', 'create'); const row = { id: feedbacks.length + 1, ...data }; feedbacks.push(row); return row },
    updateMany: async ({ where, data }) => {
      registrar('feedback', 'updateMany')
      const filas = feedbacks.filter(f => cumple(f, where))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
  },
}
const prismaPath = require.resolve(path.join(SRC, 'lib', 'prisma.js'))
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma }

// Silencia los logs del servicio para que la salida sea legible.
const logs = []
for (const nivel of ['log', 'error']) {
  const original = console[nivel].bind(console)
  console[nivel] = (...args) => {
    const linea = args.join(' ')
    if (linea.startsWith('CLASIFICADOR_')) { logs.push(linea); return }
    original(...args)
  }
}

const { Modelo, rasgos, normalizar } = require(path.join(SRC, 'clasificador', 'modelo.js'))
const clasificador = require(path.join(SRC, 'clasificador'))

const FAMILIA = 3, TRANSPORTE = 4, PERSONAL = 7, INGRESOS = 1
const DATOS = {
  [FAMILIA]: ['super', 'super walmart', 'croquetas', 'ninera', 'guarderia', 'tacos', 'pizza', 'mercado', 'pañales', 'tortillas'],
  [TRANSPORTE]: ['gas spark', 'gasolina corolla', 'uber', 'didi', 'caseta', 'estacionamiento', 'gasolina'],
  [PERSONAL]: ['gym', 'corte pelo', 'ropa', 'tenis', 'yoga', 'libro', 'maestria'],
}

function entrenado() {
  const m = new Modelo()
  for (const [cat, textos] of Object.entries(DATOS)) for (const t of textos) m.aprender(t, cat)
  return m
}
const top = (m, t) => m.predecir(t).ranking[0]?.etiqueta

async function main() {
  console.log('\n=== M1: normalizacion ===')
  check('acentos, ñ, mayusculas y montos no cambian los rasgos',
    JSON.stringify([...rasgos('Niñera $800.50')]) === JSON.stringify([...rasgos('ninera')]))
  check('quita palabras vacias', normalizar('Pagué la LUZ') === 'pague la luz' && !rasgos('pague la luz').has('w:la'))
  check('un texto sin letras no da rasgos', rasgos('$ 200 !!').size === 0)

  console.log('\n=== M2: aprende de los ejemplos ===')
  const m = entrenado()
  check('ejemplos contados', m.ejemplos === 24, m.ejemplos)
  check('"croquetas" -> Familia', top(m, 'croquetas') === String(FAMILIA), top(m, 'croquetas'))
  check('"gasolina spark" -> Transporte', top(m, 'gasolina spark') === String(TRANSPORTE), top(m, 'gasolina spark'))
  check('"corte de pelo" -> Personal', top(m, 'corte de pelo') === String(PERSONAL), top(m, 'corte de pelo'))

  console.log('\n=== M3: tolera errores de dedo y variantes ===')
  check('"niñera" (con ñ) -> Familia', top(m, 'niñera') === String(FAMILIA), top(m, 'niñera'))
  check('"guarderya" -> Familia', top(m, 'guarderya') === String(FAMILIA), top(m, 'guarderya'))
  check('"gasolinera" -> Transporte', top(m, 'gasolinera') === String(TRANSPORTE), top(m, 'gasolinera'))

  console.log('\n=== M4: cuando no sabe, lo dice ===')
  const r = m.predecir('xqzw')
  check('cobertura 0 en un texto nunca visto', r.cobertura === 0, r.cobertura)
  check('y la probabilidad no es alta (solo la previa)', r.ranking[0].probabilidad < 0.5, r.ranking[0].probabilidad)
  const conocido = m.predecir('croquetas')
  check('cobertura 1 en una palabra conocida', conocido.cobertura === 1, conocido.cobertura)
  check('las probabilidades suman 1', Math.abs(conocido.ranking.reduce((s, x) => s + x.probabilidad, 0) - 1) < 1e-9)
  check('la confianza no sale "100 %" de una sola palabra', conocido.ranking[0].probabilidad < 0.999, conocido.ranking[0].probabilidad)

  console.log('\n=== M5: una correccion le cambia la opinion ===')
  // Con varios "uber" de Transporte en el historico, como en los datos reales.
  const m2 = entrenado()
  for (let i = 0; i < 4; i++) m2.aprender('uber', TRANSPORTE)
  check('antes: "uber eats" -> Transporte', top(m2, 'uber eats') === String(TRANSPORTE), top(m2, 'uber eats'))
  m2.aprender('uber eats', FAMILIA, 2)
  check('despues de corregir: "uber eats" -> Familia', top(m2, 'uber eats') === String(FAMILIA), top(m2, 'uber eats'))
  check('y "uber" solo sigue en Transporte', top(m2, 'uber') === String(TRANSPORTE), top(m2, 'uber'))

  console.log('\n=== M6: solo elige entre las categorias permitidas ===')
  const soloPersonal = m.predecir('croquetas', [PERSONAL])
  check('restringe las clases', soloPersonal.ranking.length === 1 && soloPersonal.ranking[0].etiqueta === String(PERSONAL), JSON.stringify(soloPersonal.ranking))
  check('sin clases permitidas, ranking vacio', m.predecir('croquetas', []).ranking.length === 0)

  // --- Servicio ---
  categorias = [
    { id: FAMILIA, nombre: 'Familia', tipo: 'Gasto', activo: true },
    { id: TRANSPORTE, nombre: 'Transporte', tipo: 'Gasto', activo: true },
    { id: PERSONAL, nombre: 'Personal', tipo: 'Gasto', activo: true },
    { id: INGRESOS, nombre: 'Ingresos', tipo: 'Ingreso', activo: true },
  ]
  // El modelo de categoria aprende SOLO de respuestas confirmadas.
  let fid = 1
  const respuesta = (texto, categoriaFinalId, estado = 'aceptada') => {
    const f = { id: fid, transaccionId: fid++, texto, categoriaPropuestaId: categoriaFinalId, categoriaFinalId, estado, fuente: 'reglas' }
    feedbacks.push(f)
    return f
  }
  const lecturas = () => llamadas.filter(l => l === 'feedback.findMany').length

  console.log('\n=== S1: con pocas respuestas no opina ===')
  for (const t of ['super', 'uber', 'gym']) respuesta(t, t === 'super' ? FAMILIA : t === 'uber' ? TRANSPORTE : PERSONAL)
  clasificador._reiniciar()
  check('menos de MIN_EJEMPLOS -> null', (await clasificador.proponer('super')) === null)

  console.log('\n=== S2: con respuestas, propone con su confianza ===')
  feedbacks = []
  for (const [cat, textos] of Object.entries(DATOS)) for (const t of textos) respuesta(t, Number(cat))
  clasificador._reiniciar()
  const p = await clasificador.proponer('super soriana')
  check('propone Familia', p?.categoriaId === FAMILIA && p?.nombre === 'Familia', JSON.stringify(p))
  check('con confianza sobre el umbral', p?.confianza >= clasificador.MIN_PROBABILIDAD, p?.confianza)
  check('texto desconocido -> null', (await clasificador.proponer('xqzw')) === null)
  check('no reentrena en cada llamada', lecturas() === 2, lecturas())

  console.log('\n=== S3: solo cuentan las respuestas, no el historial ===')
  txs = [{ descripcion: 'historial ruidoso', categoriaId: PERSONAL, tipo: 'Gasto' }]
  respuesta('convivio', PERSONAL, 'pendiente')   // sin contestar: no cuenta
  respuesta('uber eats', FAMILIA, 'corregida')   // correccion: pesa 2
  respuesta('sueldo', INGRESOS)                  // no es de gasto: no cuenta
  await clasificador.entrenar()
  check('24 aceptadas + 0 pendiente + 2 (corregida) + 0 (ingreso) = 26', logs.at(-1)?.includes('categoria=26 respuestas'), logs.at(-1))
  check('ni consulta las categorias de las transacciones', !llamadas.includes('transaccion.findMany:categoria'))

  console.log('\n=== S4: registrar y resolver ===')
  feedbacks = feedbacks.filter(f => f.estado !== 'pendiente')
  const fb = await clasificador.registrarPropuesta({ transaccionId: 5000, texto: 'croquetas firulais', categoriaPropuestaId: FAMILIA, fuente: 'modelo', confianza: 0.87654 })
  const fila = () => feedbacks.find(f => f.transaccionId === 5000)
  check('guarda la propuesta pendiente', fb?.estado === 'pendiente' && fb?.fuente === 'modelo', JSON.stringify(fb))
  check('redondea la confianza a 4 decimales', fb?.confianza === 0.8765, fb?.confianza)
  check('pendiente() la encuentra', (await clasificador.pendiente(5000))?.id === fb.id)
  const r1 = await clasificador.resolver({ transaccionId: 5000, categoriaFinalId: FAMILIA })
  check('misma categoria -> aceptada', r1?.estado === 'aceptada' && fila().categoriaFinalId === FAMILIA && fila().resueltaEn instanceof Date, JSON.stringify(r1))
  check('pendiente() ya no la encuentra', (await clasificador.pendiente(5000)) === null)
  check('resolver dos veces no hace nada', (await clasificador.resolver({ transaccionId: 5000, categoriaFinalId: PERSONAL })) === null && fila().estado === 'aceptada')
  check('sin propuesta, resolver no hace nada', (await clasificador.resolver({ transaccionId: 99999, categoriaFinalId: FAMILIA })) === null)

  console.log('\n=== S5: una correccion se aprende EN EL MOMENTO ===')
  await clasificador.entrenar()
  const antes = await clasificador.proponer('uber eats')
  await clasificador.registrarPropuesta({ transaccionId: 5001, texto: 'didi food', categoriaPropuestaId: TRANSPORTE, fuente: 'modelo', confianza: 0.7 })
  const lecturasAntes = lecturas()
  const r2 = await clasificador.resolver({ transaccionId: 5001, categoriaFinalId: FAMILIA })
  check('distinta categoria -> corregida', r2?.estado === 'corregida', JSON.stringify(r2))
  await clasificador.resolver({ transaccionId: 5001, categoriaFinalId: FAMILIA })
  const despues = await clasificador.proponer('didi food')
  check('sin reentrenar desde la base', lecturas() === lecturasAntes)
  check('"didi food" ya sale Familia', despues?.categoriaId === FAMILIA, JSON.stringify(despues))
  check('(y "uber eats" ya era Familia por la correccion de S3)', antes?.categoriaId === FAMILIA, JSON.stringify(antes))

  console.log('\n=== L1: linea -- con pocos ejemplos no opina ===')
  const CANDIDATAS = [
    { id: 31, descripcion: 'Super' },
    { id: 32, descripcion: 'Diversión' },
    { id: 33, descripcion: 'Gasolina Spark' },
    { id: 34, descripcion: 'Colegiatura' },
  ]
  conLinea = [{ descripcion: 'croquetas', presupuesto: { descripcion: 'Super' } }]
  clasificador._reiniciar()
  check('null', (await clasificador.sugerirLinea('croquetas', CANDIDATAS)) === null)

  console.log('\n=== L2: linea -- aprende el NOMBRE de la linea, no el id ===')
  conLinea = []
  const hist = { Super: ['croquetas', 'tortillas', 'mercado', '3b', 'pañales', 'coca'], Diversion: ['tacos', 'helado', 'pizza', 'cine', 'tortas'], 'Gasolina Spark': ['gasolina spark', 'gasolina', 'gas spark'] }
  for (let i = 0; i < 2; i++) for (const [linea, textos] of Object.entries(hist)) for (const t of textos) conLinea.push({ descripcion: t, presupuesto: { descripcion: linea } })
  clasificador._reiniciar()
  const s1 = await clasificador.sugerirLinea('croquetas gatos', CANDIDATAS)
  check('"croquetas gatos" -> la linea Super de ESTA quincena (id 31)', s1?.id === 31, JSON.stringify(s1))
  check('trae su confianza', s1?.confianza >= clasificador.MIN_PROBABILIDAD_LINEA && s1?.confianza <= 1, s1?.confianza)
  const s2 = await clasificador.sugerirLinea('helado', CANDIDATAS)
  check('"Diversion" aprendida empata con "Diversión" (sin acento) de esta quincena', s2?.id === 32, JSON.stringify(s2))
  check('solo elige entre las candidatas', (await clasificador.sugerirLinea('croquetas', CANDIDATAS.filter(c => c.id !== 31)))?.id !== 31)
  check('texto desconocido -> null', (await clasificador.sugerirLinea('xqzw', CANDIDATAS)) === null)
  check('sin candidatas -> null', (await clasificador.sugerirLinea('croquetas', [])) === null)

  console.log('\n=== L3: linea -- un toque se aprende en el momento ===')
  check('antes: "kermes" no se conoce', (await clasificador.sugerirLinea('kermes', CANDIDATAS)) === null)
  clasificador.aprenderLinea('kermes', 'Colegiatura')
  clasificador.aprenderLinea('kermes', 'Colegiatura')
  check('despues de dos toques -> Colegiatura', (await clasificador.sugerirLinea('kermes', CANDIDATAS))?.id === 34)

  console.log('\n=== C1: confirmar (sesion de entrenamiento) ===')
  const sinFila = await clasificador.confirmar({ transaccionId: 7000, texto: 'kermes', categoriaPropuestaId: PERSONAL, categoriaFinalId: FAMILIA, fuente: 'reglas' })
  const f7000 = () => feedbacks.find(f => f.transaccionId === 7000)
  check('sin propuesta previa crea la fila ya resuelta', sinFila?.estado === 'corregida' && f7000()?.categoriaFinalId === FAMILIA && f7000()?.resueltaEn instanceof Date, JSON.stringify(f7000()))
  await clasificador.confirmar({ transaccionId: 7000, texto: 'kermes', categoriaPropuestaId: FAMILIA, categoriaFinalId: FAMILIA, fuente: 'modelo' })
  check('una respuesta nueva reemplaza a la anterior (sin duplicar)', feedbacks.filter(f => f.transaccionId === 7000).length === 1 && f7000().estado === 'aceptada', JSON.stringify(f7000()))
  const op = await clasificador.opinar('kermes')
  check('opinar: ya opina Familia de "kermes" (aprendio al confirmar)', op?.categoriaId === FAMILIA, JSON.stringify(op))
  check('opinar: texto desconocido -> null', (await clasificador.opinar('xqzw')) === null)
  const mk = await clasificador.marcador()
  const resueltas = feedbacks.filter(f => f.estado === 'aceptada' || f.estado === 'corregida')
  check('marcador cuenta respuestas y aciertos', mk?.respuestas === resueltas.length && mk?.aceptadas === resueltas.filter(f => f.estado === 'aceptada').length, JSON.stringify(mk))

  console.log('\n=== C2: que frases abren el entrenamiento ===')
  const { esPedidoDeEntrenar } = require(path.join(SRC, 'entrenamiento.js'))
  for (const t of ['vamos a entrenar', 'Vamos a entrenar!', 'entrenar', '/entrenar', 'entrenemos', 'quiero entrenar', 'entrenamiento']) check(`"${t}" -> si`, esPedidoDeEntrenar(t))
  for (const t of ['entrenador 200', '200 entrenador', 'entrenamiento de futbol 300', 'clase de entrenamiento 200', 'hola']) check(`"${t}" -> no`, !esPedidoDeEntrenar(t))

  console.log('\n=== S6: nunca truena hacia el llamador ===')
  falla = true
  clasificador._reiniciar()
  check('proponer con la base caida -> null', (await clasificador.proponer('super')) === null)
  check('registrarPropuesta con la base caida -> null', (await clasificador.registrarPropuesta({ transaccionId: 1, texto: 'x', categoriaPropuestaId: 1, fuente: 'reglas' })) === null)
  check('resolver con la base caida -> null', (await clasificador.resolver({ transaccionId: 1, categoriaFinalId: 1 })) === null)
  check('deja el error en el log', logs.some(l => l.startsWith('CLASIFICADOR_PROPONER_ERROR')))
  falla = false

  console.log('\n=== S7: CLASIFICADOR_ML_ENABLED=false lo apaga sin tocar la base ===')
  process.env.CLASIFICADOR_ML_ENABLED = 'false'
  clasificador._reiniciar()
  const llamadasAntes = llamadas.length
  check('proponer -> null', (await clasificador.proponer('super')) === null)
  check('registrarPropuesta -> null', (await clasificador.registrarPropuesta({ transaccionId: 1, texto: 'x', categoriaPropuestaId: 1, fuente: 'reglas' })) === null)
  check('ninguna consulta', llamadas.length === llamadasAntes, llamadas.slice(llamadasAntes).join())
  delete process.env.CLASIFICADOR_ML_ENABLED

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
