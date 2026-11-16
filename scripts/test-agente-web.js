// Pruebas de las rutas del chat web de Milo (src/agenteWeb.js), sin red ni
// base: un Express de verdad con el agente y las acciones como dobles.
//
// Que se fija y por que:
//   1. La puerta: sin MILO_SERVICE_TOKEN en el bot, 503; sin token o con uno
//      malo, 401. Estas rutas ejecutan cambios financieros confirmados.
//   2. El chatId del canal web SIEMPRE empieza con "web:". Sin eso, desde la
//      web se podria confirmar una propuesta hecha en un chat de Telegram.
//   3. La pregunta llega al agente CON `acciones` (puede proponer) y con la
//      persona resuelta; la respuesta trae cada propuesta con su resumen.
//   4. Confirmar y cancelar pasan chatId, persona y actor a miloAcciones, que
//      es donde vive la validacion de verdad (mismo chat, vigente, un toque).

const express = require('express')
const path = require('path')
const { montar } = require(path.join(__dirname, '..', 'src', 'agenteWeb.js'))

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const TOKEN = 'token-de-prueba-web'
const CHAT = 'web:abcdefghijklmnopqrstuvwx'

const llamadasAgente = []
let respuestaAgente = { reply: 'Te quedan $1,000.00.', provider: 'claude-agent', trace: [{ tool: 'get_money_status' }], acciones: [] }
const llamadasAcciones = []
const fakeAcciones = {
  resumenDe: async id => (id === 7 ? 'Borrar #12: Uber — $85.00' : null),
  confirmar: async args => { llamadasAcciones.push({ tipo: 'confirmar', ...args }); return { ok: true, texto: '✅ Listo: borré Uber por $85.00.' } },
  cancelar: async args => { llamadasAcciones.push({ tipo: 'cancelar', ...args }); return { ok: true, texto: 'Cancelado. No cambié nada.' } },
}
const logs = []

const app = express()
app.use(express.json())
montar(app, {
  financeAgent: { answer: async (pregunta, opts) => { llamadasAgente.push({ pregunta, ...opts }); return respuestaAgente } },
  miloAcciones: fakeAcciones,
  findUserByName: async nombre => (nombre === 'Rene' ? { id: 1, nombre: 'Rene' } : null),
  logQA: entrada => logs.push(entrada),
})

