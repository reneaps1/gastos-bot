export interface ProyeccionCajaInput {
  saldoCorte: number | null
  ingresosRegistrados: number
  ingresosPagados: number
  pagosPendientes: number
  margenPlan?: number | null
}

export interface ProyeccionCaja {
  saldoCorte: number | null
  ingresosPorCobrar: number
  pagosPendientes: number
  saldoProyectado: number | null
  margenPlan: number | null
  diferenciaVsPlan: number | null
  cuadraConPlan: boolean | null
}

const TOLERANCIA_CENTAVOS = 0.01

/**
 * Proyeccion de caja de cierre a partir de una fotografia real de cuentas.
 *
 * Regla:
 *   saldo del corte + ingresos aun no cobrados - pagos que aun saldran
 *
 * El ahorro no se descuenta aqui: si ya fue registrado como movimiento, su
 * efecto ya debe estar reflejado en el saldo capturado de las cuentas.
 */
export function calcularProyeccionCaja(input: ProyeccionCajaInput): ProyeccionCaja {
  const ingresosRegistrados = Number(input.ingresosRegistrados) || 0
  const ingresosPagados = Number(input.ingresosPagados) || 0
  const pagosPendientes = Math.max(Number(input.pagosPendientes) || 0, 0)
  const ingresosPorCobrar = Math.max(ingresosRegistrados - ingresosPagados, 0)
  const margenPlan = input.margenPlan == null ? null : Number(input.margenPlan)

  const saldoProyectado = input.saldoCorte == null
    ? null
    : Number(input.saldoCorte) + ingresosPorCobrar - pagosPendientes

  const diferenciaVsPlan = saldoProyectado == null || margenPlan == null
    ? null
    : saldoProyectado - margenPlan

  return {
    saldoCorte: input.saldoCorte,
    ingresosPorCobrar,
    pagosPendientes,
    saldoProyectado,
    margenPlan,
    diferenciaVsPlan,
    cuadraConPlan: diferenciaVsPlan == null ? null : Math.abs(diferenciaVsPlan) < TOLERANCIA_CENTAVOS,
  }
}
