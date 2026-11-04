#!/usr/bin/env node
// Pruebas de src/plantillasMilo.js: las respuestas de Milo armadas sin IA a
// partir del resultado de una herramienta. Sin red ni base: las plantillas son
// funciones puras sobre objetos con la forma que devuelve src/miloTools.js.

const path = require('path')
const { formatear, tienePlantilla, fechaCorta } = require(path.join(__dirname, '..', 'src', 'plantillasMilo'))

let pass = 0
let fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) } else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? `  ->  ${extra}` : ''}`) }
}

const linea = (name, effectiveBudget, spent, extra = {}) => ({
  name, effectiveBudget, spent, remaining: Math.max(effectiveBudget - spent, 0), exceeded: Math.max(spent - effectiveBudget, 0), ...extra,
})

console.log('=== A: list_budget_lines (el caso real: "saldos x linea", 29 lineas) ===')
{
  const lines = Array.from({ length: 29 }, (_, i) => linea(`Linea ${i + 1}`, 1000, 250))
  lines[3] = linea('Super', 4000, 4500.5)
  const r = { ok: true, period: 'Q38', count: 29, totals: { budget: 32000, remaining: 21000 }, lines, truncated: false }
  const t = formatear('list_budget_lines', r)
  const filas = t.split('\n')
  check('primera linea: el total', filas[0] === 'Saldos por línea en Q38: te quedan $21,000.00 de $32,000.00.', filas[0])
  check('las 29 lineas, una por renglon', filas.filter(f => f.startsWith('• ')).length === 29, filas.length)
  check('formato "• Nombre — quedan $X de $Y"', filas[1] === '• Linea 1 — quedan $750.00 de $1,000.00', filas[1])
  check('la excedida lo dice', filas.includes('• Super — excedida por $500.50 (gastado $4,500.50 de $4,000.00)'), filas[4])
  check('sin "y N más" si caben todas', !/y \d+ más/.test(t), t.slice(-60))
  check('sin Markdown', !/[*_`]/.test(t))
}
{
  const lines = Array.from({ length: 30 }, (_, i) => linea(`L${i}`, 100, 0))
  const t = formatear('list_budget_lines', { ok: true, period: 'Q38', count: 45, totals: { budget: 4500, remaining: 4500 }, lines, truncated: true })
  check('la herramienta recorto (45 de 30): "• y 15 más"', t.endsWith('• y 15 más'), t.slice(-40))
}
{
  const t = formatear('list_budget_lines', { ok: true, period: 'Q38', count: 1, totals: {}, lines: [linea('Gas', 900, 600)] })
  check('una sola linea: una frase directa', t === 'Gas: te quedan $300.00 de $900.00 en Q38.', t)
  const vacio = formatear('list_budget_lines', { ok: true, period: 'Q38', count: 0, lines: [], message: 'No encontré líneas con esos filtros.' })
  check('sin lineas: el mensaje de la herramienta', vacio === 'No encontré líneas con esos filtros.', vacio)
}

console.log('\n=== B: search_transactions ("¿qué gastos hay en la línea Gas?") ===')
{
  const transactions = Array.from({ length: 20 }, (_, i) => ({ date: '2026-11-03', description: `Gas ${i + 1}`, amount: 100 + i, budgetLine: 'Gas', category: 'Casa' }))
  const t = formatear('search_transactions', { ok: true, period: 'Q38', count: 20, totals: { count: 32, sum: 5432.1 }, transactions })
  const filas = t.split('\n')
  check('cabeza con cuantos y el total del filtro completo', filas[0] === '32 movimientos en Q38 por $5,432.10.', filas[0])
  check('cada movimiento con fecha y linea', filas[1] === '• Gas 1 — $100.00 (3 nov, Gas)', filas[1])
  check('hasta 15 y "• y 17 más" (32 en total)', filas.filter(f => /^• Gas/.test(f)).length === 15 && filas.at(-1) === '• y 17 más', filas.at(-1))
  const sinLinea = formatear('search_transactions', { ok: true, period: null, count: 1, totals: { count: 1, sum: 50 }, transactions: [{ date: '2026-10-01', description: 'Chicles', amount: 50, budgetLine: null, category: 'Otros' }] })
  check('singular y la categoria si no hay linea', sinLinea === '1 movimiento por $50.00.\n• Chicles — $50.00 (1 oct, Otros)', JSON.stringify(sinLinea))
  const nada = formatear('search_transactions', { ok: true, period: 'Q38', count: 0, totals: { count: 0, sum: 0 }, transactions: [] })
  check('sin movimientos lo dice', nada === 'No encontré movimientos con esos filtros en Q38.', nada)
}

