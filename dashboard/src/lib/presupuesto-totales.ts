import { cuentaParaAgregados } from '@/lib/cierre-quincena'

// Regla unica de que tipo de movimiento es una linea de presupuesto. Manda la
// categoria: `Presupuesto.tipo` es una copia que puede quedar desalineada (la
// API no impedia guardar una linea tipo:'Ingreso' con categoria de tipo
// 'Gasto'), y cuando eso pasa cada pantalla decidia distinto -- el forecast
// usaba un OR laxo (`p.tipo === X || categoria.tipo === X`) que contaba esa
// misma fila como Ingreso, mientras estos totales la contaban como Gasto.
// `p.tipo` solo se usa como respaldo cuando la categoria no viene incluida en
// la consulta.
export function tipoDeLinea(p: { tipo?: string; categoria?: { tipo?: string } | null }): string {
  return p.categoria?.tipo ?? p.tipo ?? 'Gasto'
}

export interface PresupuestoParaTotales {
  montoEfectivo: number
  real: number
  pendiente: number
  categoria: { tipo: string }
  estadoLinea: string
}

// Cuánto falta desembolsar de verdad para una quincena: lo ya registrado pero
// sin pagar (pendiente) más lo comprometido (montoEfectivo = Modificado si
// existe, si no el Original) que ni siquiera se ha registrado. Solo cuenta
// partidas de Gasto — Ingreso/Ahorro nunca se suman aquí. "Restante"
// (efectivo - real) no es suficiente: una partida 100% registrada como
// Pendiente muestra $0 de restante aunque se deba por completo. Una línea
// Cancelada nunca cuenta -- nunca va a pagarse porque nunca pasó.
//
// Ojo: esto mide EJECUCIÓN DE PRESUPUESTO por línea, en la quincena de esa
// línea — no mide caja. Una compra a crédito/MSI cuenta aquí completa en la
// quincena de la compra aunque el efectivo salga después. Para saber qué va
// a salir del banco EN una quincena, ver calcularPagosQuincena en
// `@/lib/pagos-quincena` (server-only, por eso vive en otro archivo — este
// módulo lo importan componentes de cliente y no puede traer Prisma).
export function calcularFaltaPorPagar(presupuestos: PresupuestoParaTotales[]): number {
  return presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.pendiente + Math.max(p.montoEfectivo - p.real, 0), 0)
}

export interface PresupuestoParaLibre {
  categoria: { tipo: string }
  estadoLinea: string
  montoEfectivo: number
  excedido: number
}

// Cuanto de tus ingresos reales de la quincena sigue sin comprometerse en
// ningun lado: ni en una linea de Gasto/Ahorro presupuestada, ni en un
// excedido sobre una linea ya presupuestada, ni en un gasto registrado sin
// presupuestoId. A diferencia de "ingresos - presupuestado" (estatico), este
// SI baja si te pasas de una linea y nadie traspasa para cubrirlo. Usa
// `excedido` tal cual lo manda GET /api/presupuestos (ya floored en 0 por
// linea), no lo recalcula.
export function calcularLibreSinAsignar(
  ingresos: number,
  presupuestos: PresupuestoParaLibre[],
  gastosNoCubiertos: number,
): number {
  const gastoLineas = presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const presupTotal = gastoLineas.reduce((s, p) => s + p.montoEfectivo, 0)
  const totalExcedido = gastoLineas.reduce((s, p) => s + (p.excedido ?? 0), 0)
  const ahorroComprometido = presupuestos
    .filter(p => p.categoria.tipo === 'Ahorro' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.montoEfectivo, 0)
  const totalComprometido = presupTotal + gastosNoCubiertos + totalExcedido + ahorroComprometido
  return ingresos - totalComprometido
}

export interface PresupuestoParaCuadre extends PresupuestoParaTotales {
  excedido: number
}

export interface CuadreEntrada {
  // totales.Ingreso y totales.Gasto de GET /api/transacciones?quincenaId: el
  // real completo de la quincena, asignado o no a una linea. No dependen de
  // `limit` (son agregados del servidor), asi que el fetch de 5 filas del
  // Inicio sirve igual que el de Tabla.
  ingresosTotales: number
  gastoTotal: number
  // Las lineas de la quincena SIN filtros de tabla. Ingreso/Ahorro/Canceladas
  // pueden venir mezcladas: cada calculo descarta lo que no le toca.
  presupuestos: PresupuestoParaCuadre[]
  // Suma del corte de liquidez de la quincena, o null si no hay corte. Un
  // corte que suma $0 SI es un corte: no se confunde con "sin corte".
  liquidezTotal: number | null
}

export interface Cuadre {
  ingresos: number
  comprometido: number
  // Lo que deberia sobrarte segun el presupuesto (calcularLibreSinAsignar).
  teorico: number
  // Lo que de verdad te sobra segun tus cuentas: corte - por pagar.
  real: number
  // real - teorico. Positivo = vas mejor que el presupuesto.
  delta: number
  enCuentas: number
  porPagar: number
  cuadra: boolean
  mejor: boolean
}

// "Libre / sin asignar" de una quincena: la mitad "segun tu presupuesto" del
// cuadre. El gasto sin linea sale de restar al gasto total lo ya contado en
// lineas de Gasto, para no necesitar un segundo fetch con asignado=no.
export function calcularLibreDeQuincena({ ingresosTotales, gastoTotal, presupuestos }: Omit<CuadreEntrada, 'liquidezTotal'>): number {
  const realEnLineas = presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.real, 0)
  return calcularLibreSinAsignar(ingresosTotales, presupuestos, Math.max(gastoTotal - realEnLineas, 0))
}

// "¿Cuadra tu dinero?": lo que deberia sobrarte segun el presupuesto contra
// lo que de verdad te sobra segun el corte de cuentas. Ambos lados descuentan
// lo comprometido, asi que la diferencia es solo dinero que el sistema no
// conoce: saldo arrastrado de quincenas anteriores, movimientos sin registrar
// o un corte desactualizado.
//
// Fuente unica para Presupuesto > Tabla y para el Inicio: si las dos pantallas
// llaman a esta funcion con los mismos datos, no pueden contradecirse. El
// "por pagar" sale de TODAS las lineas de la quincena (no de las filas que
// deja ver un filtro de la tabla): el veredicto no debe moverse al filtrar.
//
// Devuelve null sin corte de liquidez: sin esa foto no hay lado "real".
export function calcularCuadre(entrada: CuadreEntrada): Cuadre | null {
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
