const db = require('./database')
const prisma = require('./lib/prisma')
const { getCurrentQuincena } = require('./quincenas')

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function thisWeekStart() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getCurrentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMoney(n) {
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function detectIntent(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (/cuanto.*(gaste|gasto|gastado).*hoy|gaste.*hoy|hoy.*cuanto|gasto(s)? de hoy|cuanto llevo hoy|que.*(gasto|gastos|gaste|gastado).*(hoy|registrado hoy|registrados hoy)|ver gasto(s)? de hoy|gasto(s)? (de |del )?hoy/.test(lower)) return 'gasto_hoy'
  if (/cuanto.*(gaste|gasto|gastado).*ayer|ayer.*cuanto|gasto(s)? de ayer|que.*(gasto|gastos|gaste|gastado).*ayer/.test(lower)) return 'gasto_ayer'
  if (/cuanto.*(gaste|gasto|gastado).*(semana|esta semana|la semana)|esta semana|semana/.test(lower)) return 'gasto_semana'
  if (/cuanto.*(gaste|gasto|gastado).*(mes|este mes|el mes)|este mes|mes actual/.test(lower)) return 'gasto_mes'
  if (/cuanto.*(gaste|gasto|gastado|gasté).*(en|por|de|categoría|categoria|comida|transporte|entretenimiento|salud|hogar|ropa|educación|educacion|ahorro|otros)/.test(lower)) return 'gasto_categoria'
  if (/cuanto.*(gaste|gasto|gastado|gasté).*(en|de|por)\s+\w+|cuanto.*llevo.*en/.test(lower)) return 'gasto_especifico'
  if (/cuanto.*(queda|quedo|me queda|saldo|balance|disponible|tengo|dispongo)/.test(lower)) return 'balance'
  if (/ultimos|últimos|recientes|cuando|ver gastos|ver movimientos|que (gaste|gasté|compré|compre)/.test(lower)) return 'ultimos'
  if (/mayores|top|mas gastado|más gastado|grandes|mayor|ranking|principales/.test(lower)) return 'top'
  if (/resumen|quincena|quincenal|como voy|cómo voy/.test(lower)) return 'resumen'
  if (/cuanto.*(gaste|gasto|gastado).*(tarjeta|efectivo|transferencia|mercadopago|credito|debito)/.test(lower)) return 'gasto_pago'
  if (/cuanto.*(ingreso|gané|gane|cobré|cobre|recibí|recibi)|ingresos/.test(lower)) return 'ingresos'
  if (/promedio|prom|diario|al dia|al día/.test(lower)) return 'promedio'
  if (/ayuda|help|comandos|opciones|que puedo|qué puedo/.test(lower)) return 'ayuda'

  return null
}

async function getData() {
  const txs = await prisma.transaccion.findMany({
    include: { categoria: true, user: true, metodoPago: true, quincena: true },
    orderBy: { fecha: 'desc' },
  })
  return txs.map(tx => ({
    fecha: tx.fecha.toISOString().slice(0, 10),
    fechaFormat: tx.fecha.toISOString().slice(0, 10),
    usuario: tx.user?.nombre || 'Rene',
    monto: Number(tx.monto),
    descripcion: tx.descripcion,
    categoria: tx.categoria.nombre,
    formaPago: tx.metodoPago?.nombre || 'Efectivo',
    tipo: tx.tipo,
    clasificacion: tx.clasificacion || '',
    quincena: tx.quincena.codigo,
    estatus: tx.estatus,
  }))
}

async function handleQuestion(text, senderName) {
  const intent = detectIntent(text)
  if (!intent) return null

  const data = await getData()

  switch (intent) {
    case 'gasto_hoy': return gastoHoy(data, senderName)
    case 'gasto_ayer': return gastoAyer(data, senderName)
    case 'gasto_semana': return gastoSemana(data, senderName)
    case 'gasto_mes': return gastoMes(data, senderName)
    case 'gasto_categoria': return gastoCategoria(data, text, senderName)
    case 'gasto_especifico': return gastoEspecifico(data, text, senderName)
    case 'balance': return balance(data, senderName)
    case 'ultimos': return ultimos(data, senderName)
    case 'top': return top(data, senderName)
    case 'resumen': return resumen(data, senderName)
    case 'gasto_pago': return gastoPago(data, text, senderName)
    case 'ingresos': return ingresos(data, senderName)
    case 'promedio': return promedio(data, senderName)
    case 'ayuda': return help()
    default: return null
  }
}

function gastoHoy(data, name) {
  const todayStr = today()
  const gastos = data.filter(d => d.fechaFormat === todayStr && d.tipo === 'Gasto')
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `Hoy no se han registrado gastos todavía. 🫙`
  let msg = `📅 *Gastos de hoy (${todayStr})*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\n`
  gastos.forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria}) — ${g.usuario}\n` })
  return msg
}

function gastoAyer(data, name) {
  const yesterdayStr = yesterday()
  const gastos = data.filter(d => d.fechaFormat === yesterdayStr && d.tipo === 'Gasto')
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `Ayer no registraste gastos.`
  let msg = `📅 *Gastos de ayer*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\n`
  gastos.forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria})\n` })
  return msg
}

