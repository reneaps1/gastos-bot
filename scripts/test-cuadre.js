// Pruebas de "¿Cuadra tu dinero?" (calcularCuadre), la cuenta que comparten
// Presupuesto > Tabla y el Inicio del dashboard.
//
// Por que existe: antes cada pantalla tenia su propia formula de "¿me
// alcanza?" y terminaron difiriendo $269 (un gasto de "lamparas"). Ahora las
// dos llaman a la misma funcion; estas pruebas fijan su matematica para que
// nadie la cambie en un lado pensando que solo afecta al otro.
//
// La funcion vive en TypeScript dentro del dashboard. No se agrega ninguna
// dependencia: se transpila al vuelo con el `typescript` que ya instala la
// raiz (npm ci), y los imports `@/lib/...` se resuelven a dashboard/src/lib.
// Sin red, sin Postgres.

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const DASHBOARD_SRC = path.join(__dirname, '..', 'dashboard', 'src')

// Transpila cualquier .ts que se requiera (solo quita tipos, no valida).
require.extensions['.ts'] = function (module, filename) {
  const fuente = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

// El alias `@/` del tsconfig del dashboard.
const resolverOriginal = Module._resolveFilename
Module._resolveFilename = function (request, ...resto) {
  if (request.startsWith('@/')) {
    return resolverOriginal.call(this, path.join(DASHBOARD_SRC, request.slice(2)) + '.ts', ...resto)
  }
  return resolverOriginal.call(this, request, ...resto)
}

const {
  calcularCuadre,
  calcularLibreDeQuincena,
  calcularFaltaPorPagar,
  calcularLibreSinAsignar,
} = require(path.join(DASHBOARD_SRC, 'lib', 'presupuesto-totales.ts'))

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}
const centavos = n => Math.round(n * 100)
const igual = (a, b) => centavos(a) === centavos(b)

function linea(tipo, montoEfectivo, real, pendiente = 0, estadoLinea = 'Abierta') {
  const excedido = real > montoEfectivo ? Number((real - montoEfectivo).toFixed(2)) : 0
  return { categoria: { tipo }, montoEfectivo, real, pendiente, estadoLinea, excedido }
}

// Quincena tipo Q38: sueldo cobrado, lineas de gasto a medio pagar, una
// excedida, una pendiente de pago, una cancelada (que no debe contar nunca) y
// un ahorro planeado.
const presupuestosQ38 = [
  linea('Ingreso', 27611.13, 27611.13),
  linea('Gasto', 12000, 6000),               // falta 6000
  linea('Gasto', 8000, 2500, 500),           // falta 500 pendiente + 5500 sin registrar
  linea('Gasto', 1500, 1813),                // excedida por 313, no falta nada
  linea('Gasto', 15505.5, 0),                // nada registrado todavia
  linea('Gasto', 900, 0, 0, 'Cancelada'),    // nunca cuenta
  linea('Ahorro', 2000, 0),
]
const ingresosQ38 = 27611.13
const gastoSinLineaQ38 = 269            // "lamparas", sin partida
const realEnLineasQ38 = 6000 + 2500 + 1813
const gastoTotalQ38 = realEnLineasQ38 + gastoSinLineaQ38
const liquidezQ38 = 17886.14

