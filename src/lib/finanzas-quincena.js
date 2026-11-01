// La cuenta de dinero de una quincena, la MISMA que hace el dashboard.
//
// Copia fiel (CommonJS, sin tipos) de:
//   - dashboard/src/lib/presupuesto-totales.ts  (calcularFaltaPorPagar,
//     calcularLibreSinAsignar, calcularLibreDeQuincena, calcularCuadre)
//   - dashboard/src/lib/cierre-quincena.ts      (cuentaParaAgregados)
//   - dashboard/src/lib/real-transacciones.ts   (calcularRealPorLinea)
//   - dashboard/src/app/api/presupuestos/route.ts (GET: real, pendiente,
//     excedido y montoEfectivo por linea)
//   - dashboard/src/app/api/transacciones/route.ts (GET: totales por tipo)
//   - dashboard/src/lib/liquidez.ts             (sumLiquidez)
//   - dashboard/src/lib/useResumenQuincena.ts   (diasEntre)
//   - dashboard/src/lib/utils.ts                (formatMXN)
//   - dashboard/src/components/resumen/CuadraTuDinero.tsx (DIAS_CORTE_VIEJO
//     y las frases del panel: titular y "Contra tu presupuesto")
//
// Las utilidades y las frases tambien se comparan contra el original: la
// prueba carga utils.ts y useResumenQuincena.ts, y renderiza CuadraTuDinero
// con un JSX de juguete para leer el texto que de verdad muestra el panel.
//
// Por que una copia y no un import: el bot es CommonJS sin paso de build y el
// dashboard es TypeScript de Next. Para que la copia no se desvie,
// scripts/test-milo-finanzas.js corre las mismas entradas por las dos
// versiones (la TS transpilada al vuelo) y exige el mismo resultado al
// centavo. Si cambias una formula aqui o alla, ese test truena en CI hasta que
// las dos digan lo mismo.
//
// Sin dependencias: las funciones de carga reciben `prisma` como parametro,
// asi las pruebas les pasan un doble.

// ---- Reglas por linea ------------------------------------------------------

// Una linea Cancelada nunca cuenta: "nunca paso".
function cuentaParaAgregados(p) {
  return p.estadoLinea !== 'Cancelada'
}

// El tipo lo manda la categoria; `p.tipo` (copia en la fila) solo es respaldo.
function tipoDeLinea(p) {
  return p?.categoria?.tipo ?? p?.tipo ?? 'Gasto'
}

// ---- presupuesto-totales.ts -------------------------------------------------

function calcularFaltaPorPagar(presupuestos) {
  return presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.pendiente + Math.max(p.montoEfectivo - p.real, 0), 0)
}

function calcularLibreSinAsignar(ingresos, presupuestos, gastosNoCubiertos) {
  const gastoLineas = presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const presupTotal = gastoLineas.reduce((s, p) => s + p.montoEfectivo, 0)
  const totalExcedido = gastoLineas.reduce((s, p) => s + (p.excedido ?? 0), 0)
  const ahorroComprometido = presupuestos
    .filter(p => p.categoria.tipo === 'Ahorro' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.montoEfectivo, 0)
  const totalComprometido = presupTotal + gastosNoCubiertos + totalExcedido + ahorroComprometido
  return ingresos - totalComprometido
}

function calcularLibreDeQuincena({ ingresosTotales, gastoTotal, presupuestos }) {
  const realEnLineas = presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.real, 0)
  return calcularLibreSinAsignar(ingresosTotales, presupuestos, Math.max(gastoTotal - realEnLineas, 0))
}

// null sin corte de liquidez: sin esa foto no hay lado "real".
function calcularCuadre(entrada) {
  if (entrada.liquidezTotal == null) return null
  const teorico = calcularLibreDeQuincena(entrada)
  const porPagar = calcularFaltaPorPagar(entrada.presupuestos)
  const real = entrada.liquidezTotal - porPagar
  const delta = real - teorico
  return {
    ingresos: entrada.ingresosTotales,
    comprometido: entrada.ingresosTotales - teorico,
    teorico,
    real,
    delta,
    enCuentas: entrada.liquidezTotal,
    porPagar,
    cuadra: Math.abs(delta) < 1,
    mejor: delta > 0,
  }
}