function gastoSemana(data, name) {
  const weekStart = thisWeekStart()
  const todayStr = today()
  const gastos = data.filter(d => d.fechaFormat >= weekStart && d.fechaFormat <= todayStr && d.tipo === 'Gasto')
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `Esta semana no has registrado gastos.`
  const porCategoria = {}
  gastos.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto })
  let msg = `📅 *Gastos de esta semana*\n📆 ${weekStart} al ${todayStr}\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\nPor categoría:\n`
  Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, monto]) => { msg += `• ${cat}: $${formatMoney(monto)}\n` })
  return msg
}

function gastoMes(data, name) {
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto')
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `Este mes no has registrado gastos.`
  const porCategoria = {}
  gastos.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto })
  let msg = `📅 *Gastos de este mes*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\nPor categoría:\n`
  Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, monto]) => { msg += `• ${cat}: $${formatMoney(monto)}\n` })
  return msg
}

function gastoCategoria(data, text, name) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const cats = ['hogar', 'salud', 'familia', 'transporte', 'suscripciones', 'deudas', 'personal', 'ahorro']
  let found = cats.find(c => lower.includes(c))
  if (!found) {
    const aliases = { super: 'familia', mercado: 'familia', comida: 'familia', uber: 'transporte', gasolina: 'transporte', gas: 'transporte', netflix: 'suscripciones', spotify: 'suscripciones', disney: 'suscripciones', youtube: 'suscripciones', farmacia: 'salud', medico: 'salud', doctor: 'salud', gine: 'salud', terapia: 'salud', luz: 'hogar', agua: 'hogar', internet: 'hogar', coppel: 'deudas', deuda: 'deudas', diversion: 'personal', gym: 'personal', audifonos: 'personal', ropa: 'personal', educacion: 'personal' }
    for (const [alias, cat] of Object.entries(aliases)) { if (lower.includes(alias)) { found = cat; break } }
  }
  if (!found) return `No detecté la categoría. Prueba con: hogar, salud, familia, transporte, suscripciones, deudas, personal.`
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto' && d.categoria.toLowerCase() === found)
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `No tienes gastos en *${found}* este mes.`
  let msg = `🏷️ *${found.charAt(0).toUpperCase() + found.slice(1)} este mes*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\n`
  gastos.slice(0, 10).forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n` })
  if (gastos.length > 10) msg += `\n... y ${gastos.length - 10} más`
  return msg
}

function gastoEspecifico(data, text, name) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const words = lower.split(/\s+/)
  const skip = ['cuanto', 'gaste', 'gasto', 'gastado', 'gasté', 'en', 'de', 'por', 'la', 'el', 'los', 'las', 'un', 'una', 'llevo', 'lleve']
  const searchWords = words.filter(w => !skip.includes(w) && w.length > 2)
  if (searchWords.length === 0) return `No detecté en qué gastaste. Prueba: "cuanto gaste en McDonalds"`
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto')
  const matches = gastos.filter(g => { const desc = g.descripcion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return searchWords.some(w => desc.includes(w)) })
  const total = matches.reduce((s, d) => s + d.monto, 0)
  if (matches.length === 0) return `No encontré gastos relacionados con "${searchWords.join(' ')}" este mes.`
  let msg = `🔍 *"${searchWords.join(' ')}" este mes*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${matches.length} vez(es)\n\n`
  matches.slice(0, 5).forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n` })
  return msg
}

function balance(data, name) {
  const month = getCurrentMonth()
  const ingresos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Ingreso')
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto')
  const totalIngresos = ingresos.reduce((s, d) => s + d.monto, 0)
  const totalGastos = gastos.reduce((s, d) => s + d.monto, 0)
  const disponible = totalIngresos - totalGastos
  let msg = `💰 *Balance del mes*\n\n📈 Ingresos: *$${formatMoney(totalIngresos)}*\n📉 Gastos: *$${formatMoney(totalGastos)}*\n💵 Disponible: *$${formatMoney(disponible)}*\n\n`
  if (disponible > 0) msg += `✅ vas bien, te quedan $${formatMoney(disponible)}`
  else if (disponible === 0) msg += `⚠️ estás al cero`
  else msg += `🔴 vas en negativo por $${formatMoney(Math.abs(disponible))}`
  return msg
}

function ultimos(data, name) {
  const sorted = [...data].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const last10 = sorted.slice(0, 10)
  if (last10.length === 0) return `No hay registros aún.`
  let msg = `📋 *Últimos movimientos*\n\n`
  last10.forEach(g => {
    const icon = g.tipo === 'Gasto' ? '📉' : '📈'
    msg += `${icon} $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria})\n   📅 ${g.fechaFormat} | ${g.formaPago}\n\n`
  })
  return msg
}

