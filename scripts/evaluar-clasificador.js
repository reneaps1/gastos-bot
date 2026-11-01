// Evalua el clasificador de categorias contra los datos REALES, sin escribir
// nada. Responde: ¿el modelo acierta mas que las palabras clave de hoy?
//
// USO
//   DATABASE_URL=... node scripts/evaluar-clasificador.js
//   node scripts/evaluar-clasificador.js --json archivo.json   (sin base)
//
//   El JSON es una lista de { "descripcion": "...", "categoria": "Familia" }
//   en orden cronologico.
//
// QUE HACE
//   1. Toma los gastos (tipo Gasto) en orden de registro.
//   2. Entrena con el 80 % mas viejo y evalua con el 20 % mas nuevo: es lo
//      que pasara en la vida real (el modelo solo conoce el pasado).
//   3. Compara tres formas de elegir la categoria:
//        - reglas:   las palabras clave de src/parser.js (lo de hoy, sin IA)
//        - modelo:   la categoria mas probable, siempre
//        - combinado: el modelo cuando pasa los umbrales, si no las reglas
//                     (es lo que hace el bot)
//   4. Si la tabla clasificacion_feedback ya tiene respuestas, dice que
//      porcentaje de propuestas acepto el usuario, por fuente.
//   5. (Solo con base) LINEA: con los gastos que ya tienen linea, compara la
//      ⭐ de la regla (resolveBudgetLine) contra regla + modelo, aprendiendo
//      en linea como el bot.
//
// OJO CON LA CATEGORIA: casi todas las categorias guardadas las puso el
// parser, no una persona, asi que "reglas" sale favorecida (se compara contra
// si misma). Por eso el bot ya NO entrena la categoria con el historial, solo
// con las respuestas Si/No; esta seccion queda como referencia.
//
// Solo hace SELECT. No toca la tabla de feedback ni las transacciones.

process.env.TZ = process.env.TZ || 'America/Mexico_City'
const fs = require('fs')
const path = require('path')
const { Modelo } = require('../src/clasificador/modelo')
const { MIN_PROBABILIDAD, MIN_COBERTURA } = require('../src/clasificador')
const { parseMessage } = require('../src/parser')