// ---- real-transacciones.ts --------------------------------------------------

// Mismo neteo que calcularRealPorLinea: Retiro resta, todo lo demas suma. Recibe
// las filas de un groupBy por ['presupuestoId', 'estatus', 'direccion'].
function acumularRealPorLinea(filas) {
  const mapa = new Map()
  for (const fila of filas) {
    const id = fila.presupuestoId
    if (id == null) continue
    const monto = Number(fila._sum?.monto ?? 0)
    const neto = fila.direccion === 'Retiro' ? -monto : monto
    const acumulado = mapa.get(id) ?? { real: 0, pendiente: 0 }
    acumulado.real += neto
    if (fila.estatus === 'Pendiente') acumulado.pendiente += neto
    mapa.set(id, acumulado)
  }
  return mapa
}

async function calcularRealPorLinea(prisma, presupuestoIds) {
  if (!presupuestoIds.length) return new Map()
  const filas = await prisma.transaccion.groupBy({
    by: ['presupuestoId', 'estatus', 'direccion'],
    where: { presupuestoId: { in: presupuestoIds } },
    _sum: { monto: true },
  })
  return acumularRealPorLinea(filas)
}

// ---- api/presupuestos/route.ts (GET) ---------------------------------------

function montoEfectivo(p) {
  return p.montoRevisado != null ? Number(p.montoRevisado) : Number(p.montoPresupuestado)
}

// Cada linea con lo que el GET de /api/presupuestos le agrega: real,
// pendiente, excedido (redondeado a centavos como alla) y montoEfectivo.
function armarLineas(presupuestos, realMap) {
  return presupuestos.map(p => {
    const { real, pendiente } = realMap.get(p.id) ?? { real: 0, pendiente: 0 }
    const efectivo = montoEfectivo(p)
    const excedido = real > efectivo ? Number((real - efectivo).toFixed(2)) : 0
    return { ...p, real, pendiente, excedido, montoEfectivo: efectivo }
  })
}

// Lo que todavia sale de una linea de Gasto: lo registrado sin pagar mas lo
// comprometido sin registrar. Es el termino por linea de calcularFaltaPorPagar.
function porPagarDeLinea(p) {
  if (tipoDeLinea(p) !== 'Gasto' || !cuentaParaAgregados(p)) return 0
  return p.pendiente + Math.max(p.montoEfectivo - p.real, 0)
}

// ---- api/transacciones/route.ts (GET totales) ------------------------------

// Recibe las filas de un groupBy por ['tipo', 'estatus', 'direccion'].
function totalesDeTransacciones(filas) {
  const totales = { Gasto: 0, Ingreso: 0, Ahorro: 0, GastoPagado: 0, IngresoPagado: 0 }
  for (const row of filas) {
    const monto = Number(row._sum?.monto ?? 0)
    if (row.tipo === 'Ahorro') totales.Ahorro += row.direccion === 'Retiro' ? -monto : monto
    else if (row.tipo === 'Gasto') totales.Gasto += monto
    else if (row.tipo === 'Ingreso') totales.Ingreso += monto
    if (row.tipo === 'Gasto' && row.estatus === 'Pagado') totales.GastoPagado += monto
    if (row.tipo === 'Ingreso' && row.estatus === 'Pagado') totales.IngresoPagado += monto
  }
  return totales
}

// ---- liquidez.ts / useResumenQuincena.ts -----------------------------------

function sumLiquidez(montos) {
  return (montos || []).reduce((total, m) => total + (Number(m.monto) || 0), 0)
}

