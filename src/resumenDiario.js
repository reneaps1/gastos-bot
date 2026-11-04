// Resumen diario por Telegram (8 pm de Mexico, lo dispara
// .github/workflows/resumen-diario.yml contra POST /cron/resumen-diario).
//
//   Hoy gastaste $X (n gastos)
//   el desglose por linea de presupuesto
//   lo que quedo sin clasificar (sin linea)
//   lo que falta por cubrir (por pagar)
//   cuanto te queda, y el veredicto: vas bien / te alcanza / no te alcanza
//
// Los numeros de dinero salen de get_money_status (src/miloTools.js), la misma
// herramienta que contesta "¿cuanto me queda?" en el chat, que a su vez usa
// los calculos del dashboard (src/lib/finanzas-quincena.js, con prueba de
// paridad al centavo en scripts/test-milo-finanzas.js). El resumen no hace
// cuentas propias de dinero: solo suma los gastos del dia.
//
// QUE DIA RESUME: el que acaba de terminar, no la fecha del reloj. El cron de
// GitHub se programa a las 20:00, pero GitHub atrasa los crons de este repo
// HORAS (el watchdog "cada 30 min" corre cada 4-8 h). El 2026-11-04 el de las
// 8 pm corrio a las 2:20 am: resumio el dia 4, que apenas empezaba, y dijo
// "Hoy no registraste gastos" con el gasto de Gas del dia 3 en la base. Por
// eso, antes de mediodia (HORA_CORTE) se resume AYER y el texto dice "Ayer".
//
// AUTENTICACION SIN SECRETOS NUEVOS: el workflow ya tiene TELEGRAM_BOT_TOKEN
// (lo usa el watchdog). Manda sha256("cron:" + token) en X-Cron-Token; el bot
// calcula lo mismo y compara en tiempo constante. El token nunca viaja.

const crypto = require('crypto')
const prisma = require('./lib/prisma')
const telegram = require('./telegram')
const { executeTool } = require('./miloTools')
const { fechaMexico, dbDate, ZONA_MEXICO } = require('./financeUtils')
const { formatMXN } = require('./lib/finanzas-quincena')

const MAX_SIN_LINEA_LISTADOS = 5
// Antes de esta hora (Mexico) el resumen es del dia anterior: un cron de las
// 8 pm que llega de madrugada o en la manana sigue hablando del dia correcto.
const HORA_CORTE = 12

// Dia (Mexico) cuyo resumen ya se mando. En memoria: sirve para que un
// reintento del workflow (el primer intento puede tardar mientras Render
// despierta el servicio) no lo mande dos veces. Un reinicio lo pierde, pero
// entre reintentos de minutos no hay reinicio.
let enviadoEl = null

/**
 * El dia que toca resumir a esta hora: hoy desde mediodia, ayer antes.
 * Devuelve { dia: 'YYYY-MM-DD', esAyer }.
 */
function diaDelResumen(ahora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA_MEXICO, hour: 'numeric', hourCycle: 'h23' }).format(ahora))
  const hoy = fechaMexico(ahora)
  if (hora >= HORA_CORTE) return { dia: hoy, esAyer: false }
  const ayer = dbDate(hoy)
  ayer.setUTCDate(ayer.getUTCDate() - 1)
  return { dia: ayer.toISOString().slice(0, 10), esAyer: true }
}

function tokenEsperado() {
  const t = process.env.TELEGRAM_BOT_TOKEN
  return t ? crypto.createHash('sha256').update(`cron:${t}`).digest('hex') : null
}

function autorizado(header) {
  const esperado = tokenEsperado()
  if (!esperado || typeof header !== 'string' || header.length !== esperado.length) return false
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(esperado))
}

// RESUMEN_CHAT_ID si esta; si no, el primer grupo de la lista blanca (el de
// "Control de gastos"); si no hay grupos, el primer chat permitido.
function chatDestino() {
  if (process.env.RESUMEN_CHAT_ID) return String(process.env.RESUMEN_CHAT_ID)
  const ids = [...telegram.getAllowedChatIds()]
  return ids.find(id => id.startsWith('-')) || ids[0] || null
}

function fechaLarga(hoy) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(dbDate(hoy))
}

const esc = t => telegram.escapeMarkdown(String(t ?? ''))
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/**
 * Arma el texto. Puro: recibe los gastos del dia y el resultado de
 * get_money_status, para poder probarlo sin base.
 */
