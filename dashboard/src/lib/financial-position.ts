import { calcularFaltaPorPagar, calcularLibreSinAsignar, type PresupuestoParaLibre, type PresupuestoParaTotales } from '@/lib/presupuesto-totales'

export type PresupuestoPosicion = PresupuestoParaTotales & PresupuestoParaLibre

export interface FinancialPositionInput {
  saldoEnCuentas: number | null
  ahorroProtegido: number
  ingresos: number
  presupuestos: PresupuestoPosicion[]
  gastosNoCubiertos: number
}

export interface FinancialPosition {
  saldoEnCuentas: number | null
  ahorroProtegido: number
  disponibleHoy: number | null
  pendientePorCubrir: number
  saldoDespuesDePagar: number | null
  ingresoSinAsignar: number
  cubrePendiente: boolean | null
  faltanteCobertura: number | null
}

/**
 * Fuente unica para las preguntas ejecutivas de Milo:
 * - cuanto dinero operativo hay hoy,
 * - cuanto falta cubrir,
 * - cuanto queda si se cubre todo,
 * - cuanto ingreso de la quincena sigue sin asignar.
 *
 * El ahorro acumulado queda protegido y nunca se usa como caja operativa.
 */
export function calcularPosicionFinanciera(input: FinancialPositionInput): FinancialPosition {
  const ahorroProtegido = Math.max(Number(input.ahorroProtegido) || 0, 0)
  const pendientePorCubrir = calcularFaltaPorPagar(input.presupuestos)
  const ingresoSinAsignar = calcularLibreSinAsignar(
    Number(input.ingresos) || 0,
    input.presupuestos,
    Number(input.gastosNoCubiertos) || 0,
  )

  const disponibleHoy = input.saldoEnCuentas == null
    ? null
    : Number(input.saldoEnCuentas) - ahorroProtegido
  const saldoDespuesDePagar = disponibleHoy == null
    ? null
    : disponibleHoy - pendientePorCubrir
  const cubrePendiente = saldoDespuesDePagar == null ? null : saldoDespuesDePagar >= 0
  const faltanteCobertura = saldoDespuesDePagar == null ? null : Math.max(-saldoDespuesDePagar, 0)

  return {
    saldoEnCuentas: input.saldoEnCuentas,
    ahorroProtegido,
    disponibleHoy,
    pendientePorCubrir,
    saldoDespuesDePagar,
    ingresoSinAsignar,
    cubrePendiente,
    faltanteCobertura,
  }
}
