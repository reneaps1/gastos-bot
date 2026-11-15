// Acciones de presupuesto de Milo (src/miloAccionesPresupuesto.js): crear,
// ajustar, cancelar, traspasar y mover lineas. Sin red ni Postgres.
//
// Que se fija y por que:
//   1. Proponer NUNCA escribe; el resumen dice exactamente que va a pasar.
//   2. Cada accion va por la ruta del dashboard que ya usa la pantalla de
//      Presupuesto, con el body que esa ruta espera.
//   3. "De aqui en adelante" en una serie manda la recurrencia actual: sin
//      recurrente:true la ruta BORRA las futuras y deja de repetir la linea.
//   4. Cancelar una linea con movimientos se frena antes (la base lo bloquea).
//   5. Un traspaso no deja al origen con menos de lo que ya gasto, y solo va
//      dentro de la misma quincena.
//   6. Si la linea cambio desde la propuesta no se ejecuta; un reintento de
//      algo que ya se aplico no se duplica.

process.env.TZ = 'America/Mexico_City'
delete process.env.ANTHROPIC_API_KEY
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const Q39 = { id: 39, codigo: 'Q39', fechaInicio: new Date('2026-11-01T00:00:00Z'), fechaFin: new Date('2026-11-15T00:00:00Z') }
const Q40 = { id: 40, codigo: 'Q40', fechaInicio: new Date('2026-11-16T00:00:00Z'), fechaFin: new Date('2026-11-30T00:00:00Z') }
const QUINCENAS = { actual: Q39, siguiente: Q40, q39: Q39, q40: Q40 }
const CATEGORIAS = [
  { id: 1, nombre: 'Hogar', tipo: 'Gasto', activo: true },
  { id: 3, nombre: 'Familia', tipo: 'Gasto', activo: true },
  { id: 6, nombre: 'Deudas', tipo: 'Gasto', activo: true },
]
const cat = id => CATEGORIAS.find(c => c.id === id)

let serieConGasto = 0
let lineas = []
let gastado = {}
function reiniciar() {
  lineas = [
    { id: 10, quincenaId: 39, descripcion: 'Renta', categoriaId: 1, montoPresupuestado: 10500, montoRevisado: null, estadoLinea: 'Abierta', clasificacion: 'Fijo', recurrenciaGrupoId: 'g-renta', recurrente: true, frecuencia: 'MENSUAL', diaCobro: 1, numOcurrencias: null, fechaVencimiento: null, fechaRegistro: new Date('2026-10-01') },
    { id: 11, quincenaId: 39, descripcion: 'Super', categoriaId: 3, montoPresupuestado: 3000, montoRevisado: 2500, estadoLinea: 'Abierta', clasificacion: 'Variable', recurrenciaGrupoId: null, recurrente: false, frecuencia: null, diaCobro: null, numOcurrencias: null, fechaVencimiento: null, fechaRegistro: new Date('2026-10-01') },
    { id: 12, quincenaId: 39, descripcion: 'Tanda', categoriaId: 6, montoPresupuestado: 1000, montoRevisado: null, estadoLinea: 'Abierta', clasificacion: null, recurrenciaGrupoId: null, recurrente: false, frecuencia: null, diaCobro: null, numOcurrencias: null, fechaVencimiento: null, fechaRegistro: new Date('2026-10-01') },
    { id: 13, quincenaId: 40, descripcion: 'Super', categoriaId: 3, montoPresupuestado: 3000, montoRevisado: null, estadoLinea: 'Abierta', clasificacion: 'Variable', recurrenciaGrupoId: null, recurrente: false, frecuencia: null, diaCobro: null, numOcurrencias: null, fechaVencimiento: null, fechaRegistro: new Date('2026-10-01') },
  ]
  gastado = { 11: 1800, 12: 0, 10: 0 }
}
reiniciar()
const conRelaciones = l => l && ({ ...l, categoria: cat(l.categoriaId), quincena: l.quincenaId === 39 ? Q39 : Q40 })

