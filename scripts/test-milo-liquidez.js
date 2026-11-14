// Pruebas de las acciones de liquidez de Milo (src/miloAcciones.js):
// liquidez.registrar, liquidez.editar y liquidez.borrar.
//
// Sin red ni Postgres: Prisma y la API del dashboard son dobles.
//
// Que se prueba y por que:
//   1. Proponer NUNCA escribe: solo deja la fila pendiente. El corte se guarda
//      con el toque de Confirmar, y con la ruta del dashboard que ya existe.
//   2. Un corte lleva TODAS las cuentas activas. Si faltan, la herramienta lo
//      dice con nombres, para que el agente pregunte en vez de inventar.
//   3. "Las demas igual que el corte pasado" hereda los saldos, y se ve en el
//      resumen cuales se heredaron.
//   4. Un saldo de 0 es valido (el "0" del 2026-11-14).
//   5. Corregir manda el corte COMPLETO al dashboard (la ruta reemplaza todas
//      las lineas), no solo la cuenta que cambio.
//   6. Si el corte cambio desde la propuesta, no se ejecuta.
//   7. El agente solo ve estas herramientas con `acciones` (Telegram y web).

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

const { fechaMexico } = require(path.join(SRC, 'financeUtils'))
const HOY = fechaMexico()
const dia = n => { const d = new Date(`${HOY}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d }
const QUINCENA = { id: 39, codigo: 'Q39', fechaInicio: dia(-5), fechaFin: dia(9) }

const CUENTAS = [
  { id: 1, nombre: 'BBVA', tipo: 'Debito', activo: true, orden: 1 },
  { id: 2, nombre: 'Banamex', tipo: 'Debito', activo: true, orden: 2 },
  { id: 3, nombre: 'Efectivo', tipo: 'Efectivo', activo: true, orden: 3 },
  { id: 4, nombre: 'Vales Despensa', tipo: 'Vales', activo: true, orden: 4 },
  { id: 9, nombre: 'Cuenta vieja', tipo: 'Debito', activo: false, orden: 9 },
]
const conCuenta = montos => montos.map(m => ({ ...m, cuenta: CUENTAS.find(c => c.id === m.cuentaId) }))
let cortes = []
function corteViejo() {
  return {
    id: 12, fechaCorte: dia(-6), fechaRegistro: dia(-6), quincenaId: 38, validado: false, notas: null,
    quincena: { id: 38, codigo: 'Q38' },
    montos: conCuenta([
      { cuentaId: 1, monto: 0, nota: null },
      { cuentaId: 2, monto: 4690.34, nota: null },
      { cuentaId: 3, monto: 1783.5, nota: null },
      { cuentaId: 4, monto: 86, nota: null },
    ]),
  }
}

const acciones = []
let nextAccion = 1
const fakePrisma = {
  cuenta: { findMany: async ({ where } = {}) => CUENTAS.filter(c => (where?.activo ? c.activo : true)).sort((a, b) => a.orden - b.orden) },
  quincena: {
    findFirst: async ({ where }) => {
      const d = where.fechaInicio.lte.getTime()
      return QUINCENA.fechaInicio.getTime() <= d && QUINCENA.fechaFin.getTime() >= d ? QUINCENA : null
    },
  },
  liquidezSnapshot: {
    findFirst: async () => [...cortes].sort((a, b) => b.fechaCorte - a.fechaCorte)[0] || null,
    findUnique: async ({ where }) => cortes.find(c => c.id === where.id) || null,
    findMany: async ({ take }) => [...cortes].sort((a, b) => b.fechaCorte - a.fechaCorte).slice(0, take),
  },
  miloAccion: {
    create: async ({ data }) => { const f = { id: nextAccion++, estado: 'pendiente', resultado: null, ...data }; acciones.push(f); return f },
    findUnique: async ({ where }) => acciones.find(a => a.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      const filas = acciones.filter(a => a.id === where.id && (!where.chatId || a.chatId === where.chatId) &&
        (!where.estado?.in || where.estado.in.includes(a.estado)) && (!where.expiraEn?.gt || a.expiraEn > where.expiraEn.gt))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
    update: async ({ where, data }) => Object.assign(acciones.find(a => a.id === where.id), data),
  },
}
const llamadas = []
const fakeDashboardApi = {
  isEnabled: () => true,
  DashboardApiError: Error,
  llamar: async (metodo, ruta, opts = {}) => { llamadas.push({ metodo, ruta, ...opts }); return { id: 77 } },
}
for (const [rel, exports] of [['lib/prisma.js', fakePrisma], ['dashboardApi.js', fakeDashboardApi]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const miloAcciones = require(path.join(SRC, 'miloAcciones.js'))
const { executeTool, getToolDefinitions } = require(path.join(SRC, 'miloTools.js'))
const CTX = { chatId: '8946880241', userId: 1, solicitante: 'Rene' }
const TODAS = [
  { account: 'BBVA', amount: 0 },
  { account: 'banamex', amount: '4,690.34' },
  { account: 'efectivo', amount: 1500 },
  { account: 'vales', amount: '86' },
]

async function main() {
  console.log('\n=== L1: proponer un corte NO escribe; Confirmar lo guarda una vez ===')
  cortes = [corteViejo()]
  const p1 = await miloAcciones.proponer('liquidez.registrar', { balances: TODAS }, CTX)
  check('queda pendiente', p1.ok && acciones.at(-1).estado === 'pendiente', JSON.stringify(p1))
  check('sin llamadas al dashboard todavia', llamadas.length === 0, llamadas.length)
  check('el resumen trae cada cuenta y el total', /BBVA — \$0\.00/.test(p1.resumen) && /Banamex — \$4,690\.34/.test(p1.resumen) && /Total en cuentas: \$6,276\.34/.test(p1.resumen), p1.resumen)
  check('y la quincena de la fecha', p1.resumen.includes('(Q39)'), p1.resumen)
  check('compara con el corte anterior', /Corte anterior .*\$6,559\.84/.test(p1.resumen), p1.resumen)
  const c1 = await miloAcciones.confirmar({ accionId: p1.accionId, chatId: CTX.chatId, actor: 'milo:Rene' })
  check('Confirmar hace POST /api/liquidez', c1.ok && llamadas.length === 1 && llamadas[0].metodo === 'POST' && llamadas[0].ruta === '/api/liquidez', JSON.stringify(llamadas))
  const body1 = llamadas[0].body
  check('con la fecha de hoy, la quincena y las 4 cuentas activas', body1.fechaCorte === HOY && body1.quincenaId === 39 && body1.montos.length === 4 && body1.validado === false, JSON.stringify(body1))
  check('el saldo 0 viaja como 0', body1.montos.find(m => m.cuentaId === 1).monto === 0)
  check('no manda faltaPagar ni teorico (los calcula el dashboard)', !('faltaPagar' in body1) && !('teorico' in body1))
  check('el actor es quien toco el boton', llamadas[0].actor === 'milo:Rene', llamadas[0].actor)
  const c1b = await miloAcciones.confirmar({ accionId: p1.accionId, chatId: CTX.chatId })
  check('un segundo toque no guarda otro corte', !c1b.ok && llamadas.length === 1, c1b.texto)

  console.log('\n=== L2: si faltan cuentas lo dice con nombres ===')
  const p2 = await miloAcciones.proponer('liquidez.registrar', { balances: [{ account: 'BBVA', amount: 0 }] }, CTX)
  check('no propone', !p2.ok, JSON.stringify(p2))
  check('nombra las que faltan', /Banamex/.test(p2.error) && /Efectivo/.test(p2.error) && /Vales Despensa/.test(p2.error), p2.error)
  check('no pide la cuenta inactiva', !/Cuenta vieja/.test(p2.error), p2.error)
  const p2b = await miloAcciones.proponer('liquidez.registrar', { balances: [{ account: 'Santander', amount: 10 }] }, CTX)
  check('una cuenta que no existe -> error con las opciones', !p2b.ok && /BBVA/.test(p2b.error), p2b.error)
  const p2c = await miloAcciones.proponer('liquidez.registrar', { balances: [{ account: 'BBVA', amount: 'no se' }] }, CTX)
  check('un saldo que no es numero -> pregunta', !p2c.ok && /saldo de BBVA/.test(p2c.error), p2c.error)
  const p2d = await miloAcciones.proponer('liquidez.registrar', { balances: TODAS, date: '2099-01-01' }, CTX)
  check('fecha futura -> no', !p2d.ok && /futura/.test(p2d.error), p2d.error)

  console.log('\n=== L3: "las demas igual que el corte pasado" ===')
  const p3 = await miloAcciones.proponer('liquidez.registrar', { balances: { BBVA: 250 }, others: 'previous' }, CTX)
  const pay3 = acciones.at(-1).payload
  check('propone', p3.ok, JSON.stringify(p3))
  check('hereda los saldos del corte anterior', pay3.montos.find(m => m.cuentaId === 2).monto === 4690.34 && pay3.montos.find(m => m.cuentaId === 3).monto === 1783.5, JSON.stringify(pay3.montos))
  check('y el resumen dice cuales se heredaron', /Banamex — \$4,690\.34 \(igual que el corte anterior\)/.test(p3.resumen) && !/BBVA — \$250\.00 \(/.test(p3.resumen), p3.resumen)
  const p3b = await miloAcciones.proponer('liquidez.registrar', { balances: [{ account: 'BBVA', amount: 250 }], others: 'zero' }, CTX)
  check('others=zero deja las demas en 0', p3b.ok && acciones.at(-1).payload.montos.filter(m => m.monto === 0).length === 3, JSON.stringify(acciones.at(-1).payload.montos))

  console.log('\n=== L4: corregir un saldo manda el corte completo ===')
  llamadas.length = 0
  const p4 = await miloAcciones.proponer('liquidez.editar', { balances: [{ account: 'Banamex', amount: 5000 }] }, CTX)
  check('sin id corrige el ultimo corte', p4.ok && acciones.at(-1).payload.id === 12, JSON.stringify(p4))
  check('el resumen muestra antes -> despues', /Banamex: \$4,690\.34 → \$5,000\.00/.test(p4.resumen) && /Total en cuentas: \$6,559\.84 → \$6,869\.50/.test(p4.resumen), p4.resumen)
  await miloAcciones.confirmar({ accionId: p4.accionId, chatId: CTX.chatId })
  check('PUT /api/liquidez/12', llamadas.length === 1 && llamadas[0].metodo === 'PUT' && llamadas[0].ruta === '/api/liquidez/12', JSON.stringify(llamadas))
  const m4 = llamadas[0].body.montos
  check('con las 4 lineas, no solo la que cambio', m4.length === 4 && m4.find(m => m.cuentaId === 2).monto === 5000 && m4.find(m => m.cuentaId === 3).monto === 1783.5, JSON.stringify(m4))
  const p4b = await miloAcciones.proponer('liquidez.editar', { balances: [{ account: 'Banamex', amount: 4690.34 }] }, CTX)
  check('sin cambios reales -> no propone', !p4b.ok && /nada que cambiar/.test(p4b.error), JSON.stringify(p4b))
  const p4c = await miloAcciones.proponer('liquidez.editar', { validated: true }, CTX)
  check('marcar validado', p4c.ok && acciones.at(-1).payload.body.validado === true && !('montos' in acciones.at(-1).payload.body), JSON.stringify(acciones.at(-1).payload))

  console.log('\n=== L5: si el corte cambio desde la propuesta, no se ejecuta ===')
  llamadas.length = 0
  const p5 = await miloAcciones.proponer('liquidez.borrar', { id: 12 }, CTX)
  check('propone el borrado con su total', p5.ok && /Borrar el corte #12/.test(p5.resumen) && /\$6,559\.84/.test(p5.resumen), p5.resumen)
  cortes[0].montos[1].monto = 1 // alguien lo edito en el dashboard
  const c5 = await miloAcciones.confirmar({ accionId: p5.accionId, chatId: CTX.chatId })
  check('no borra', !c5.ok && llamadas.length === 0 && /cambió/.test(c5.texto), c5.texto)
  cortes = [corteViejo()]
  const p5b = await miloAcciones.proponer('liquidez.borrar', { id: 12 }, CTX)
  const c5b = await miloAcciones.confirmar({ accionId: p5b.accionId, chatId: 'otro-chat' })
  check('desde otro chat tampoco', !c5b.ok && llamadas.length === 0, c5b.texto)
  const c5c = await miloAcciones.confirmar({ accionId: p5b.accionId, chatId: CTX.chatId })
  check('desde el chat correcto: DELETE /api/liquidez/12', c5c.ok && llamadas.at(-1)?.metodo === 'DELETE' && llamadas.at(-1)?.ruta === '/api/liquidez/12', JSON.stringify(llamadas))
  const p5d = await miloAcciones.proponer('liquidez.borrar', {}, CTX)
  check('borrar sin id no adivina', !p5d.ok, JSON.stringify(p5d))

  console.log('\n=== L6: el agente solo ve estas herramientas con acciones ===')
  const nombres = a => getToolDefinitions({ acciones: a }).map(t => t.name)
  check('con acciones: las tres de liquidez', ['proponer_corte_liquidez', 'proponer_editar_corte_liquidez', 'proponer_borrar_corte_liquidez'].every(n => nombres(true).includes(n)))
  check('sin acciones (WhatsApp): ninguna', !nombres(false).some(n => n.startsWith('proponer_')))
  const sin = await executeTool('proponer_corte_liquidez', { balances: TODAS }, {})
  check('y no se pueden ejecutar sin acciones', sin.ok === false && /no permitida/.test(sin.error), JSON.stringify(sin))
  const antes = acciones.length
  const con = await executeTool('proponer_corte_liquidez', { balances: TODAS }, { acciones: CTX })
  check('con acciones deja la propuesta', con.ok && acciones.length === antes + 1 && acciones.at(-1).tipo === 'liquidez.registrar', JSON.stringify(con))
  const lista = await executeTool('list_liquidity_cuts', {})
  check('list_liquidity_cuts da id, fecha y total', lista.ok && lista.cuts[0].snapshotId === 12 && lista.cuts[0].cash === 6559.84, JSON.stringify(lista))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
