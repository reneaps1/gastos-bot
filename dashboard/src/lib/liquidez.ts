import { calcularFaltaPorPagar, type PresupuestoParaTotales } from '@/lib/presupuesto-totales'

export interface LiquidezMontoLinea {
  cuentaId: number
  monto: number
  nota: string | null
  cuenta?: { id: number; nombre: string; tipo: string | null; icono: string | null; color: string | null }
}

export interface LiquidezMontos {
  montos: LiquidezMontoLinea[]
}

export function sumLiquidez(s: LiquidezMontos): number {
  return s.montos.reduce((total, m) => total + m.monto, 0)
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
export function normalizeMontos(s: { montos?: unknown }): LiquidezMontos {
  const raw = Array.isArray(s.montos) ? s.montos : []
  return {
    montos: raw.map((m): LiquidezMontoLinea => {
      const line = m as { cuentaId?: unknown; monto?: unknown; nota?: unknown; cuenta?: LiquidezMontoLinea['cuenta'] }
      return {
        cuentaId: Number(line.cuentaId) || 0,
        monto: Number(line.monto) || 0,
        nota: (line.nota as string | null | undefined) ?? null,
        cuenta: line.cuenta,
      }
    }),
  }
}