console.log('\n=== C: get_money_status copia sus frases de summary ===')
{
  const t = formatear('get_money_status', { ok: true, summary: ['Te faltan $9,075.39 para cubrir lo que te queda por pagar en Q38.', 'En cuentas: $1,000.00.'] })
  check('una frase por renglon, tal cual', t === 'Te faltan $9,075.39 para cubrir lo que te queda por pagar en Q38.\nEn cuentas: $1,000.00.', t)
  check('sin summary: null (no inventa)', formatear('get_money_status', { ok: true }) === null)
}

console.log('\n=== D: get_upcoming_payments ===')
{
  const payments = [
    { name: 'Luz', toPay: 800, dueDate: '2026-11-01', overdue: true },
    { name: 'Renta', toPay: 10500, dueDate: '2026-11-04', overdue: false },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `Pago ${i}`, toPay: 10, dueDate: '2026-11-10', overdue: false })),
  ]
  const t = formatear('get_upcoming_payments', {
    ok: true, period: 'Q38', today: '2026-11-04', totalToPayText: '$26,050.00 por pagar en Q38', count: 14, payments, truncated: true,
    creditInstallments: [{ credit: 'Coche', installment: '3/12', amount: 2500, dueDate: '2026-11-08', overdue: false }],
  })
  const filas = t.split('\n')
  check('cabeza: el total por pagar', filas[0] === '$26,050.00 por pagar en Q38.', filas[0])
  check('vencido lo marca', filas[1] === '• Luz — $800.00 (vencido, 1 nov)', filas[1])
  check('el de hoy dice "hoy"', filas[2] === '• Renta — $10,500.00 (hoy)', filas[2])
  check('hasta 10 pagos y "• y 4 más" (14 en total)', filas.filter(f => /^• (Luz|Renta|Pago)/.test(f)).length === 10 && filas.includes('• y 4 más'), t)
  check('el abono de credito al final', filas.at(-1) === '• Abono Coche 3/12 — $2,500.00 (8 nov)', filas.at(-1))
  const nada = formatear('get_upcoming_payments', { ok: true, period: 'Q38', payments: [], creditInstallments: [] })
  check('sin pagos lo dice', nada === 'No hay pagos pendientes en Q38.', nada)
}

console.log('\n=== E: get_liquidity ===')
{
  const t = formatear('get_liquidity', {
    ok: true, cutDate: '2026-11-02', cash: 15000, remainingToPay: 9000, available: 6000,
    accounts: [{ account: 'BBVA', amount: 12000 }, { account: 'Efectivo', amount: 3000 }, { account: 'Vacia', amount: 0 }],
  })
  check('efectivo, por pagar y lo que queda', t.split('\n')[0] === 'En cuentas tienes $15,000.00 (corte del 2 nov). Por pagar: $9,000.00; quedan $6,000.00.', t.split('\n')[0])
  check('las cuentas con saldo, sin las de cero', t.includes('• BBVA — $12,000.00') && t.includes('• Efectivo — $3,000.00') && !t.includes('Vacia'), t)
}

console.log('\n=== F: lo que no sirve no se formatea ===')
{
  check('ok:false -> null (no se presenta un error como respuesta)', formatear('list_budget_lines', { ok: false, error: 'No encontré el periodo Q99.' }) === null)
  check('herramienta sin plantilla -> null', formatear('list_categories', { ok: true }) === null && !tienePlantilla('list_categories'))
  check('resultado raro no truena -> null', formatear('search_transactions', { ok: true, transactions: [null] }) === null)
  check('resultado null -> null', formatear('get_liquidity', null) === null)
  check('las cinco herramientas tienen plantilla', ['list_budget_lines', 'search_transactions', 'get_money_status', 'get_upcoming_payments', 'get_liquidity'].every(tienePlantilla))
  check('fechaCorta de una fecha ISO', fechaCorta('2026-12-25', '2026-11-04') === '25 dic', fechaCorta('2026-12-25', '2026-11-04'))
}

console.log(`\n${pass} pasaron, ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)