const PORCENTAJE_ENTRENAMIENTO = 0.8

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)} %` : 'n/a'
}

async function cargarDesdeBase() {
  const prisma = require('../src/lib/prisma')
  const txs = await prisma.transaccion.findMany({
    where: { tipo: 'Gasto' },
    select: { id: true, descripcion: true, categoria: { select: { nombre: true, tipo: true } } },
    orderBy: { id: 'asc' },
  })
  let feedback = []
  try {
    feedback = await prisma.clasificacionFeedback.findMany({ select: { fuente: true, estado: true } })
  } catch (error) {
    console.log(`(sin tabla clasificacion_feedback todavia: ${error.code || error.message.trim().split('\n')[0]})`)
  }
  return {
    ejemplos: txs.filter(t => t.categoria?.tipo === 'Gasto').map(t => ({ descripcion: t.descripcion, categoria: t.categoria.nombre })),
    feedback,
  }
}

function cargarDesdeJson(archivo) {
  const datos = JSON.parse(fs.readFileSync(path.resolve(archivo), 'utf8'))
  return { ejemplos: datos.filter(d => d.descripcion && d.categoria), feedback: [] }
}

function evaluar(ejemplos) {
  const corte = Math.floor(ejemplos.length * PORCENTAJE_ENTRENAMIENTO)
  const entrenamiento = ejemplos.slice(0, corte)
  const prueba = ejemplos.slice(corte)

  const modelo = new Modelo()
  for (const e of entrenamiento) modelo.aprender(e.descripcion, e.categoria)

  const res = { total: prueba.length, reglas: 0, modelo: 0, combinado: 0, propuestos: 0, propuestosBien: 0 }
  const errores = new Map()
  const porCategoria = new Map()

  for (const e of prueba) {
    const reglas = parseMessage(e.descripcion, 'eval', null, null).categoria
    const { ranking, cobertura } = modelo.predecir(e.descripcion)
    const top = ranking[0]
    const seguro = top && top.probabilidad >= MIN_PROBABILIDAD && cobertura >= MIN_COBERTURA
    const combinado = seguro ? top.etiqueta : reglas

    if (reglas === e.categoria) res.reglas++
    if (top?.etiqueta === e.categoria) res.modelo++
    if (combinado === e.categoria) res.combinado++
    if (seguro) {
      res.propuestos++
      if (top.etiqueta === e.categoria) res.propuestosBien++
    }

    const c = porCategoria.get(e.categoria) || { n: 0, reglas: 0, combinado: 0 }
    c.n++
    if (reglas === e.categoria) c.reglas++
    if (combinado === e.categoria) c.combinado++
    porCategoria.set(e.categoria, c)

    if (combinado !== e.categoria) {
      const clave = `"${e.descripcion}": dijo ${combinado}, era ${e.categoria}`
      errores.set(clave, (errores.get(clave) || 0) + 1)
    }
  }
  return { res, entrenamiento: entrenamiento.length, porCategoria, errores }
}

// La ⭐ de linea: regla primero y, si no opina, el modelo (lo que hace el bot).
async function evaluarLineas() {
  const prisma = require('../src/lib/prisma')
  const { resolveBudgetLine } = require('../src/budgetTracker')
  const { normalizar } = require('../src/clasificador/modelo')
  const { MIN_PROBABILIDAD_LINEA } = require('../src/clasificador')

  const txs = await prisma.transaccion.findMany({
    where: { presupuestoId: { not: null } },
    select: { id: true, descripcion: true, quincenaId: true, categoriaId: true, tipo: true, presupuesto: { select: { descripcion: true, categoria: { select: { tipo: true } } } } },
    orderBy: { id: 'asc' },
  })
  const lineas = await prisma.presupuesto.findMany({
    where: { estadoLinea: { not: 'Cancelada' } },
    select: { id: true, quincenaId: true, descripcion: true, categoria: { select: { tipo: true } } },
  })
  if (txs.length < 30) return

  const corte = Math.floor(txs.length * 0.6)
  const modelo = new Modelo()
  for (const t of txs.slice(0, corte)) modelo.aprender(t.descripcion, normalizar(t.presupuesto.descripcion))

  let n = 0, reglaOpina = 0, reglaOk = 0, combinadoOk = 0, combinadoOpina = 0
  for (const t of txs.slice(corte)) {
    const verdad = normalizar(t.presupuesto.descripcion)
    const tipo = t.presupuesto.categoria?.tipo
    const candidatas = lineas.filter(l => l.quincenaId === t.quincenaId && l.categoria?.tipo === tipo)
    if (candidatas.length >= 2) {
      n++
      const regla = await resolveBudgetLine({ quincenaId: t.quincenaId, categoriaId: t.categoriaId, descripcion: t.descripcion, tipo })
      let elegida = regla ? normalizar(regla.descripcion) : null
      if (regla) { reglaOpina++; if (elegida === verdad) reglaOk++ }
      if (!elegida) {
        const { ranking, cobertura } = modelo.predecir(t.descripcion, new Set(candidatas.map(c => normalizar(c.descripcion))))
        const top = ranking[0]
        if (top && top.probabilidad >= MIN_PROBABILIDAD_LINEA && cobertura >= MIN_COBERTURA) elegida = top.etiqueta
      }
      if (elegida) { combinadoOpina++; if (elegida === verdad) combinadoOk++ }
    }
    modelo.aprender(t.descripcion, verdad)
  }

  console.log(`\nLINEA (${n} gastos mas nuevos con linea, aprendiendo en linea)`)
  console.log(`  ⭐ correcta, solo la regla (antes):  ${pct(reglaOk, n)}  (opina en ${pct(reglaOpina, n)}, acierta ${pct(reglaOk, reglaOpina)})`)
  console.log(`  ⭐ correcta, regla + modelo (bot):   ${pct(combinadoOk, n)}  (opina en ${pct(combinadoOpina, n)}, acierta ${pct(combinadoOk, combinadoOpina)})`)
}

async function main() {
  const i = process.argv.indexOf('--json')
  const { ejemplos, feedback } = i > -1 ? cargarDesdeJson(process.argv[i + 1]) : await cargarDesdeBase()

  if (ejemplos.length < 30) {
    console.log(`Solo hay ${ejemplos.length} gastos: muy pocos para evaluar.`)
    return
  }

  const { res, entrenamiento, porCategoria, errores } = evaluar(ejemplos)
  console.log(`\nGastos: ${ejemplos.length}  (entrenamiento ${entrenamiento}, prueba ${res.total} -- los mas nuevos)`)
  console.log(`Umbrales: probabilidad >= ${MIN_PROBABILIDAD}, cobertura >= ${MIN_COBERTURA}\n`)
  console.log(`Aciertos con reglas (hoy):        ${pct(res.reglas, res.total)}`)
  console.log(`Aciertos con el modelo (siempre): ${pct(res.modelo, res.total)}`)
  console.log(`Aciertos combinado (lo del bot):  ${pct(res.combinado, res.total)}`)
  console.log(`  el modelo se animo a proponer en ${pct(res.propuestos, res.total)} de los casos, y ahi acerto ${pct(res.propuestosBien, res.propuestos)}`)

  console.log('\nPor categoria (reglas -> combinado):')
  for (const [cat, c] of [...porCategoria].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${cat.padEnd(14)} n=${String(c.n).padStart(4)}   ${pct(c.reglas, c.n).padStart(8)} -> ${pct(c.combinado, c.n).padStart(8)}`)
  }

  const peores = [...errores].sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (peores.length) {
    console.log('\nErrores mas comunes del combinado:')
    for (const [e, n] of peores) console.log(`  ${n}x ${e}`)
  }

  if (feedback.length) {
    console.log('\nRespuestas en Telegram (clasificacion_feedback):')
    for (const fuente of ['modelo', 'reglas']) {
      const de = feedback.filter(f => f.fuente === fuente)
      const resueltas = de.filter(f => f.estado !== 'pendiente')
      const aceptadas = de.filter(f => f.estado === 'aceptada')
      console.log(`  ${fuente.padEnd(7)} propuestas=${de.length}; contestadas=${resueltas.length}; aceptadas=${pct(aceptadas.length, resueltas.length)}`)
    }
  }

  if (i === -1) {
    await evaluarLineas()
    await require('../src/lib/prisma').$disconnect?.()
  }
}

main().catch(error => {
  console.error('Fallo la evaluacion:', error.message)
  process.exit(1)
})
