// Pruebas del resumen diario (src/resumenDiario.js), sin red ni Postgres:
// el texto (formatearResumen es puro) y la autenticacion del cron.

process.env.TELEGRAM_BOT_TOKEN = 'test:token-del-bot'
const crypto = require('crypto')
const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

// El modulo carga src/lib/prisma.js y miloTools al importarse; aqui no se usan.
const pp = require.resolve(path.join(SRC, 'lib', 'prisma.js'))
require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: {} }

const { formatearResumen, autorizado, tokenEsperado } = require(path.join(SRC, 'resumenDiario.js'))

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const HOY = '2026-11-01'
const gastos = [
  { monto: 600, descripcion: 'super', presupuestoId: 31, presupuesto: { descripcion: 'Super' } },
  { monto: 150, descripcion: 'tortillas', presupuestoId: 31, presupuesto: { descripcion: 'Super' } },
  { monto: 400, descripcion: 'tacos', presupuestoId: 32, presupuesto: { descripcion: 'Diversion' } },
  { monto: 250, descripcion: 'piñata', presupuestoId: null, presupuesto: null },
]
const estadoSobra = { ok: true, period: 'Q38', verdict: 'sobra', amount: 9075.39, toPay: 26961.53, hasCut: true, cutDate: '2026-11-01', cutIsOld: false, perDay: 1500, daysLeft: 11 }

console.log('\n=== R1: gasto del dia, desglose y sin clasificar ===')
const t1 = formatearResumen({ hoy: HOY, gastos, estado: estadoSobra })
check('dice el dia', /domingo, 1 de noviembre/.test(t1), t1.split('\n')[0])
check('total del dia', /Hoy gastaste \$1,400\.00\* \(4 gastos\)/.test(t1), t1)
check('desglose por linea, de mayor a menor', t1.indexOf('Super — $750.00 (2)') > -1 && t1.indexOf('Super') < t1.indexOf('Diversion') && t1.indexOf('Diversion') < t1.indexOf('Sin línea'), t1)
check('lo que quedo sin clasificar, con su nombre', /Quedó sin clasificar:\* 1 gasto por \$250\.00: «piñata»/.test(t1) && /vamos a entrenar/.test(t1), t1)
check('falta por cubrir', /Falta por cubrir:\* \$26,961\.53/.test(t1), t1)
check('te queda, segun tus cuentas', /Te queda \$9,075\.39\* _\(según tus cuentas, corte del 2026-11-01\)_/.test(t1), t1)

console.log('\n=== R2: el veredicto ===')
check('gasto <= ritmo diario -> vas bien', /🟢 \*Vas bien:\* te alcanza/.test(t1) && /quedan 11 días/.test(t1), t1)
const t2 = formatearResumen({ hoy: HOY, gastos, estado: { ...estadoSobra, perDay: 500 } })
check('gasto > ritmo diario -> te alcanza, pero cuidado', /🟡 \*Te alcanza, pero cuidado:\*/.test(t2), t2)
const t3 = formatearResumen({ hoy: HOY, gastos, estado: { ...estadoSobra, verdict: 'falta', amount: 9394.37, perDay: null } })
check('falta -> no te alcanza', /Te faltan \$9,394\.37/.test(t3) && /🔴 \*No te alcanza con lo que tienes:\*/.test(t3), t3)
const t4 = formatearResumen({ hoy: HOY, gastos, estado: { ...estadoSobra, hasCut: false, perDay: null } })
check('sin corte -> segun tu presupuesto, y pide capturarlo', /según tu presupuesto/.test(t4) && /Captura tu corte de cuentas/.test(t4), t4)
const t5 = formatearResumen({ hoy: HOY, gastos, estado: { ...estadoSobra, cutIsOld: true, cutAgeDays: 9 } })
check('corte viejo -> lo advierte', /hace 9 días/.test(t5), t5)

console.log('\n=== R3: dias raros ===')
const t6 = formatearResumen({ hoy: HOY, gastos: [], estado: estadoSobra })
check('sin gastos', /Hoy no registraste gastos/.test(t6) && !/sin clasificar/.test(t6), t6)
const t7 = formatearResumen({ hoy: HOY, gastos: gastos.slice(0, 3), estado: estadoSobra })
check('todo clasificado', /Todo quedó clasificado/.test(t7), t7)
const t8 = formatearResumen({ hoy: HOY, gastos, estado: { ok: false, error: 'x' } })
check('si falla el estado, igual manda lo del dia', /Hoy gastaste/.test(t8) && /No pude calcular cuánto te queda/.test(t8), t8)
const muchos = Array.from({ length: 8 }, (_, i) => ({ monto: 10, descripcion: `cosa${i}`, presupuestoId: null }))
const t9 = formatearResumen({ hoy: HOY, gastos: muchos, estado: estadoSobra })
check('lista hasta 5 sin clasificar y dice cuantos mas', /«cosa4» y 3 más/.test(t9) && !/cosa5/.test(t9), t9)
const t10 = formatearResumen({ hoy: HOY, gastos: [{ monto: 5, descripcion: 'a_b*c', presupuestoId: null }], estado: estadoSobra })
check('escapa el markdown de las descripciones', t10.includes('«a\\_b\\*c»'), t10)

console.log('\n=== R4: autenticacion del cron ===')
const bueno = crypto.createHash('sha256').update('cron:test:token-del-bot').digest('hex')
check('el token esperado es sha256("cron:" + token)', tokenEsperado() === bueno)
check('acepta el bueno', autorizado(bueno))
check('rechaza sin header', !autorizado(undefined))
check('rechaza uno incorrecto', !autorizado(bueno.replace(/.$/, c => (c === '0' ? '1' : '0'))))
check('rechaza el token del bot en claro', !autorizado('test:token-del-bot'))
delete process.env.TELEGRAM_BOT_TOKEN
check('sin TELEGRAM_BOT_TOKEN rechaza todo', !autorizado(bueno))

console.log(`\n${pass} pasaron, ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)
