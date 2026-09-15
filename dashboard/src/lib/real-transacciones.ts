import { prisma } from '@/lib/prisma'

// Punto unico de verdad para "cuanto se ha ejercido de una linea de
// presupuesto" (el `real` y su parte `pendiente`).
//
// Server-only: usa Prisma directamente, asi que solo lo importa codigo de
// servidor (API routes y libs de servidor), igual que `@/lib/pagos-quincena`.
//
// Por que existe: este calculo estaba repetido en cuatro lugares
// (api/presupuestos, pagos-quincena, reconciliacion-plan-caja-server y
// src/budgetTracker.js del bot) y los cuatro sumaban `monto` en bruto. En una
// linea de categoria Ahorro eso cuenta un Retiro como si fuera un aporte,
// porque `monto` siempre se guarda positivo y el signo vive en `direccion`
// (ver @/lib/transaccion-ahorro). Resultado: el real de una linea de ahorro
// salia inflado justo por el doble de los retiros, mientras
// /api/transacciones -- que si netea por direccion -- reportaba otra cifra
// para lo mismo.
//
// Regla: Retiro resta, todo lo demas suma. Para lineas de Gasto e Ingreso no
// cambia nada, porque ahi `direccion` siempre es NULL.

export interface RealDeLinea {
  /** Ejercido de la linea, con los retiros de ahorro ya restados. */
  real: number
  /** Parte de `real` que sigue en estatus Pendiente (mismo neteo). */
  pendiente: number
}

const VACIO: RealDeLinea = { real: 0, pendiente: 0 }

export function realDeLinea(mapa: Map<number, RealDeLinea>, presupuestoId: number): RealDeLinea {
  return mapa.get(presupuestoId) ?? VACIO
}

/**
 * Suma las transacciones enlazadas a cada linea, neteando los retiros de
 * ahorro. Una sola query agrupada para todas las lineas.
 */
export async function calcularRealPorLinea(presupuestoIds: number[]): Promise<Map<number, RealDeLinea>> {
  const mapa = new Map<number, RealDeLinea>()
  if (presupuestoIds.length === 0) return mapa

  const filas = await prisma.transaccion.groupBy({
    by: ['presupuestoId', 'estatus', 'direccion'],
    where: { presupuestoId: { in: presupuestoIds } },
    _sum: { monto: true },
  })

  for (const fila of filas) {
    const id = fila.presupuestoId
    if (id == null) continue
    const monto = Number(fila._sum.monto ?? 0)
    const neto = fila.direccion === 'Retiro' ? -monto : monto
    const acumulado = mapa.get(id) ?? { real: 0, pendiente: 0 }
    acumulado.real += neto
    if (fila.estatus === 'Pendiente') acumulado.pendiente += neto
    mapa.set(id, acumulado)
  }

  return mapa
}
