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
  /** Referencia historica: saldo del corte menos ejecucion presupuestal pendiente. No es proyeccion de caja. */
  saldoDespuesDePagar: number | null
  ingresoSinAsignar: number
  /** Referencia historica basada en saldoDespuesDePagar. No usar para la pregunta "cuanto me va a quedar". */
  cubrePendiente: boolean | null
  /** Referencia historica basada en saldoDespuesDePagar. */
  faltanteCobertura: number | null
}

/**
 * Posicion de plan/presupuesto de Milo.
 *
 * Esta funcion conserva algunos campos historicos de liquidez por
 * compatibilidad, pero `pendientePorCubrir` mide EJECUCION PRESUPUESTAL, no
 * cuanto efectivo saldra del banco. Por eso `saldoDespuesDePagar` tampoco debe
 * usarse como respuesta a "cuanto me va a quedar".
 *
 * La proyeccion de caja oficial vive en `@/lib/proyeccion-caja` y usa:
 * saldo del corte + ingresos por cobrar - pagos que saldran en la quincena.
 *
 * El ahorro no se vuelve a descontar del corte: si ya se registro como
 * transaccion/salida, su efecto ya esta reflejado en los saldos capturados.
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