function formatearResumen({ hoy, esAyer = false, gastos, estado }) {
  const cuando = esAyer ? 'Ayer' : 'Hoy'
  const lineas = [`🌙 *Resumen del día* — ${fechaLarga(hoy)}`, '']

  const total = gastos.reduce((s, g) => s + Number(g.monto), 0)
  if (!gastos.length) {
    lineas.push(`💸 ${cuando} no registraste gastos.`)
  } else {
    lineas.push(`💸 *${cuando} gastaste ${formatMXN(total)}* (${plural(gastos.length, 'gasto', 'gastos')})`)
    const porLinea = new Map()
    for (const g of gastos) {
      const nombre = g.presupuesto?.descripcion || null
      const clave = nombre ?? '\u0000sin'
      const actual = porLinea.get(clave) || { nombre, monto: 0, n: 0 }
      actual.monto += Number(g.monto)
      actual.n += 1
      porLinea.set(clave, actual)
    }
    const filas = [...porLinea.values()].sort((a, b) => b.monto - a.monto)
    for (const f of filas) {
      lineas.push(`• ${f.nombre ? esc(f.nombre) : '_Sin línea_'} — ${formatMXN(f.monto)}${f.n > 1 ? ` (${f.n})` : ''}`)
    }

    const sinLinea = gastos.filter(g => g.presupuestoId == null)
    if (sinLinea.length) {
      const suma = sinLinea.reduce((s, g) => s + Number(g.monto), 0)
      const nombres = sinLinea.slice(0, MAX_SIN_LINEA_LISTADOS).map(g => `«${esc(g.descripcion)}»`).join(', ')
      const mas = sinLinea.length > MAX_SIN_LINEA_LISTADOS ? ` y ${sinLinea.length - MAX_SIN_LINEA_LISTADOS} más` : ''
      lineas.push('', `⚠️ *Quedó sin clasificar:* ${plural(sinLinea.length, 'gasto', 'gastos')} por ${formatMXN(suma)}: ${nombres}${mas}. Escribe «vamos a entrenar» para asignarlos.`)
    } else {
      lineas.push('', '✅ Todo quedó clasificado.')
    }
  }

  lineas.push('')
  if (!estado?.ok) {
    lineas.push('No pude calcular cuánto te queda esta vez.')
    return lineas.join('\n')
  }

  lineas.push(`📌 *Falta por cubrir:* ${formatMXN(estado.toPay)} _(lo que aún sale de caja en ${esc(estado.period)})_`)
  const fuente = estado.hasCut ? `según tus cuentas, corte del ${estado.cutDate}` : 'según tu presupuesto'
  if (estado.verdict === 'falta') {
    lineas.push(`💰 *Te faltan ${formatMXN(estado.amount)}* _(${fuente})_`)
    lineas.push('', `🔴 *No te alcanza con lo que tienes:* te faltan ${formatMXN(estado.amount)} para cubrir lo que queda por pagar.`)
  } else {
    lineas.push(`💰 *Te queda ${formatMXN(estado.amount)}* _(${fuente})_`)
    if (estado.perDay != null) {
      const dias = plural(estado.daysLeft, 'día', 'días')
      lineas.push('', total <= estado.perDay
        ? `🟢 *Vas bien:* te alcanza, y ${cuando.toLowerCase()} gastaste menos que tu ritmo de ${formatMXN(estado.perDay)} al día (quedan ${dias}).`
        : `🟡 *Te alcanza, pero cuidado:* ${cuando.toLowerCase()} gastaste más que tu ritmo de ${formatMXN(estado.perDay)} al día (quedan ${dias}).`)
    } else {
      lineas.push('', '🟢 *Te alcanza con lo que tienes.*')
    }
  }
  if (!estado.hasCut) lineas.push('_Captura tu corte de cuentas para saber si de verdad te alcanza._')
  else if (estado.cutIsOld) lineas.push(`_Ojo: tu corte de cuentas es de hace ${estado.cutAgeDays} días; actualízalo para un veredicto más preciso._`)

  return lineas.join('\n')
}

async function armarResumen({ dia: hoy, esAyer } = diaDelResumen()) {
  const [gastos, estado] = await Promise.all([
    prisma.transaccion.findMany({
      where: { tipo: 'Gasto', fecha: dbDate(hoy) },
      include: { presupuesto: true },
      orderBy: { id: 'asc' },
    }),
    executeTool('get_money_status', {}),
  ])
  return { texto: formatearResumen({ hoy, esAyer, gastos, estado }), gastos: gastos.length }
}

/**
 * Arma y manda el resumen. `dry` solo lo arma. `forzar` lo manda aunque ya
 * se haya mandado hoy.
 */
async function enviar({ dry = false, forzar = false, ahora = new Date() } = {}) {
  const resumen = diaDelResumen(ahora)
  const hoy = resumen.dia
  if (!dry && !forzar && enviadoEl === hoy) return { ok: true, yaEnviado: true, hoy }
  const chat = chatDestino()
  if (!dry && !chat) return { ok: false, error: 'No hay chat destino (RESUMEN_CHAT_ID o TELEGRAM_ALLOWED_CHAT_IDS).' }

  const { texto, gastos } = await armarResumen(resumen)
  if (dry) return { ok: true, dry: true, hoy, texto }

  const r = await telegram.sendTelegramMessage(chat, texto)
  if (r && r.ok === false) return { ok: false, error: 'Telegram no acepto el mensaje.' }
  enviadoEl = hoy
  console.log(`RESUMEN_DIARIO_ENVIADO: chat=${chat}; dia=${hoy}; esAyer=${resumen.esAyer}; gastos=${gastos}`)
  return { ok: true, enviado: true, hoy, gastos }
}

module.exports = { autorizado, tokenEsperado, chatDestino, diaDelResumen, formatearResumen, armarResumen, enviar, _reiniciar: () => { enviadoEl = null } }