console.log('\n[1] Con corte: las piezas cuadran entre si')
{
  const c = calcularCuadre({
    ingresosTotales: ingresosQ38, gastoTotal: gastoTotalQ38,
    presupuestos: presupuestosQ38, liquidezTotal: liquidezQ38,
  })
  check('devuelve un cuadre', c != null)
  check('delta = real - teorico', igual(c.delta, c.real - c.teorico), `${c.delta} vs ${c.real - c.teorico}`)
  check('porPagar = calcularFaltaPorPagar de la quincena',
    igual(c.porPagar, calcularFaltaPorPagar(presupuestosQ38)), c.porPagar)
  check('porPagar = 6000 + 6000 + 0 + 15505.50 (sin la cancelada)', igual(c.porPagar, 27505.5), c.porPagar)
  check('real = corte - porPagar', igual(c.real, liquidezQ38 - c.porPagar), c.real)
  check('enCuentas = corte', igual(c.enCuentas, liquidezQ38))
  check('ingresos = totales.Ingreso', igual(c.ingresos, ingresosQ38))
  check('comprometido = ingresos - teorico', igual(c.comprometido, c.ingresos - c.teorico))

  // Mismo calculo que tenia Tabla en linea antes de extraerlo: el teorico
  // es calcularLibreSinAsignar con el gasto sin linea derivado de totales.
  const teoricoLegacy = calcularLibreSinAsignar(ingresosQ38, presupuestosQ38, Math.max(gastoTotalQ38 - realEnLineasQ38, 0))
  check('teorico = formula previa de Tabla', igual(c.teorico, teoricoLegacy), `${c.teorico} vs ${teoricoLegacy}`)
  // presupuestado 37005.50 + sin linea 269 + excedido 313 + ahorro 2000
  check('teorico = 27611.13 - 39587.50', igual(c.teorico, 27611.13 - 39587.5), c.teorico)
  check('teorico = calcularLibreDeQuincena', igual(c.teorico, calcularLibreDeQuincena({
    ingresosTotales: ingresosQ38, gastoTotal: gastoTotalQ38, presupuestos: presupuestosQ38,
  })))
}

console.log('\n[2] Sin corte de liquidez no hay veredicto')
{
  const c = calcularCuadre({
    ingresosTotales: ingresosQ38, gastoTotal: gastoTotalQ38,
    presupuestos: presupuestosQ38, liquidezTotal: null,
  })
  check('liquidezTotal null -> null', c === null, JSON.stringify(c))
  const cero = calcularCuadre({
    ingresosTotales: ingresosQ38, gastoTotal: gastoTotalQ38,
    presupuestos: presupuestosQ38, liquidezTotal: 0,
  })
  check('un corte en $0 SI es un corte', cero != null && igual(cero.real, -cero.porPagar))
}

console.log('\n[3] Cuadra / mejor / peor')
{
  const base = { ingresosTotales: 10000, gastoTotal: 4000, presupuestos: [linea('Gasto', 6000, 4000)] }
  // teorico = 10000 - 6000 = 4000 ; porPagar = 2000
  const exacto = calcularCuadre({ ...base, liquidezTotal: 6000 })
  check('real = teorico -> cuadra', exacto.cuadra && igual(exacto.delta, 0), exacto.delta)
  const centavo = calcularCuadre({ ...base, liquidezTotal: 6000.99 })
  check('menos de $1 de diferencia -> cuadra', centavo.cuadra)
  const mejor = calcularCuadre({ ...base, liquidezTotal: 6500 })
  check('mas en cuentas -> mejor', !mejor.cuadra && mejor.mejor && igual(mejor.delta, 500), mejor.delta)
  const peor = calcularCuadre({ ...base, liquidezTotal: 5500 })
  check('menos en cuentas -> peor', !peor.cuadra && !peor.mejor && igual(peor.delta, -500), peor.delta)
}

console.log('\n[4] Las lineas que no son Gasto no mueven el por pagar')
{
  const soloGasto = [linea('Gasto', 1000, 200, 100)]
  const conOtras = [...soloGasto, linea('Ingreso', 5000, 0), linea('Ahorro', 700, 0), linea('Gasto', 999, 0, 0, 'Cancelada')]
  const a = calcularCuadre({ ingresosTotales: 5000, gastoTotal: 200, presupuestos: soloGasto, liquidezTotal: 3000 })
  const b = calcularCuadre({ ingresosTotales: 5000, gastoTotal: 200, presupuestos: conOtras, liquidezTotal: 3000 })
  check('porPagar igual con o sin Ingreso/Ahorro/Cancelada', igual(a.porPagar, b.porPagar) && igual(a.porPagar, 900), `${a.porPagar} / ${b.porPagar}`)
  check('el ahorro planeado si compromete en el teorico', igual(a.teorico - b.teorico, 700), `${a.teorico} / ${b.teorico}`)
}

console.log(`\n${pass} OK, ${fail} fallas`)
process.exit(fail > 0 ? 1 : 0)
