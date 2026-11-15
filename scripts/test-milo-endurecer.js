// Endurecimiento del agente de Milo (2026-11-15). Cada bloque fija una falla
// que se vio en produccion o un hueco encontrado en la revision.
//
// Sin red ni Postgres: Prisma y la API del dashboard son dobles. El doble de
// Prisma REORDENA las llaves del payload como lo hace una columna JSONB, que es
// lo que rompia las confirmaciones de verdad.
//
//   A. Huella: editar y borrar se confirman aunque Postgres reordene el JSON
//      (antes TODA confirmacion fallaba con "el movimiento cambio").
//   B. En un grupo, solo quien pidio el cambio (o un administrador) confirma.
//   C. Reintento de una confirmacion que quedo a medias: no duplica.
//   D. Una accion atorada en 'ejecutando' se libera sola.
//   E. registrar_gasto / proponer_reasignar_gasto: solo con el canal que las
//      habilita, y a lo mas una vez por mensaje.
//   F. Argumentos invalidos de las herramientas: error legible, sin tocar la base.
//   G. El prompt cambia por canal: la web no promete registro directo.

process.env.TZ = 'America/Mexico_City'
delete process.env.ANTHROPIC_API_KEY
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
delete process.env.MILO_ADMINS

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

// Postgres guarda jsonb con las llaves ordenadas por longitud y luego por
// orden binario. Asi se ve el payload al leerlo de vuelta.
function comoJsonb(valor) {
  if (Array.isArray(valor)) return valor.map(comoJsonb)
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    const llaves = Object.keys(valor).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(llaves.map(k => [k, comoJsonb(valor[k])]))
  }
  return valor
}

const HOY = '2026-11-14'
const movimientos = new Map()
function movimiento(id, extra = {}) {
  const tx = {
    id, fecha: new Date(`${HOY}T00:00:00.000Z`), monto: 12623, descripcion: 'Banamex tengo 12,623',
    categoriaId: 7, presupuestoId: null, metodoPagoId: 2, estatus: 'Pagado',
    categoria: { id: 7, nombre: 'Personal', tipo: 'Gasto' }, presupuesto: null, metodoPago: { id: 2, nombre: 'Efectivo' }, quincena: { id: 39, codigo: 'Q39' },
    fechaRegistro: new Date(),
    ...extra,
  }
  movimientos.set(id, tx)
  return tx
}

