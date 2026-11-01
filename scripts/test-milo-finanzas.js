// Paridad de la cuenta de dinero entre el bot y el dashboard.
//
// src/lib/finanzas-quincena.js es una copia CommonJS de la matematica que vive
// en TypeScript dentro del dashboard (presupuesto-totales.ts,
// real-transacciones.ts y el GET de /api/presupuestos y /api/transacciones).
// Milo contesta "cuanto me queda" con esa copia; el panel "¿Cuadra tu dinero?"
// con la original. Si las dos se separan, Milo y el dashboard dicen numeros
// distintos de la misma quincena y nadie sabe a cual creerle.
//
// Esta prueba corre las MISMAS entradas por las dos versiones y exige el mismo
// resultado al centavo:
//   1. Las cuatro funciones puras, con casos fijos y con 300 quincenas
//      generadas al azar (semilla fija).
//   2. La carga completa: las rutas del dashboard (GET /api/presupuestos,
//      GET /api/transacciones, GET /api/liquidez) contra cargarQuincena del
//      bot, las dos sobre el mismo doble de Prisma. Q38 trae tres cortes de
//      liquidez, asi que tambien se compara CUAL corte elige cada lado.
//   3. Las utilidades y frases copiadas (formatMXN, diasEntre,
//      DIAS_CORTE_VIEJO, el titular y "Contra tu presupuesto") contra el
//      codigo real del dashboard: utils.ts, useResumenQuincena.ts y el
//      componente CuadraTuDinero.tsx renderizado a texto.
//
// La TS se transpila al vuelo con el `typescript` de la raiz, como en
// scripts/test-cuadre.js. Sin red, sin Postgres.

process.env.TZ = 'America/Mexico_City'

const path = require('path')
const { usarPrisma, requireDashboard, cuadreSegunDashboard, textosDelPanel } = require('./dashboard-ts')
const { crearFakePrisma } = require('./fake-prisma')
const { datosMilo } = require('./fixture-milo')

const RAIZ = path.join(__dirname, '..')
const TS = requireDashboard('lib/presupuesto-totales.ts')
const JS = require(path.join(RAIZ, 'src', 'lib', 'finanzas-quincena.js'))

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}
const centavos = n => Math.round(Number(n) * 100)
const igual = (a, b) => centavos(a) === centavos(b)

function mismoCuadre(a, b) {
  if (a === null || b === null) return a === b
  return ['ingresos', 'comprometido', 'teorico', 'real', 'delta', 'enCuentas', 'porPagar'].every(k => igual(a[k], b[k])) &&
    a.cuadra === b.cuadra && a.mejor === b.mejor
}

function linea(tipo, montoEfectivo, real, pendiente = 0, estadoLinea = 'Abierta') {
  const excedido = real > montoEfectivo ? Number((real - montoEfectivo).toFixed(2)) : 0
  return { categoria: { tipo }, montoEfectivo, real, pendiente, estadoLinea, excedido }
}

function compararPuras(etiqueta, entrada) {
  const { presupuestos, ingresosTotales, gastoTotal, liquidezTotal } = entrada
  const ok =
    igual(TS.calcularFaltaPorPagar(presupuestos), JS.calcularFaltaPorPagar(presupuestos)) &&
    igual(TS.calcularLibreSinAsignar(ingresosTotales, presupuestos, 123.45), JS.calcularLibreSinAsignar(ingresosTotales, presupuestos, 123.45)) &&
    igual(TS.calcularLibreDeQuincena(entrada), JS.calcularLibreDeQuincena(entrada)) &&
    mismoCuadre(TS.calcularCuadre(entrada), JS.calcularCuadre(entrada))
  if (etiqueta) check(etiqueta, ok, JSON.stringify({ ts: TS.calcularCuadre(entrada), js: JS.calcularCuadre(entrada) }))
  return ok
}