// Dias completos entre dos fechas YYYY-MM-DD (o ISO), nunca negativo.
function diasEntre(desde, hasta) {
  const aUtc = v => {
    const [y, m, d] = String(v).split('T')[0].split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.max(Math.floor((aUtc(hasta) - aUtc(desde)) / 86400000), 0)
}

// A partir de cuantos dias el corte ya no sirve para un veredicto confiable
// (DIAS_CORTE_VIEJO en dashboard/src/components/resumen/CuadraTuDinero.tsx).
const DIAS_CORTE_VIEJO = 3

function fechaISO(valor) {
  if (!valor) return null
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  return String(valor).slice(0, 10)
}

// ---- Carga de una quincena -------------------------------------------------

// Los mismos datos que junta useResumenQuincena para una quincena: lineas
// con su real (GET /api/presupuestos?quincenaId), totales de transacciones
// (GET /api/transacciones?quincenaId) y el corte de liquidez mas reciente de
// esa quincena (GET /api/liquidez?quincenaId, primer elemento).
// Las lineas de una quincena con su real/pendiente/excedido, sin filtros: el
// equivalente a GET /api/presupuestos?quincenaId. `where` extra opcional para
// quien solo quiere una parte (una categoria, un texto); los agregados de
// dinero siempre deben pedirse sin filtro.
async function cargarLineasDeQuincena(prisma, quincenaId, whereExtra = {}) {
  const crudos = await prisma.presupuesto.findMany({
    where: { quincenaId, ...whereExtra },
    include: { categoria: true },
    orderBy: [{ categoriaId: 'asc' }, { id: 'asc' }],
  })
  const realMap = await calcularRealPorLinea(prisma, crudos.map(p => p.id))
  return armarLineas(crudos, realMap)
}

async function cargarQuincena(prisma, quincenaId) {
  const [presupuestosCrudos, filasTotales, snapshot] = await Promise.all([
    prisma.presupuesto.findMany({
      where: { quincenaId },
      include: { categoria: true },
      orderBy: [{ categoriaId: 'asc' }, { id: 'asc' }],
    }),
    prisma.transaccion.groupBy({
      by: ['tipo', 'estatus', 'direccion'],
      where: { quincenaId },
      _sum: { monto: true },
    }),
    prisma.liquidezSnapshot.findFirst({
      where: { quincenaId },
      include: { montos: { include: { cuenta: true } } },
      orderBy: [{ fechaCorte: 'desc' }, { fechaRegistro: 'desc' }, { id: 'desc' }],
    }),
  ])

  const realMap = await calcularRealPorLinea(prisma, presupuestosCrudos.map(p => p.id))
  const presupuestos = armarLineas(presupuestosCrudos, realMap)
  const totales = totalesDeTransacciones(filasTotales)

  return {
    presupuestos,
    totales,
    ingresosTotales: totales.Ingreso,
    gastoTotal: totales.Gasto,
    liquidez: snapshot
      ? { total: sumLiquidez(snapshot.montos), fechaCorte: fechaISO(snapshot.fechaCorte), snapshot }
      : null,
  }
}

// ---- Formato -----------------------------------------------------------------

// Igual que formatMXN de dashboard/src/lib/utils.ts.
function formatMXN(monto) {
  const n = typeof monto === 'string' ? parseFloat(monto) : (monto ?? 0)
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)
}

// La frase del panel "¿Cuadra tu dinero?" (Titular en CuadraTuDinero.tsx).
function titularCuadre(real) {
  return real < 0
    ? `Te faltan ${formatMXN(Math.abs(real))} para cubrir lo que te queda por pagar esta quincena.`
    : `Te sobran ${formatMXN(Math.abs(real))} después de pagar todo lo pendiente.`
}

// "Contra tu presupuesto" (textoContra en CuadraTuDinero.tsx), con la misma
// palomita: scripts/test-milo-finanzas.js renderiza el componente y compara.
function textoContra(cuadre) {
  return cuadre.cuadra ? '✓ Cuadra' : `Vas ${formatMXN(Math.abs(cuadre.delta))} ${cuadre.mejor ? 'mejor' : 'peor'}`
}

module.exports = {
  cuentaParaAgregados,
  tipoDeLinea,
  calcularFaltaPorPagar,
  calcularLibreSinAsignar,
  calcularLibreDeQuincena,
  calcularCuadre,
  acumularRealPorLinea,
  calcularRealPorLinea,
  montoEfectivo,
  armarLineas,
  porPagarDeLinea,
  totalesDeTransacciones,
  sumLiquidez,
  diasEntre,
  DIAS_CORTE_VIEJO,
  fechaISO,
  cargarLineasDeQuincena,
  cargarQuincena,
  formatMXN,
  titularCuadre,
  textoContra,
}
