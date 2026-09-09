import { calcularFaltaPorPagar, calcularLibreSinAsignar, type PresupuestoParaLibre, type PresupuestoParaTotales } from '@/lib/presupuesto-totales'

export type PresupuestoPosicion = PresupuestoParaTotales & PresupuestoParaLibre

export interface FinancialPositionInput {
  saldoEnCuentas: number | null
  ingresos: number
  presupuestos: PresupuestoPosicion[]
  gastosNoCubiertos: number
}

export interface FinancialPosition {
  saldoEnCuentas: number | null
  disponibleHoy: number | null
  pendientePorCubrir: number
  saldoDespuesDePagar: number | null
  ingresoSinAsignar: number
  cubrePendiente: boolean | null
  faltanteCobertura: number | null
}

/**
 * Fuente unica para las preguntas ejecutivas de Milo:
 * - cuanto dinero hay en las cuentas segun el ultimo corte,
 * - cuanto falta cubrir del presupuesto,
 * - cuanto queda si se cubre todo,
 * - cuanto ingreso de la quincena sigue sin asignar.
 *
 * El corte de liquidez ya es una foto del saldo real de las cuentas. Si un
 * ahorro ya se registro como transaccion/salida, su efecto ya esta contenido
 * en ese saldo y no debe restarse una segunda vez aqui.
 */
export function calcularPosicionFinanciera(input: FinancialPositionInput): FinancialPosition {
  const pendientePorCubrir = calcularFaltaPorPagar(input.presupuestos)
  const ingresoSinAsignar = calcularLibreSinAsignar(
    Number(input.ingresos) || 0,
    input.presupuestos,
    Number(input.gastosNoCubiertos) || 0,
  )

  const disponibleHoy = input.saldoEnCuentas == null
    ? null
    : Number(input.saldoEnCuentas)
  const saldoDespuesDePagar = disponibleHoy == null
    ? null
    : disponibleHoy - pendientePorCubrir
  const cubrePendiente = saldoDespuesDePagar == null ? null : saldoDespuesDePagar >= 0
  const faltanteCobertura = saldoDespuesDePagar == null ? null : Math.max(-saldoDespuesDePagar, 0)

  return {
    saldoEnCuentas: input.saldoEnCuentas,
    disponibleHoy,
    pendientePorCubrir,
    saldoDespuesDePagar,
    ingresoSinAsignar,
    cubrePendiente,
    faltanteCobertura,
  }
}
