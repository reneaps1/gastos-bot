// Pruebas del agente de herramientas (src/financeAgent.js + src/miloTools.js),
// que es la pieza que traduce una pregunta libre en consultas.
//
// Sin red ni Postgres: el proveedor y Prisma son dobles. El doble de Prisma
// calcula los agregados de verdad, porque el defecto que estas pruebas vigilan
// es justo que los totales salieran de la pagina devuelta en vez del filtro
// completo.
//
// Que se prueba y por que:
//   1. search_transactions puede ordenar por monto. Antes solo ordenaba por
//      fecha y cortaba a 20, asi que "cual es el gasto mas alto" solo miraba
//      los ultimos 20 movimientos y el mas alto podia no estar ahi.
//   2. Los totales cubren todo el filtro, no la pagina. Si no, el agente
//      reporta como total la suma de los 20 que le tocaron.
//   3. El agente sobrevive a que un proveedor falle. Antes hablaba solo con
//      DeepSeek y devolvia null al primer error, y Milo caia al catalogo de
//      seis intents fijos sin que nada lo avisara.

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'

const path = require('path')
const Module = require('module')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

// --- Datos de la quincena de prueba ---------------------------------------
const CATEGORIAS = [
  { id: 1, nombre: 'Hogar', tipo: 'Gasto' },
  { id: 2, nombre: 'Familia', tipo: 'Gasto' },
]
const QUINCENA = { id: 35, codigo: 'Q35', fechaInicio: new Date('2026-09-15'), fechaFin: new Date('2026-09-29') }
const TXS = [
  { id: 1, monto: 2850.40, descripcion: 'Super quincenal',  categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-16') },
  { id: 2, monto: 12000.00, descripcion: 'Renta septiembre', categoriaId: 1, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-17') },
  { id: 3, monto: 900.00, descripcion: 'Gasolina',         categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-18') },
  { id: 4, monto: 640.25, descripcion: 'Cena',             categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-19') },
]

function conRelaciones(tx) {
  return {
    ...tx,
    categoria: CATEGORIAS.find(c => c.id === tx.categoriaId),
    quincena: QUINCENA,
    user: null,
    metodoPago: null,
    presupuesto: null,
  }
}

function ordenar(lista, orderBy) {
  const campo = Object.keys(orderBy[0])[0]
  const dir = orderBy[0][campo]
  return [...lista].sort((a, b) => {
    const va = campo === 'fecha' ? a.fecha.getTime() : Number(a[campo])
    const vb = campo === 'fecha' ? b.fecha.getTime() : Number(b[campo])
    return dir === 'desc' ? vb - va : va - vb
  })
}

const prismaDoble = {
  quincena: {
    findFirst: async () => QUINCENA,
    findUnique: async () => QUINCENA,
    findMany: async () => [QUINCENA],
  },
  categoria: {
    findMany: async () => CATEGORIAS.map(c => ({ id: c.id, nombre: c.nombre })),
  },
  transaccion: {
    findMany: async ({ orderBy, take } = {}) =>
      ordenar(TXS, orderBy).slice(0, take ?? TXS.length).map(conRelaciones),
    aggregate: async () => ({
      _sum: { monto: TXS.reduce((s, t) => s + t.monto, 0) },
      _count: { _all: TXS.length },
      _max: { monto: Math.max(...TXS.map(t => t.monto)) },
      _min: { monto: Math.min(...TXS.map(t => t.monto)) },
      _avg: { monto: TXS.reduce((s, t) => s + t.monto, 0) / TXS.length },
    }),
    groupBy: async () => {
      const porCat = new Map()
      for (const t of TXS) {
        const acc = porCat.get(t.categoriaId) ?? { monto: 0, n: 0 }
        acc.monto += t.monto; acc.n += 1
        porCat.set(t.categoriaId, acc)
      }
      return [...porCat].map(([categoriaId, v]) => ({ categoriaId, _sum: { monto: v.monto }, _count: { _all: v.n } }))
    },
  },
}

// --- Dobles de proveedor ---------------------------------------------------
// financeAgent captura los modulos al cargarse, asi que el objeto que ve tiene
// que ser siempre el mismo: lo que cambia entre casos es `impl`, y el doble
// delega en el.
const impl = {
  deepseek: { isEnabled: () => false, complete: async () => null },
  gemini: { isEnabled: () => false, complete: async () => null },
}
const proveedorDeepseek = { isEnabled: () => impl.deepseek.isEnabled(), complete: (...a) => impl.deepseek.complete(...a) }
const proveedorGemini = { isEnabled: () => impl.gemini.isEnabled(), complete: (...a) => impl.gemini.complete(...a) }

const requireOriginal = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === './lib/prisma' || id === '../lib/prisma') return prismaDoble
  if (id === './deepseek') return proveedorDeepseek
  if (id === './gemini') return proveedorGemini
  return requireOriginal.apply(this, arguments)
}

const { executeTool } = require(path.join(SRC, 'miloTools'))
const { answer } = require(path.join(SRC, 'financeAgent'))

// Un proveedor que pide el gasto mas alto y luego responde con lo que recibio.
function proveedorQueConsulta(nombre) {
  return {
    isEnabled: () => true,
    complete: async (messages) => {
      const ultimo = messages[messages.length - 1].content
      if (ultimo.includes('TOOL_RESULT')) {
        const json = ultimo.split('TOOL_RESULT search_transactions:\n')[1].split('\n\nContinúa')[0]
        const datos = JSON.parse(json)
        const top = datos.transactions[0]
        return JSON.stringify({ action: 'answer', answer: `El más alto de ${datos.period} fue ${top.description}: $${top.amount}. Total del periodo: $${datos.totals.sum}.` })
      }
      return JSON.stringify({ action: 'tool', tool: 'search_transactions', args: { period: 'current', type: 'Gasto', sort: 'amount_desc', limit: 1 } })
    },
  }
}

async function main() {
  console.log('=== A: search_transactions ordena por monto ===')
  const masAlto = await executeTool('search_transactions', { period: 'current', type: 'Gasto', sort: 'amount_desc', limit: 1 })
  check('devuelve el gasto mas alto, no el mas reciente',
    masAlto.transactions[0]?.description === 'Renta septiembre', masAlto.transactions[0]?.description)
  check('con limit=1 devuelve una sola fila', masAlto.count === 1, masAlto.count)

  const masBajo = await executeTool('search_transactions', { period: 'current', type: 'Gasto', sort: 'amount_asc', limit: 1 })
  check('amount_asc devuelve el mas bajo',
    masBajo.transactions[0]?.description === 'Cena', masBajo.transactions[0]?.description)

  const recientes = await executeTool('search_transactions', { period: 'current', type: 'Gasto', limit: 1 })
  check('sin sort sigue ordenando por fecha (no cambia lo de antes)',
    recientes.transactions[0]?.description === 'Cena', recientes.transactions[0]?.description)

  console.log('\n=== B: los totales cubren el filtro completo, no la pagina ===')
  check('sum es el de los 4 movimientos aunque solo devuelva 1',
    Math.abs(masAlto.totals.sum - 16390.65) < 0.005, masAlto.totals.sum)
  check('count es 4, no 1', masAlto.totals.count === 4, masAlto.totals.count)
  check('max = 12000', masAlto.totals.max === 12000, masAlto.totals.max)
  check('min = 640.25', masAlto.totals.min === 640.25, masAlto.totals.min)
  check('avisa que hubo truncamiento', masAlto.truncated === true, masAlto.truncated)
  check('byCategory viene ordenado de mayor a menor',
    masAlto.totals.byCategory[0].total >= masAlto.totals.byCategory[1].total,
    JSON.stringify(masAlto.totals.byCategory))

  console.log('\n=== C: el agente traduce la pregunta en una consulta ===')
  impl.deepseek = proveedorQueConsulta('deepseek')
  impl.gemini = { isEnabled: () => false, complete: async () => null }
  const r1 = await answer('cual es el gasto mas alto de esta Q?', { senderName: 'Rene' })
  check('responde con el gasto correcto', r1?.reply?.includes('Renta septiembre'), r1?.reply)
  check('uso search_transactions', r1?.trace?.[0]?.tool === 'search_transactions', JSON.stringify(r1?.trace))
  check('reporta el proveedor que respondio', r1?.provider === 'deepseek-agent', r1?.provider)

  console.log('\n=== D: si un proveedor falla, el agente no se apaga ===')
  impl.deepseek = { isEnabled: () => true, complete: async () => null }  // simula DEEPSEEK_MODEL invalido
  impl.gemini = proveedorQueConsulta('gemini')
  const r2 = await answer('cual es el gasto mas alto de esta Q?', { senderName: 'Rene' })
  check('Gemini toma el relevo y contesta', r2?.reply?.includes('Renta septiembre'), r2?.reply)
  check('lo reporta como gemini-agent', r2?.provider === 'gemini-agent', r2?.provider)

  console.log('\n=== E: sin ningun proveedor, devuelve null sin tronar ===')
  impl.deepseek = { isEnabled: () => false, complete: async () => null }
  impl.gemini = { isEnabled: () => false, complete: async () => null }
  const r3 = await answer('cual es el gasto mas alto?', { senderName: 'Rene' })
  check('devuelve null', r3 === null, JSON.stringify(r3))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