let base
async function post(ruta, body, { token = TOKEN } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${base}${ruta}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function main() {
  const server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  base = `http://localhost:${server.address().port}`

  console.log('=== A: la puerta ===')
  delete process.env.MILO_SERVICE_TOKEN
  check('sin MILO_SERVICE_TOKEN en el bot -> 503', (await post('/agente/web', { pregunta: 'hola', chatId: CHAT })).status === 503)
  process.env.MILO_SERVICE_TOKEN = TOKEN
  check('sin Authorization -> 401', (await post('/agente/web', { pregunta: 'hola', chatId: CHAT }, { token: null })).status === 401)
  check('token incorrecto -> 401', (await post('/agente/web', { pregunta: 'hola', chatId: CHAT }, { token: 'otro' })).status === 401)
  check('las acciones tambien exigen token', (await post('/agente/web/acciones/7', { accion: 'confirmar', chatId: CHAT }, { token: 'otro' })).status === 401)
  check('y no llamo al agente ni a las acciones', llamadasAgente.length === 0 && llamadasAcciones.length === 0)

  console.log('\n=== B: el chatId web siempre empieza con "web:" ===')
  check('un chat de Telegram -> 400', (await post('/agente/web', { pregunta: 'hola', chatId: '-1001111111111' })).status === 400)
  check('confirmar con chatId de Telegram -> 400', (await post('/agente/web/acciones/7', { accion: 'confirmar', chatId: '-1001111111111' })).status === 400)
  check('"web:" con caracteres raros -> 400', (await post('/agente/web', { pregunta: 'hola', chatId: 'web:../x' })).status === 400)
  check('y nada llego al agente ni a las acciones', llamadasAgente.length === 0 && llamadasAcciones.length === 0)

  console.log('\n=== C: validacion del cuerpo ===')
  check('pregunta vacia -> 400', (await post('/agente/web', { pregunta: '   ', chatId: CHAT })).status === 400)
  check('pregunta de mas de 1000 -> 400', (await post('/agente/web', { pregunta: 'x'.repeat(1001), chatId: CHAT })).status === 400)
  check('accion desconocida -> 400', (await post('/agente/web/acciones/7', { accion: 'borrar', chatId: CHAT })).status === 400)

  console.log('\n=== D: una pregunta llega al agente con acciones y persona ===')
  const r1 = await post('/agente/web', { pregunta: '¿cuánto me queda?', chatId: CHAT, usuario: 'Rene' })
  const a1 = llamadasAgente.at(-1)
  check('200 con la respuesta', r1.status === 200 && r1.body.reply === 'Te quedan $1,000.00.', JSON.stringify(r1.body))
  check('el agente recibe el chatId web', a1?.chatId === CHAT)
  check('y `acciones` (puede proponer) con la persona', a1?.acciones?.chatId === CHAT && a1.acciones.userId === 1 && a1.acciones.solicitante === 'Rene', JSON.stringify(a1?.acciones))
  check('deja el log de calidad con ruta web', logs.at(-1)?.ruta === 'web')

  const r2 = await post('/agente/web', { pregunta: 'hola', chatId: CHAT, usuario: 'Desconocido' })
  check('persona desconocida: sigue, sin userId', r2.status === 200 && llamadasAgente.at(-1).acciones.userId === null)

  respuestaAgente = { reply: 'Te dejo el borrado para confirmar.', provider: 'claude-agent', trace: [], acciones: [7, 99] }
  const r3 = await post('/agente/web', { pregunta: 'borra el uber', chatId: CHAT, usuario: 'Rene' })
  check('trae cada propuesta con su resumen', JSON.stringify(r3.body.acciones) === JSON.stringify([{ id: 7, resumen: 'Borrar #12: Uber — $85.00' }]), JSON.stringify(r3.body.acciones))

  respuestaAgente = null
  const r4 = await post('/agente/web', { pregunta: 'hola', chatId: CHAT })
  check('si el agente no contesta: 200 con error legible, no silencio', r4.status === 200 && r4.body.reply === null && /No pude contestar/.test(r4.body.error), JSON.stringify(r4.body))

  console.log('\n=== E: confirmar y cancelar pasan por miloAcciones ===')
  const c1 = await post('/agente/web/acciones/7', { accion: 'confirmar', chatId: CHAT, usuario: 'Rene' })
  const l1 = llamadasAcciones.at(-1)
  check('confirmar -> el texto de miloAcciones', c1.status === 200 && c1.body.ok && /Listo/.test(c1.body.texto), JSON.stringify(c1.body))
  check('con el chatId web, la persona y el actor', l1.tipo === 'confirmar' && l1.chatId === CHAT && String(l1.accionId) === '7' && l1.userId === 1 && l1.actor === 'Rene', JSON.stringify(l1))
  await post('/agente/web/acciones/7', { accion: 'confirmar', chatId: CHAT })
  check('sin persona el actor es "web"', llamadasAcciones.at(-1).actor === 'web')
  const c2 = await post('/agente/web/acciones/7', { accion: 'cancelar', chatId: CHAT })
  check('cancelar -> miloAcciones.cancelar con el chatId', c2.body.ok && llamadasAcciones.at(-1).tipo === 'cancelar' && llamadasAcciones.at(-1).chatId === CHAT)

  console.log('\n=== F: el proxy del dashboard exige sesion de USUARIO ===')
  // Las rutas reales de dashboard/src/app/api/milo, cargadas con el mismo
  // cargador de las pruebas de finanzas. getSession es el doble de ese
  // cargador; aqui se cambia su respuesta por caso.
  const Module = require('module')
  const { requireDashboard } = require(path.join(__dirname, 'dashboard-ts.js'))
  const auth = Module._load('@/lib/auth')
  const rutaChat = requireDashboard('app/api/milo/chat/route.ts')
  const rutaAccion = requireDashboard('app/api/milo/acciones/[id]/route.ts')
  const pedir = (body) => new Request('http://x/api/milo/chat', { method: 'POST', body: JSON.stringify(body) })
  const params = { params: Promise.resolve({ id: '7' }) }

  auth.getSession = async () => null
  check('sin sesion -> 401', (await rutaChat.POST(pedir({ pregunta: 'hola', chatId: CHAT }))).status === 401)
  check('acciones sin sesion -> 401', (await rutaAccion.POST(pedir({ accion: 'confirmar', chatId: CHAT }), params)).status === 401)
  auth.getSession = async () => ({ username: 'milo:Rene', servicio: true })
  check('el token de servicio NO puede usar el chat -> 401', (await rutaChat.POST(pedir({ pregunta: 'hola', chatId: CHAT }))).status === 401)
  check('ni confirmar acciones -> 401', (await rutaAccion.POST(pedir({ accion: 'confirmar', chatId: CHAT }), params)).status === 401)
  auth.getSession = async () => ({ username: 'rene' })
  check('con sesion, chatId de Telegram -> 400', (await rutaChat.POST(pedir({ pregunta: 'hola', chatId: '-100111' }))).status === 400)
  delete process.env.MILO_BOT_URL
  check('con sesion y sin MILO_BOT_URL -> 503 (no hay default)', (await rutaChat.POST(pedir({ pregunta: 'hola', chatId: CHAT }))).status === 503)
  process.env.MILO_BOT_URL = 'http://gastos-bot.ejemplo.com'
  check('MILO_BOT_URL sin https -> 503 (el token no viaja en claro)', (await rutaChat.POST(pedir({ pregunta: 'hola', chatId: CHAT }))).status === 503)

  // De punta a punta: el proxy del dashboard contra este mismo bot de prueba.
  process.env.MILO_BOT_URL = base
  respuestaAgente = { reply: 'Hola desde el bot.', provider: 'claude-agent', trace: [], acciones: [7] }
  const extremo = await rutaChat.POST(pedir({ pregunta: 'hola', chatId: CHAT, usuario: 'Rene' }))
  check('dashboard -> bot -> respuesta con su propuesta', extremo.status === 200 && extremo.body.reply === 'Hola desde el bot.' && extremo.body.acciones?.[0]?.id === 7, JSON.stringify(extremo.body))
  const conf = await rutaAccion.POST(pedir({ accion: 'confirmar', chatId: CHAT, usuario: 'Rene' }), params)
  check('dashboard -> bot -> confirmar', conf.status === 200 && conf.body.ok === true, JSON.stringify(conf.body))

  console.log('\n=== G: ping de autoverificacion (dashboard al arrancar) ===')
  const ping = async token => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const res = await fetch(`${base}/agente/web/ping`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const pingOk = await ping(TOKEN)
  check('ping con el token -> 200 ok', pingOk.status === 200 && pingOk.body?.ok === true, JSON.stringify(pingOk))
  check('ping con otro token -> 401 (el dashboard lo reporta como token-no-coincide)', (await ping('otro-token')).status === 401)
  check('ping sin token -> 401', (await ping(null)).status === 401)

  server.close()
  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