function top(data, name) {
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto')
  if (gastos.length === 0) return `No hay gastos este mes.`
  const sorted = [...gastos].sort((a, b) => b.monto - a.monto).slice(0, 10)
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  let msg = `🏆 *Top 10 gastos del mes*\n\n`
  sorted.forEach((g, i) => {
    const pct = ((g.monto / total) * 100).toFixed(1)
    msg += `${i + 1}. $${formatMoney(g.monto)} - ${g.descripcion}\n   📅 ${g.fechaFormat} | 🏷️ ${g.categoria} | ${pct}%\n\n`
  })
  return msg
}

function resumen(data, name) {
  const q = getCurrentQuincena()
  const month = getCurrentMonth()
  const quincenaData = data.filter(d => d.quincena === q)
  const monthData = data.filter(d => d.fechaFormat.startsWith(month))
  const gastosQ = quincenaData.filter(d => d.tipo === 'Gasto').reduce((s, d) => s + d.monto, 0)
  const ingresosQ = quincenaData.filter(d => d.tipo === 'Ingreso').reduce((s, d) => s + d.monto, 0)
  const gastosM = monthData.filter(d => d.tipo === 'Gasto').reduce((s, d) => s + d.monto, 0)
  const ingresosM = monthData.filter(d => d.tipo === 'Ingreso').reduce((s, d) => s + d.monto, 0)
  const porCategoria = {}
  quincenaData.filter(d => d.tipo === 'Gasto').forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto })
  let msg = `📊 *Resumen ${q}*\n\n💵 *Quincena:*\n  📈 Ingresos: $${formatMoney(ingresosQ)}\n  📉 Gastos: $${formatMoney(gastosQ)}\n  💰 Disponible: *$${formatMoney(ingresosQ - gastosQ)}*\n\n📅 *Mes (${month}):*\n  📈 Ingresos: $${formatMoney(ingresosM)}\n  📉 Gastos: $${formatMoney(gastosM)}\n  💰 Disponible: *$${formatMoney(ingresosM - gastosM)}*\n\n`
  if (Object.keys(porCategoria).length > 0) {
    msg += `Por categoría (${q}):\n`
    Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, monto]) => { msg += `• ${cat}: $${formatMoney(monto)}\n` })
  }
  return msg
}

function gastoPago(data, text, name) {
  const lower = text.toLowerCase()
  const pagos = ['efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'credito', 'debito', 'spei', 'vales']
  const found = pagos.find(p => lower.includes(p))
  if (!found) return `No detecté la forma de pago. Prueba con: efectivo, tarjeta, transferencia`
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto' && d.formaPago.toLowerCase().includes(found))
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  if (gastos.length === 0) return `No tienes gastos con *${found}* este mes.`
  let msg = `💳 *${found.charAt(0).toUpperCase() + found.slice(1)} este mes*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${gastos.length} movimiento(s)\n\n`
  gastos.slice(0, 10).forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n` })
  return msg
}

function ingresos(data, name) {
  const month = getCurrentMonth()
  const ing = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Ingreso')
  const total = ing.reduce((s, d) => s + d.monto, 0)
  if (ing.length === 0) return `No tienes ingresos registrados este mes.`
  let msg = `📈 *Ingresos del mes*\n\n💰 Total: *$${formatMoney(total)}*\n📝 ${ing.length} registro(s)\n\n`
  ing.forEach(g => { msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n` })
  return msg
}

function promedio(data, name) {
  const month = getCurrentMonth()
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto')
  if (gastos.length === 0) return `No hay datos para calcular promedio.`
  const total = gastos.reduce((s, d) => s + d.monto, 0)
  const days = new Set(gastos.map(d => d.fechaFormat)).size
  const prom = total / days
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = prom * daysInMonth
  let msg = `📊 *Promedio diario este mes*\n\n💰 Promedio: *$${formatMoney(prom)}/día*\n📅 Días con registros: ${days}\n📈 Proyección fin de mes: *$${formatMoney(projected)}*\n`
  return msg
}

function help() {
  return [
    `🤖 *Bot de Gastos - Comandos*`,
    ``,
    `*Registrar:*`,
    `• gasto 149 McDonalds comida`,
    `• gaste 36 estacionamiento`,
    `• ingreso 3500 pago`,
    ``,
    `*Consultar:*`,
    `• cuanto gaste hoy`,
    `• cuanto gaste ayer`,
    `• cuanto gaste esta semana`,
    `• cuanto gaste este mes`,
    ``,
    `*Por categoría:*`,
    `• cuanto gaste en familia`,
    `• cuanto gaste en transporte`,
    `• cuanto gaste en salud`,
    `• cuanto gaste en personal`,
    ``,
    `*Por algo específico:*`,
    `• cuanto gaste en McDonalds`,
    `• cuanto gaste en uber`,
    ``,
    `*Balance:*`,
    `• cuanto me queda`,
    `• balance`,
    ``,
    `*Otros:*`,
    `• ultimos - últimos movimientos`,
    `• top - top 10 gastos del mes`,
    `• resumen - resumen quincenal`,
    `• ingresos - ver ingresos del mes`,
    `• promedio - promedio diario`,
    `• gasto en efectivo - por forma de pago`,
  ].join('\n')
}

module.exports = { handleQuestion, detectIntent, getData }