const acciones = []
let nextAccion = 1
const fakePrisma = {
  transaccion: {
    findUnique: async ({ where }) => movimientos.get(where.id) || null,
    findFirst: async ({ where }) => [...movimientos.values()].reverse().find(t =>
      t.descripcion === where.descripcion && Number(t.monto) === Number(where.monto) &&
      t.categoriaId === where.categoriaId && t.fechaRegistro >= where.fechaRegistro.gte) || null,
  },
  categoria: { findMany: async () => [{ id: 3, nombre: 'Familia', tipo: 'Gasto', activo: true }] },
  quincena: { findFirst: async () => ({ id: 39, codigo: 'Q39' }) },
  miloAccion: {
    create: async ({ data }) => {
      const f = { id: nextAccion++, estado: 'pendiente', resultado: null, createdAt: new Date(), ...data, payload: comoJsonb(data.payload) }
      acciones.push(f)
      return f
    },
    findUnique: async ({ where }) => acciones.find(a => a.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      const coincideEstado = a => (where.estado?.in ? where.estado.in.includes(a.estado) : typeof where.estado === 'string' ? a.estado === where.estado : true)
      const filas = acciones.filter(a => a.id === where.id && (!where.chatId || a.chatId === where.chatId) &&
        coincideEstado(a) && (!where.expiraEn?.gt || a.expiraEn > where.expiraEn.gt))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
    update: async ({ where, data }) => Object.assign(acciones.find(a => a.id === where.id), data),
  },
}

const llamadas = []
let dashboardFalla = null
const fakeDashboardApi = {
  isEnabled: () => true,
  DashboardApiError: Error,
  llamar: async (metodo, ruta, opts = {}) => {
    llamadas.push({ metodo, ruta, ...opts })
    if (dashboardFalla) {
      const e = dashboardFalla
      dashboardFalla = null
      throw e
    }
    if (metodo === 'DELETE') movimientos.delete(Number(ruta.split('/').pop()))
    if (metodo === 'POST' && ruta === '/api/transacciones') {
      const tx = movimiento(500 + llamadas.length, { ...opts.body, fecha: new Date(`${opts.body.fecha}T00:00:00.000Z`), fechaRegistro: new Date() })
      return { id: tx.id }
    }
    return { id: 77 }
  },
}
for (const [rel, exports] of [['lib/prisma.js', fakePrisma], ['dashboardApi.js', fakeDashboardApi]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const miloAcciones = require(path.join(SRC, 'miloAcciones.js'))
const { executeTool, getToolDefinitions } = require(path.join(SRC, 'miloTools.js'))
const { buildSystemPrompt } = require(path.join(SRC, 'financeAgent.js'))._interno

const CHAT = '-5206981351'
const RENE = '8946880241'
const MARIANA = '7000000001'

async function main() {
  console.log('=== A: la huella sobrevive al reordenamiento de JSONB ===')
  const { huella, mismaHuella, jsonCanonico } = miloAcciones._interno
  const tx = movimiento(649)
  const guardada = comoJsonb(huella(tx))
  check('JSON.stringify a secas SI difiere (el bug de produccion)', JSON.stringify(guardada) !== JSON.stringify(huella(tx)))
  check('mismaHuella ignora el orden de las llaves', mismaHuella(huella(tx), guardada))
  check('jsonCanonico es igual con llaves en otro orden', jsonCanonico({ b: 1, a: [{ d: 2, c: 3 }] }) === jsonCanonico({ a: [{ c: 3, d: 2 }], b: 1 }))
  check('un cambio real si se detecta', !mismaHuella({ ...huella(tx), monto: 1 }, guardada))
  check('la forma de pago ya cuenta en la huella', !mismaHuella({ ...huella(tx), metodoPagoId: 9 }, guardada))
  const { metodoPagoId, ...sinMetodo } = guardada
  check('una huella vieja sin metodoPagoId no bloquea la confirmacion', mismaHuella(huella(tx), sinMetodo))

  const pBorrar = await miloAcciones.proponer('transaccion.borrar', { id: '649' }, { chatId: CHAT, userId: 1, solicitante: 'Rene', autor: RENE })
  check('propone borrar #649', pBorrar.ok, JSON.stringify(pBorrar))
  const cBorrar = await miloAcciones.confirmar({ accionId: pBorrar.accionId, chatId: CHAT, actor: 'Rene', quien: { telegramUserId: RENE } })
  check('confirmar borrar FUNCIONA (antes: "el movimiento cambio")', cBorrar.ok && /borré/.test(cBorrar.texto), cBorrar.texto)
  check('el DELETE fue al dashboard', llamadas.some(l => l.metodo === 'DELETE' && l.ruta === '/api/transacciones/649'))
  check('el _autor no viaja a la ejecucion', !JSON.stringify(llamadas.at(-1)).includes('_autor'))

  movimiento(646, { monto: 36, descripcion: 'leche', categoriaId: 3, categoria: { id: 3, nombre: 'Familia', tipo: 'Gasto' } })
  const pEditar = await miloAcciones.proponer('transaccion.editar', { id: 646, amount: 36.5 }, { chatId: CHAT, autor: RENE })
  const cEditar = await miloAcciones.confirmar({ accionId: pEditar.accionId, chatId: CHAT, actor: 'Rene', quien: { telegramUserId: RENE } })
  check('confirmar editar FUNCIONA', cEditar.ok, cEditar.texto)

  console.log('\n=== B: en el grupo solo confirma quien lo pidio (o un administrador) ===')
  movimiento(700, { descripcion: 'super', monto: 200 })
  const pM = await miloAcciones.proponer('transaccion.borrar', { id: 700 }, { chatId: CHAT, solicitante: 'Mariana', autor: MARIANA })
  const otro = await miloAcciones.motivoParaNoConfirmar(pM.accionId, CHAT, { telegramUserId: '5555' })
  check('otra persona del grupo NO puede', /Solo Mariana/.test(otro || ''), otro)
  const cOtro = await miloAcciones.confirmar({ accionId: pM.accionId, chatId: CHAT, quien: { telegramUserId: '5555' } })
  check('...y confirmar() tambien lo rechaza sin ejecutar', !cOtro.ok && movimientos.has(700), cOtro.texto)
  const cancOtro = await miloAcciones.cancelar({ accionId: pM.accionId, chatId: CHAT, quien: { telegramUserId: '5555' } })
  check('...ni cancelar', !cancOtro.ok && acciones.find(a => a.id === pM.accionId).estado === 'pendiente', cancOtro.texto)
  check('quien lo pidio si puede', (await miloAcciones.motivoParaNoConfirmar(pM.accionId, CHAT, { telegramUserId: MARIANA })) === null)
  check('Rene (administrador por default) si puede', miloAcciones.esAdministrador('Rene') && (await miloAcciones.motivoParaNoConfirmar(pM.accionId, CHAT, { telegramUserId: RENE, esAdmin: true })) === null)
  check('Mariana no es administradora por default', !miloAcciones.esAdministrador('Mariana'))
  process.env.MILO_ADMINS = 'Rene, Mariana'
  check('MILO_ADMINS agrega administradores', miloAcciones.esAdministrador('mariana'))
  delete process.env.MILO_ADMINS
  const pWeb = await miloAcciones.proponer('transaccion.borrar', { id: 700 }, { chatId: 'web:abcdef12' })
  check('sin autor (web) no se restringe', (await miloAcciones.motivoParaNoConfirmar(pWeb.accionId, 'web:abcdef12', {})) === null)

  console.log('\n=== C: un reintento no duplica ===')
  const pReg = await miloAcciones.proponer('transaccion.registrar', { amount: 553, description: 'fruta de mercado', category: 'Familia', date: HOY }, { chatId: CHAT, userId: 1, autor: RENE })
  check('propone registrar', pReg.ok, JSON.stringify(pReg))
  // El dashboard guarda pero la respuesta no llega (timeout): para el bot es un error.
  dashboardFalla = new Error('timeout del dashboard')
  const original = fakeDashboardApi.llamar
  fakeDashboardApi.llamar = async (metodo, ruta, opts) => {
    if (dashboardFalla && metodo === 'POST') {
      movimiento(900, { ...opts.body, fecha: new Date(`${opts.body.fecha}T00:00:00.000Z`), fechaRegistro: new Date() })
      dashboardFalla = null
      llamadas.push({ metodo, ruta, ...opts })
      throw new Error('timeout del dashboard')
    }
    return original(metodo, ruta, opts)
  }
  const c1 = await miloAcciones.confirmar({ accionId: pReg.accionId, chatId: CHAT, quien: { telegramUserId: RENE } })
  check('primer toque: falla y se puede reintentar', !c1.ok && c1.reintentable, c1.texto)
  const postsAntes = llamadas.filter(l => l.metodo === 'POST').length
  const c2 = await miloAcciones.confirmar({ accionId: pReg.accionId, chatId: CHAT, quien: { telegramUserId: RENE } })
  check('reintento: detecta que YA se guardo', c2.ok && /Ya estaba registrado/.test(c2.texto) && /#900/.test(c2.texto), c2.texto)
  check('...y NO vuelve a llamar al dashboard', llamadas.filter(l => l.metodo === 'POST').length === postsAntes)
  fakeDashboardApi.llamar = original

  console.log('\n=== D: una accion atorada en "ejecutando" se libera ===')
  movimiento(701, { descripcion: 'gas', monto: 400 })
  const pAt = await miloAcciones.proponer('transaccion.borrar', { id: 701 }, { chatId: CHAT, autor: RENE })
  const fila = acciones.find(a => a.id === pAt.accionId)
  fila.estado = 'ejecutando'
  fila.resultado = { reclamadaEn: new Date(Date.now() - 10 * 60 * 1000).toISOString() }
  const cAt = await miloAcciones.confirmar({ accionId: pAt.accionId, chatId: CHAT, quien: { telegramUserId: RENE } })
  check('se recupera y se aplica', cAt.ok, cAt.texto)
  const pReciente = await miloAcciones.proponer('transaccion.borrar', { id: 700 }, { chatId: CHAT, autor: RENE })
  const filaR = acciones.find(a => a.id === pReciente.accionId)
  filaR.estado = 'ejecutando'
  filaR.resultado = { reclamadaEn: new Date().toISOString() }
  const cR = await miloAcciones.confirmar({ accionId: pReciente.accionId, chatId: CHAT, quien: { telegramUserId: RENE } })
  check('una que apenas empezo NO se toca', !cR.ok && /se está aplicando/.test(cR.texto), cR.texto)

  console.log('\n=== E: registro directo y reasignacion solo donde se habilitan ===')
  const nombres = opts => getToolDefinitions(opts).map(d => d.name)
  check('WhatsApp (sin acciones) no ve registrar_gasto', !nombres({}).includes('registrar_gasto'))
  check('la web (acciones sin registro directo) no lo ve', !nombres({ acciones: true }).includes('registrar_gasto'))
  check('Telegram si lo ve', nombres({ acciones: true, registroDirecto: true }).includes('registrar_gasto') && nombres({ acciones: true, registroDirecto: true }).includes('proponer_reasignar_gasto'))
  const sinCanal = await executeTool('registrar_gasto', { text: '200 super' }, { acciones: { chatId: CHAT } })
  check('sin ctx.registrarGasto la herramienta se niega', !sinCanal.ok && /no permitida/.test(sinCanal.error), JSON.stringify(sinCanal))
  const textos = []
  const registrarGasto = async t => { textos.push(t); return { ok: true, movimiento: { id: 1, descripcion: 'super', monto: 200 } } }
  const ok = await executeTool('registrar_gasto', { text: '200 super' }, { registrarGasto })
  check('con el canal, registra con el texto tal cual', ok.ok && textos[0] === '200 super', JSON.stringify(ok))
  const sinMonto = await executeTool('registrar_gasto', { text: 'super' }, { registrarGasto })
  check('sin monto no registra', !sinMonto.ok && textos.length === 1)
  const reasig = []
  const r1 = await executeTool('proponer_reasignar_gasto', { reference: 'suerox', destination: 'diversion' }, { reasignarGasto: async (a, b) => { reasig.push([a, b]); return true } })
  check('reasignar pasa referencia y destino', r1.ok && reasig[0][0] === 'suerox' && reasig[0][1] === 'diversion', JSON.stringify(r1))

  console.log('\n=== F: argumentos invalidos -> error legible, sin consultar ===')
  const malTipo = await executeTool('search_transactions', { type: 'gastos varios' })
  check('type invalido -> error con las opciones', !malTipo.ok && /Gasto, Ingreso, Ahorro/.test(malTipo.error), JSON.stringify(malTipo))
  const malFecha = await executeTool('search_transactions', { dateFrom: '14/11/2026' })
  check('fecha invalida -> error', !malFecha.ok && /YYYY-MM-DD/.test(malFecha.error), JSON.stringify(malFecha))
  const { enumValido, fechaValida } = require(path.join(SRC, 'miloTools.js'))._interno
  check('"gasto" en minusculas se acepta como Gasto', enumValido('gasto', ['Gasto', 'Ingreso']) === 'Gasto')
  check('2026-02-30 no es fecha', !fechaValida('2026-02-30') && fechaValida('2026-02-28'))

  console.log('\n=== G: el prompt cambia por canal ===')
  const tg = buildSystemPrompt('ctx', { acciones: true, canal: 'telegram', registroDirecto: true })
  const web = buildSystemPrompt('ctx', { acciones: true, canal: 'web' })
  check('Telegram: explica registrar_gasto y cuando NO usarlo', /registrar_gasto/.test(tg) && /corte de liquidez/.test(tg))
  check('web: no promete el registro directo', !/registrar_gasto/.test(web) && /proponer_registrar_movimiento/.test(web))
  check('ya no dice que "200 super" lo registra solo el bot', !/el bot ya lo registra solo/.test(tg + web))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
}

main().catch(error => {
  console.error('El harness truono:', error)
  process.exit(1)
})
