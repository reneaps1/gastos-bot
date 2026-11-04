// Respuestas de Milo armadas con plantilla, SIN IA, a partir del resultado de
// una herramienta de src/miloTools.js.
//
// Para que existe: el 2026-11-04 Milo ya tenia en la mano las 29 lineas con sus
// saldos (list_budget_lines respondio bien) y aun asi contesto "No pude
// contestar", porque DeepSeek devolvio vacio al redactar. Con esto, si la IA
// falla DESPUES de traer los datos, el usuario recibe los datos igual. La Fase 2
// (respuestas directas) las usa tambien para las preguntas comunes.
//
// Funciones puras: reciben el objeto que devuelve la herramienta y regresan
// texto plano (Telegram lo manda sin Markdown) o null si no saben armarlo.
// Formato acordado con el usuario: el dato principal primero y luego una cosa
// por renglon, "• Nombre — $monto (detalle)", con "• y N mas" al final.

const { formatMXN } = require('./lib/finanzas-quincena')
const { fechaMexico } = require('./financeUtils')

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fechaCorta(iso, hoy = fechaMexico()) {
  if (!iso) return null
  if (iso === hoy) return 'hoy'
  const [, m, d] = String(iso).split('-').map(Number)
  return m && d ? `${d} ${MESES[m - 1]}` : String(iso)
}

// Hasta `max` viñetas; si hay mas, la ultima dice cuantas faltaron. `total`
// es cuantas hay en realidad, cuando la herramienta ya recorto la lista.
function vinetas(items, max, render, total = items.length) {
  const filas = items.slice(0, max).map(x => `• ${render(x)}`)
  const faltan = Math.max(total, items.length) - filas.length
  if (faltan > 0) filas.push(`• y ${faltan} más`)
  return filas
}

function lineasDePresupuesto(r) {
  if (!r?.ok) return null
  if (!r.lines?.length) return r.message || `No encontré líneas de presupuesto en ${r.period}.`
  const t = r.totals || {}
  const cabeza = r.lines.length === 1
    ? `${r.lines[0].name}: te quedan ${formatMXN(r.lines[0].remaining)} de ${formatMXN(r.lines[0].effectiveBudget)} en ${r.period}.`
    : `Saldos por línea en ${r.period}: te quedan ${formatMXN(t.remaining)} de ${formatMXN(t.budget)}.`
  if (r.lines.length === 1) return cabeza
  // Hasta 30: "dame los saldos por linea" quiere TODAS (son ~29).
  const filas = vinetas(r.lines, 30, l => (l.exceeded > 0
    ? `${l.name} — excedida por ${formatMXN(l.exceeded)} (gastado ${formatMXN(l.spent)} de ${formatMXN(l.effectiveBudget)})`
    : `${l.name} — quedan ${formatMXN(l.remaining)} de ${formatMXN(l.effectiveBudget)}`), r.count)
  return [cabeza, ...filas].join('\n')
}

function movimientos(r) {
  if (!r?.ok) return null
  if (!r.transactions?.length) return `No encontré movimientos con esos filtros${r.period ? ` en ${r.period}` : ''}.`
  const total = r.totals?.sum ?? r.total
  const n = r.totals?.count ?? r.count ?? r.transactions.length
  const cabeza = `${n === 1 ? '1 movimiento' : `${n} movimientos`}${r.period ? ` en ${r.period}` : ''}${total != null ? ` por ${formatMXN(total)}` : ''}.`
  const filas = vinetas(r.transactions, 15, t => {
    const detalle = [fechaCorta(t.date), t.budgetLine || t.category].filter(Boolean).join(', ')
    return `${t.description} — ${formatMXN(t.amount)}${detalle ? ` (${detalle})` : ''}`
  }, n)
  return [cabeza, ...filas].join('\n')
}

function estadoDinero(r) {
  if (!r?.ok || !r.summary?.length) return null
  return r.summary.join('\n')
}

function proximosPagos(r) {
  if (!r?.ok) return null
  const hoy = r.today || fechaMexico()
  if (!r.payments?.length && !r.creditInstallments?.length) return `No hay pagos pendientes en ${r.period}.`
  const cabeza = `${r.totalToPayText || `${formatMXN(r.totalToPay)} por pagar en ${r.period}`}.`
  const pagos = r.payments || []
  const filas = vinetas(pagos, 10, p => {
    const cuando = p.overdue ? `vencido, ${fechaCorta(p.dueDate, hoy)}` : fechaCorta(p.dueDate, hoy)
    return `${p.name} — ${formatMXN(p.toPay)}${cuando ? ` (${cuando})` : ''}`
  }, r.count || pagos.length)
  const abonos = (r.creditInstallments || []).map(a => `• Abono ${a.credit || 'crédito'}${a.installment ? ` ${a.installment}` : ''} — ${formatMXN(a.amount)} (${a.overdue ? 'vencido, ' : ''}${fechaCorta(a.dueDate, hoy)})`)
  return [cabeza, ...filas, ...abonos].join('\n')
}

function liquidez(r) {
  if (!r?.ok) return null
  const cabeza = `En cuentas tienes ${formatMXN(r.cash)} (corte del ${fechaCorta(r.cutDate)}). Por pagar: ${formatMXN(r.remainingToPay)}; quedan ${formatMXN(r.available)}.`
  const filas = vinetas((r.accounts || []).filter(a => Number(a.amount) !== 0), 10, a => `${a.account} — ${formatMXN(a.amount)}`)
  return [cabeza, ...filas].join('\n')
}

const PLANTILLAS = {
  list_budget_lines: lineasDePresupuesto,
  search_transactions: movimientos,
  get_money_status: estadoDinero,
  get_upcoming_payments: proximosPagos,
  get_liquidity: liquidez,
}

/**
 * Texto para el resultado de una herramienta, o null si no hay plantilla para
 * esa herramienta o el resultado no sirve (ok:false, vacio raro).
 */
function formatear(tool, resultado) {
  const f = PLANTILLAS[tool]
  if (!f) return null
  try {
    const texto = f(resultado)
    return texto ? String(texto).trim() : null
  } catch (error) {
    console.error(`PLANTILLA_ERROR ${tool}:`, error.message)
    return null
  }
}

module.exports = { formatear, tienePlantilla: tool => Boolean(PLANTILLAS[tool]), fechaCorta, _plantillas: PLANTILLAS }