const acciones = []
let nextAccion = 1
const fakePrisma = {
  presupuesto: {
    findUnique: async ({ where }) => conRelaciones(lineas.find(l => l.id === where.id)) || null,
    findMany: async ({ where }) => lineas.filter(l => l.quincenaId === where.quincenaId && l.estadoLinea !== 'Cancelada').map(conRelaciones),
    findFirst: async ({ where }) => {
      const r = lineas.find(l =>
        (where.quincenaId == null || l.quincenaId === where.quincenaId) &&
        (where.categoriaId == null || l.categoriaId === where.categoriaId) &&
        (where.recurrenciaGrupoId == null || l.recurrenciaGrupoId === where.recurrenciaGrupoId) &&
        (where.descripcion == null || (typeof where.descripcion === 'string' ? l.descripcion === where.descripcion : l.descripcion.toLowerCase() === where.descripcion.equals.toLowerCase())) &&
        (!where.estadoLinea?.not || l.estadoLinea !== where.estadoLinea.not) &&
        (!where.fechaRegistro?.gte || l.fechaRegistro >= where.fechaRegistro.gte))
      return r || null
    },
  },
  transaccion: {
    aggregate: async ({ where }) => ({ _sum: { monto: gastado[where.presupuestoId] || 0 } }),
    // Con `presupuesto.recurrenciaGrupoId` cuenta los movimientos de toda la serie.
    count: async ({ where }) => where.presupuesto ? serieConGasto : (gastado[where.presupuestoId] > 0 ? 2 : 0),
  },
  categoria: { findMany: async () => CATEGORIAS },
  miloAccion: {
    create: async ({ data }) => { const f = { id: nextAccion++, estado: 'pendiente', resultado: null, createdAt: new Date(), ...data }; acciones.push(f); return f },
    findUnique: async ({ where }) => acciones.find(a => a.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      const filas = acciones.filter(a => a.id === where.id && (!where.chatId || a.chatId === where.chatId) &&
        (where.estado?.in ? where.estado.in.includes(a.estado) : typeof where.estado === 'string' ? a.estado === where.estado : true) &&
        (!where.expiraEn?.gt || a.expiraEn > where.expiraEn.gt))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
    update: async ({ where, data }) => Object.assign(acciones.find(a => a.id === where.id), data),
  },
}

const llamadas = []
let aplicar = null
const fakeDashboardApi = {
  isEnabled: () => true,
  DashboardApiError: Error,
  llamar: async (metodo, ruta, opts = {}) => {
    llamadas.push({ metodo, ruta, ...opts })
    if (aplicar) aplicar(metodo, ruta, opts)
    return { id: 99, count: 1 }
  },
}
const fakeMiloTools = { resolvePeriod: async p => QUINCENAS[String(p || 'actual').toLowerCase()] || null }
for (const [rel, exports] of [['lib/prisma.js', fakePrisma], ['dashboardApi.js', fakeDashboardApi], ['miloTools.js', fakeMiloTools]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const miloAcciones = require(path.join(SRC, 'miloAcciones.js'))
const CTX = { chatId: '8946880241', userId: 1, solicitante: 'Rene' }
const confirmar = id => miloAcciones.confirmar({ accionId: id, chatId: CTX.chatId, actor: 'Rene' })
const ultima = () => llamadas.at(-1)

async function main() {
  console.log('=== 1: crear linea ===')
  const c1 = await miloAcciones.proponer('presupuesto.crear', { description: 'Colegiatura', amount: '1,300', category: 'Familia', period: 'siguiente', classification: 'fijo' }, CTX)
  check('propone sin escribir', c1.ok && llamadas.length === 0, JSON.stringify(c1))
  check('el resumen dice quincena, categoria y monto', /Colegiatura — \$1,300\.00/.test(c1.resumen) && /Q40/.test(c1.resumen) && /Familia/.test(c1.resumen), c1.resumen)
  await confirmar(c1.accionId)
  check('POST /api/presupuestos con el body de la pantalla', ultima().metodo === 'POST' && ultima().ruta === '/api/presupuestos' &&
    ultima().body.quincenaId === 40 && ultima().body.categoriaId === 3 && ultima().body.montoPresupuestado === 1300 && ultima().body.clasificacion === 'Fijo' && ultima().body.recurrente === false, JSON.stringify(ultima().body))
  const c2 = await miloAcciones.proponer('presupuesto.crear', { description: 'Netflix', amount: 299, category: 'Hogar', recurrent: true, frequency: 'mensual', occurrences: 6, payDay: 12 }, CTX)
  check('recurrente: el resumen lo dice', /cada mes, 6 veces, el día 12/.test(c2.resumen), c2.resumen)
  const dup = await miloAcciones.proponer('presupuesto.crear', { description: 'super', amount: 100, category: 'Familia' }, CTX)
  check('avisa si ya existe una igual', /ya existe "Super"/.test(dup.resumen), dup.resumen)
  const malo = await miloAcciones.proponer('presupuesto.crear', { description: 'X', amount: 10, category: 'Familia', frequency: 'diaria', recurrent: true }, CTX)
  check('frecuencia invalida -> error', !malo.ok && /quincenal o mensual/.test(malo.error))

  console.log('\n=== 2: ajustar ===')
  const a1 = await miloAcciones.proponer('presupuesto.ajustar', { line: 'super', amount: 2000 }, CTX)
  check('busca por nombre en la quincena actual', a1.ok && /Super \(Familia, Q39\)/.test(a1.resumen), a1.error || a1.resumen)
  check('dice el vigente de antes y despues, y que el original queda', /\$2,500\.00 → \$2,000\.00/.test(a1.resumen) && /original de \$3,000\.00/.test(a1.resumen), a1.resumen)
  const a2 = await miloAcciones.proponer('presupuesto.ajustar', { id: 11, amount: 1000 }, CTX)
  check('bajar debajo de lo gastado: se permite con aviso (como el dashboard)', a2.ok && /excedida por \$800\.00/.test(a2.resumen), a2.resumen)
  await confirmar(a1.accionId)
  check('PUT con montoRevisado, motivo y scope single', ultima().metodo === 'PUT' && ultima().ruta === '/api/presupuestos/11' &&
    ultima().body.montoRevisado === 2000 && ultima().body.scope === 'single' && /Milo/.test(ultima().body.motivoCambio), JSON.stringify(ultima().body))

  const serie = await miloAcciones.proponer('presupuesto.ajustar', { line: 'renta', amount: 11000, scope: 'en adelante' }, CTX)
  await confirmar(serie.accionId)
  const b = ultima().body
  check('serie "en adelante": manda recurrente:true y la frecuencia actual (si no, la ruta borra las futuras)',
    b.scope === 'this_forward' && b.recurrente === true && b.frecuencia === 'MENSUAL' && b.diaCobro === 1, JSON.stringify(b))
  const soloEsta = await miloAcciones.proponer('presupuesto.ajustar', { line: 'renta', amount: 11000 }, CTX)
  check('serie sin scope: solo esta, y el resumen lo aclara', /Solo esta quincena/.test(soloEsta.resumen), soloEsta.resumen)

  const vieja = await miloAcciones.proponer('presupuesto.ajustar', { id: 12, amount: 1200 }, CTX)
  lineas.find(l => l.id === 12).montoRevisado = 900
  const r = await confirmar(vieja.accionId)
  check('si la linea cambio desde la propuesta, no se ejecuta', !r.ok && /cambió/.test(r.texto) && ultima().ruta !== '/api/presupuestos/12', r.texto)
  reiniciar()

  console.log('\n=== 3: cancelar ===')
  const k1 = await miloAcciones.proponer('presupuesto.cancelar', { line: 'super' }, CTX)
  check('con movimientos: no propone y dice la salida', !k1.ok && /2 movimiento/.test(k1.error) && /budgetLine/.test(k1.error), k1.error)
  const k2 = await miloAcciones.proponer('presupuesto.cancelar', { line: 'tanda' }, CTX)
  check('sin movimientos: propone y aclara que no se borra', k2.ok && /queda como Cancelada/.test(k2.resumen))
  await confirmar(k2.accionId)
  check('DELETE de una sola linea', ultima().metodo === 'DELETE' && ultima().ruta === '/api/presupuestos/12')
  const k3 = await miloAcciones.proponer('presupuesto.cancelar', { line: 'renta', scope: 'futuras' }, CTX)
  await confirmar(k3.accionId)
  check('serie, futuras: DELETE con grupoId y scope=future', ultima().ruta === '/api/presupuestos/10?grupoId=g-renta&scope=future', ultima().ruta)
  const k4 = await miloAcciones.proponer('presupuesto.cancelar', { line: 'renta', scope: 'toda la serie' }, CTX)
  await confirmar(k4.accionId)
  check('serie completa: DELETE con grupoId', ultima().ruta === '/api/presupuestos/10?grupoId=g-renta', ultima().ruta)
  serieConGasto = 3
  const k5 = await miloAcciones.proponer('presupuesto.cancelar', { line: 'renta', scope: 'toda la serie' }, CTX)
  check('serie con movimientos en alguna ocurrencia: no propone', !k5.ok && /3 movimiento/.test(k5.error), k5.error)
  serieConGasto = 0

  console.log('\n=== 4: traspaso ===')
  const t1 = await miloAcciones.proponer('presupuesto.traspasar', { amount: 500, from: 'super', to: 'tanda' }, CTX)
  check('dice los montos de origen y destino', t1.ok && /Super — \$2,500\.00 → \$2,000\.00/.test(t1.resumen) && /Tanda — \$1,000\.00 → \$1,500\.00/.test(t1.resumen), t1.error || t1.resumen)
  const t2 = await miloAcciones.proponer('presupuesto.traspasar', { amount: 800, from: 'super', to: 'tanda' }, CTX)
  check('no deja al origen con menos de lo gastado (2500 - 1800 = 700)', !t2.ok && /\$700\.00 sin gastar/.test(t2.error), t2.error)
  const t3 = await miloAcciones.proponer('presupuesto.traspasar', { amount: 100, toId: 13, fromId: 11 }, CTX)
  check('solo dentro de la misma quincena', !t3.ok && /MISMA quincena/.test(t3.error), t3.error)
  const t4 = await miloAcciones.proponer('presupuesto.traspasar', { amount: 300, to: 'tanda' }, CTX)
  check('sin origen: desde lo sin asignar', t4.ok && /sin asignar/.test(t4.resumen))
  await confirmar(t1.accionId)
  check('POST transferir al destino con origenId y monto', ultima().ruta === '/api/presupuestos/12/transferir' && ultima().body.origenId === 11 && ultima().body.monto === 500, JSON.stringify(ultima()))
  await confirmar(t4.accionId)
  check('desde sin asignar: sin origenId', ultima().ruta === '/api/presupuestos/12/transferir' && !('origenId' in ultima().body), JSON.stringify(ultima().body))

  // Reintento: el primer intento si se aplico pero la respuesta se perdio.
  const t5 = await miloAcciones.proponer('presupuesto.traspasar', { amount: 200, from: 'super', to: 'tanda' }, CTX)
  aplicar = (metodo, ruta) => {
    if (ruta.endsWith('/transferir')) {
      lineas.find(l => l.id === 12).montoRevisado = 1200
      lineas.find(l => l.id === 11).montoRevisado = 2300
      aplicar = null
      throw new Error('El dashboard no contestó en 90 s.')
    }
  }
  const f1 = await confirmar(t5.accionId)
  const antes = llamadas.length
  const f2 = await confirmar(t5.accionId)
  check('reintento de un traspaso que SI se guardo: no lo repite', !f1.ok && f2.ok && /ya estaba hecho/.test(f2.texto) && llamadas.length === antes, `${f1.texto} | ${f2.texto}`)
  reiniciar()

  console.log('\n=== 5: mover de quincena ===')
  const m1 = await miloAcciones.proponer('presupuesto.mover', { line: 'tanda', toPeriod: 'siguiente' }, CTX)
  check('propone mover Q39 -> Q40', m1.ok && /De Q39 a Q40/.test(m1.resumen), m1.error || m1.resumen)
  await confirmar(m1.accionId)
  check('PUT con quincenaId destino y scope single', ultima().ruta === '/api/presupuestos/12' && ultima().body.quincenaId === 40 && ultima().body.scope === 'single')
  const m2 = await miloAcciones.proponer('presupuesto.mover', { line: 'super', toPeriod: 'siguiente' }, CTX)
  check('con gasto registrado no se mueve', !m2.ok && /movimiento/.test(m2.error), m2.error)
  const m3 = await miloAcciones.proponer('presupuesto.mover', { line: 'tanda' }, CTX)
  check('sin destino -> pide toPeriod', !m3.ok && /toPeriod/.test(m3.error))

  console.log('\n=== 6: el agente las ve en Telegram y en la web ===')
  delete require.cache[require.resolve(path.join(SRC, 'miloTools.js'))]
  const { getToolDefinitions } = require(path.join(SRC, 'miloTools.js'))
  const nombres = getToolDefinitions({ acciones: true }).map(d => d.name)
  check('las 5 herramientas de presupuesto existen con acciones', ['proponer_crear_linea', 'proponer_ajustar_linea', 'proponer_cancelar_linea', 'proponer_traspaso', 'proponer_mover_linea'].every(n => nombres.includes(n)), nombres.join(','))
  check('sin acciones (WhatsApp) no existen', !getToolDefinitions({}).some(d => d.name === 'proponer_traspaso'))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
}

main().catch(error => {
  console.error('El harness truono:', error)
  process.exit(1)
})