// Generador con semilla: la misma corrida siempre prueba las mismas quincenas.
function rng(semilla) {
  let s = semilla >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

async function main() {
  console.log('\n[1] Funciones puras: mismos casos, mismo resultado')
  const q38 = [
    linea('Ingreso', 27611.13, 27611.13),
    linea('Gasto', 12000, 6000),
    linea('Gasto', 8000, 2500, 500),
    linea('Gasto', 1500, 1813),
    linea('Gasto', 15505.5, 0),
    linea('Gasto', 900, 0, 0, 'Cancelada'),
    linea('Ahorro', 2000, 0),
  ]
  compararPuras('Q38 de test-cuadre con corte', { ingresosTotales: 27611.13, gastoTotal: 10582, presupuestos: q38, liquidezTotal: 17886.14 })
  compararPuras('sin corte (null en las dos)', { ingresosTotales: 27611.13, gastoTotal: 10582, presupuestos: q38, liquidezTotal: null })
  compararPuras('corte en $0 SI es corte', { ingresosTotales: 5000, gastoTotal: 0, presupuestos: q38, liquidezTotal: 0 })
  compararPuras('quincena vacia', { ingresosTotales: 0, gastoTotal: 0, presupuestos: [], liquidezTotal: 1000 })
  compararPuras('excedida + cancelada + pendiente', {
    ingresosTotales: 10000, gastoTotal: 9000,
    presupuestos: [linea('Gasto', 1000, 2500, 800), linea('Gasto', 3000, 0, 0, 'Cancelada'), linea('Gasto', 4000, 4000, 4000), linea('Ahorro', 500, -200)],
    liquidezTotal: 6000,
  })
  compararPuras('Absorbida si cuenta', {
    ingresosTotales: 8000, gastoTotal: 3000,
    presupuestos: [linea('Gasto', 2000, 3000, 0, 'Absorbida'), linea('Gasto', 1000, 0, 0, 'Cumplida')],
    liquidezTotal: 4000,
  })

  const azar = rng(38)
  const tipos = ['Gasto', 'Gasto', 'Gasto', 'Ingreso', 'Ahorro']
  const estados = ['Abierta', 'Abierta', 'Abierta', 'Cancelada', 'Cumplida', 'Absorbida']
  let iguales = 0
  for (let i = 0; i < 300; i++) {
    const n = Math.floor(azar() * 12)
    const ps = []
    for (let j = 0; j < n; j++) {
      const ef = Math.round(azar() * 2000000) / 100
      const real = Math.round(azar() * 2500000) / 100 * (azar() < 0.2 ? 0 : 1)
      const pend = azar() < 0.3 ? Math.round(azar() * real * 100) / 100 : 0
      ps.push(linea(tipos[Math.floor(azar() * tipos.length)], ef, real, pend, estados[Math.floor(azar() * estados.length)]))
    }
    const entrada = {
      ingresosTotales: Math.round(azar() * 6000000) / 100,
      gastoTotal: Math.round(azar() * 6000000) / 100,
      presupuestos: ps,
      liquidezTotal: azar() < 0.15 ? null : Math.round(azar() * 5000000) / 100,
    }
    if (compararPuras(null, entrada)) iguales++
    else console.log('  difiere:', JSON.stringify(entrada))
  }
  check('300 quincenas al azar dan lo mismo en TS y JS', iguales === 300, `${iguales}/300`)

  console.log('\n[2] Real por linea: neteo de retiros igual que real-transacciones.ts')
  {
    const { tablas } = datosMilo()
    const fake = crearFakePrisma(tablas)
    usarPrisma(fake)
    const { calcularRealPorLinea } = requireDashboard('lib/real-transacciones.ts')
    const ids = tablas.presupuesto.map(p => p.id)
    const mapaTs = await calcularRealPorLinea(ids)
    const mapaJs = await JS.calcularRealPorLinea(fake, ids)
    const todos = ids.every(id => {
      const a = mapaTs.get(id) ?? { real: 0, pendiente: 0 }
      const b = mapaJs.get(id) ?? { real: 0, pendiente: 0 }
      return igual(a.real, b.real) && igual(a.pendiente, b.pendiente)
    })
    check('real y pendiente iguales en cada linea', todos)
    check('el ahorro con retiro netea: 500 - 300 = 200', igual(mapaJs.get(107).real, 200), mapaJs.get(107)?.real)
    check('la parte pendiente del super es 500', igual(mapaJs.get(103).pendiente, 500), mapaJs.get(103)?.pendiente)
  }

  console.log('\n[3] Carga completa: rutas del dashboard contra cargarQuincena del bot')
  {
    const { tablas, esperado } = datosMilo()
    const fake = crearFakePrisma(tablas)

    for (const quincenaId of [38, 37]) {
      const dash = await cuadreSegunDashboard(fake, quincenaId)
      check(`Q${quincenaId}: las rutas del dashboard responden 200`, dash.status.every(st => st === 200), dash.status.join('/'))
      const presRes = { body: dash.presupuestos }
      const txRes = { body: { totales: dash.totales } }
      const entradaDashboard = dash.entrada
      const cuadreDashboard = dash.cuadre

      const bot = await JS.cargarQuincena(fake, quincenaId)
      const cuadreBot = JS.calcularCuadre({
        ingresosTotales: bot.ingresosTotales, gastoTotal: bot.gastoTotal,
        presupuestos: bot.presupuestos, liquidezTotal: bot.liquidez ? bot.liquidez.total : null,
      })

      const porId = new Map(bot.presupuestos.map(p => [p.id, p]))
      const lineasIguales = presRes.body.every(d => {
        const b = porId.get(d.id)
        return b && igual(d.real, b.real) && igual(d.pendiente, b.pendiente) &&
          igual(d.excedido, b.excedido) && igual(d.montoEfectivo, b.montoEfectivo)
      }) && presRes.body.length === bot.presupuestos.length
      check(`Q${quincenaId}: real/pendiente/excedido/efectivo iguales por linea`, lineasIguales)
      check(`Q${quincenaId}: totales de transacciones iguales`,
        igual(txRes.body.totales.Ingreso, bot.totales.Ingreso) && igual(txRes.body.totales.Gasto, bot.totales.Gasto) &&
        igual(txRes.body.totales.Ahorro, bot.totales.Ahorro),
        JSON.stringify({ dash: txRes.body.totales, bot: bot.totales }))
      check(`Q${quincenaId}: mismo cuadre`, mismoCuadre(cuadreDashboard, cuadreBot),
        JSON.stringify({ dash: cuadreDashboard, bot: cuadreBot }))
      check(`Q${quincenaId}: el mismo corte de liquidez en los dos lados`,
        (bot.liquidez?.snapshot?.id ?? null) === dash.corteId && dash.corteId === (quincenaId === 38 ? 1 : null),
        JSON.stringify({ dash: dash.corteId, bot: bot.liquidez?.snapshot?.id ?? null }))
      check(`Q${quincenaId}: mismo "segun tu presupuesto"`,
        igual(TS.calcularLibreDeQuincena(entradaDashboard), JS.calcularLibreDeQuincena(bot)))

      if (quincenaId === 38) {
        check('Q38: te faltan $9,075.39', igual(cuadreBot.real, esperado.real), cuadreBot.real)
        check('Q38: $17,886.14 en cuentas', igual(cuadreBot.enCuentas, esperado.enCuentas), cuadreBot.enCuentas)
        check('Q38: $26,961.53 por pagar (sin la cancelada)', igual(cuadreBot.porPagar, esperado.porPagar), cuadreBot.porPagar)
        check('Q38: segun tu presupuesto falta $9,394.37', igual(cuadreBot.teorico, esperado.teorico), cuadreBot.teorico)
        check('Q38: vas $318.98 mejor', igual(cuadreBot.delta, esperado.delta) && cuadreBot.mejor, cuadreBot.delta)
        check('Q38: la frase es la del panel',
          JS.titularCuadre(cuadreBot.real) === 'Te faltan $9,075.39 para cubrir lo que te queda por pagar esta quincena.',
          JS.titularCuadre(cuadreBot.real))
        check('Q38: "Vas $318.98 mejor"', JS.textoContra(cuadreBot) === 'Vas $318.98 mejor', JS.textoContra(cuadreBot))
      } else {
        check('Q37: sin corte -> sin cuadre en los dos lados', cuadreDashboard === null && cuadreBot === null)
      }
    }
  }

  console.log('\n[4] Utilidades y frases copiadas, contra el codigo del dashboard')
  {
    const utils = requireDashboard('lib/utils.ts')
    const resumen = requireDashboard('lib/useResumenQuincena.ts')
    const panel = requireDashboard('components/resumen/CuadraTuDinero.tsx')

    const montos = [0, -0.004, 0.005, 1, -1, 1234, -9075.39, 17886.14, 26961.53, 1e6 + 0.1, '318.98', null, undefined]
    const difMXN = montos.filter(m => JS.formatMXN(m) !== utils.formatMXN(m))
    check('formatMXN igual que utils.ts en todos los casos', difMXN.length === 0, JSON.stringify(difMXN))
    check('formatMXN da el formato del panel', JS.formatMXN(-9075.39) === '-$9,075.39', JS.formatMXN(-9075.39))

    const fechas = ['2026-10-28T15:00:00.000Z', '2026-11-01', '2026-11-05', '2026-02-27', '2026-03-02', '2024-02-28', '2024-03-01', '2026-12-31', '2027-01-01']
    const difDias = []
    for (const a of fechas) for (const b of fechas) if (JS.diasEntre(a, b) !== resumen.diasEntre(a, b)) difDias.push([a, b])
    check('diasEntre igual que useResumenQuincena.ts (al reves, bisiestos, cambio de año)', difDias.length === 0, JSON.stringify(difDias))
    check('DIAS_CORTE_VIEJO igual que CuadraTuDinero.tsx', JS.DIAS_CORTE_VIEJO === panel.DIAS_CORTE_VIEJO, `${JS.DIAS_CORTE_VIEJO} vs ${panel.DIAS_CORTE_VIEJO}`)

    // El panel renderizado: alguno de sus elementos tiene que decir EXACTAMENTE
    // la frase del bot. Las tres ramas de "Contra tu presupuesto" y las dos
    // del titular.
    const casos = [
      ['falta y vas mejor', { ingresos: 100, comprometido: 200, teorico: -100, real: -50, delta: 50, enCuentas: 10, porPagar: 60, cuadra: false, mejor: true }],
      ['sobra y vas peor', { ingresos: 300, comprometido: 100, teorico: 200, real: 150, delta: -50, enCuentas: 200, porPagar: 50, cuadra: false, mejor: false }],
      ['cuadra', { ingresos: 300, comprometido: 100, teorico: 200, real: 200, delta: 0, enCuentas: 250, porPagar: 50, cuadra: true, mejor: false }],
    ]
    for (const [nombre, cuadre] of casos) {
      const textos = textosDelPanel(cuadre)
      check(`titular igual que el panel (${nombre})`, textos.includes(JS.titularCuadre(cuadre.real)), JSON.stringify(textos.filter(t => /^Te /.test(t))))
      check(`"Contra tu presupuesto" igual que el panel (${nombre})`, textos.includes(JS.textoContra(cuadre)), `bot "${JS.textoContra(cuadre)}"`)
    }
  }

  console.log(`\n${pass} OK, ${fail} fallas`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
