import { calcularFaltaPorPagar, type PresupuestoParaTotales } from '@/lib/presupuesto-totales'

export interface LiquidezMontos {
  bbva: number
  banamex: number
  uala: number
  ualaInversion: number
  efectivo: number
  valesDespensa: number
  valesGasolina: number
  otros: number
}

export function sumLiquidez(s: LiquidezMontos): number {
  return s.bbva + s.banamex + s.uala + s.ualaInversion + s.efectivo + s.valesDespensa + s.valesGasolina + s.otros
}

// Conciliación de efectivo disponible (base caja, no base presupuesto): lo
// que de verdad hay en cuentas menos lo que ya está comprometido y sigue sin
// pagarse. faltaPagar siempre se recalcula en vivo con calcularFaltaPorPagar
// -- nunca se confía en un valor guardado, que puede quedar obsoleto en
// cuanto cambie el presupuesto (ver dashboard/src/lib/cierre-quincena-server.ts).
export function calcularEfectivoDisponible(
  snapshot: LiquidezMontos | null,
  presupuestos: PresupuestoParaTotales[]
): { totalLiquido: number; faltaPagar: number; disponible: number } {
  const totalLiquido = snapshot ? sumLiquidez(snapshot) : 0
  const faltaPagar = calcularFaltaPorPagar(presupuestos)
  return { totalLiquido, faltaPagar, disponible: totalLiquido - faltaPagar }
}

// Los campos Decimal de Prisma llegan como string por la API (Decimal.toJSON
// serializa a string), asi que hay que convertirlos a number antes de
// sumarlos o se concatenan como texto en vez de sumarse.
export function normalizeMontos(s: { [K in keyof LiquidezMontos]: unknown }): LiquidezMontos {
  return {
    bbva: Number(s.bbva) || 0,
    banamex: Number(s.banamex) || 0,
    uala: Number(s.uala) || 0,
    ualaInversion: Number(s.ualaInversion) || 0,
    efectivo: Number(s.efectivo) || 0,
    valesDespensa: Number(s.valesDespensa) || 0,
    valesGasolina: Number(s.valesGasolina) || 0,
    otros: Number(s.otros) || 0,
  }
}
