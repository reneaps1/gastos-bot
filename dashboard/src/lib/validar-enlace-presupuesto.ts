import { prisma } from '@/lib/prisma'

// Server-only. Un gasto de una quincena no puede colgarse de una linea de
// presupuesto de otra: el `real` de una linea se calcula por presupuestoId sin
// mirar la quincena (ver @/lib/real-transacciones), asi que el gasto sumaria en
// el presupuesto de una quincena mientras los totales de transacciones lo
// cuentan en la otra. Las dos quedan mal y nadie lo nota hasta el cierre.
//
// El bot de Telegram ya rechazaba este caso desde que existe
// (src/budgetActions.js, motivo QUINCENA_DISTINTA); esto pone la misma regla
// en el dashboard, que es por donde se colaba.

export interface EnlaceInvalido {
  error: string
  quincenaLinea: number
}

/**
 * Devuelve null si el enlace es valido (o si no hay linea que validar), y el
 * motivo del rechazo si la linea pertenece a otra quincena.
 */
export async function validarEnlacePresupuesto(
  presupuestoId: number | null | undefined,
  quincenaId: number,
): Promise<EnlaceInvalido | null> {
  if (presupuestoId == null) return null

  const linea = await prisma.presupuesto.findUnique({
    where: { id: presupuestoId },
    select: { quincenaId: true, descripcion: true },
  })
  if (!linea) return { error: 'La línea de presupuesto no existe', quincenaLinea: 0 }
  if (linea.quincenaId === quincenaId) return null

  return {
    error: `La línea "${linea.descripcion}" es de otra quincena; el movimiento no puede asignarse ahí`,
    quincenaLinea: linea.quincenaId,
  }
}
