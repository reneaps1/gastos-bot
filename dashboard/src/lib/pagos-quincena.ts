import { prisma } from '@/lib/prisma'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'
import { montoEfectivoDePrisma } from '@/lib/cierre-quincena-server'

// Server-only: usa Prisma directamente, así que solo lo debe importar código
// de servidor (API routes). No lo importes desde un componente de cliente —
// para eso mantenemos esta función separada de `presupuesto-totales.ts`.

export interface PagosQuincena {
  pagosQuincena: number
  desglose: {
    pendientesDirectos: number
    abonosCredito: number
    presupuestoNoEjecutado: number
  }
}

// Cuánto efectivo va a salir del banco EN esta quincena, venga de donde
// venga — a diferencia de "falta por pagar" (calcularFaltaPorPagar), que
// mide ejecución de presupuesto sin importar cuándo sale la caja. Tres
// fuentes:
//  1. Pendientes directos: gasto ya devengado sin tarjeta de por medio
//     (creditoId null), se asume que se paga dentro de la misma quincena.
//  2. Abonos de crédito/TDC: CreditoPago ya trae precalculada la quincena en
//     la que le toca salir a cada abono (una compra a crédito se registra
//     como Transaccion Pendiente completa en su quincena de compra para que
//     SÍ cuente en "falta por pagar" de esa línea, pero su cronología de
//     caja real vive en CreditoPago — por eso la Transaccion padre se
//     excluye de (1) vía creditoId=null, para no duplicar el monto).
//  3. Presupuesto no ejecutado: igual que el segundo término de
//     calcularFaltaPorPagar.
export async function calcularPagosQuincena(quincenaId: number): Promise<PagosQuincena> {
  const [pendientesDirectosAgg, abonosCreditoAgg, presupuestos] = await Promise.all([
    prisma.transaccion.aggregate({
      where: { quincenaId, estatus: 'Pendiente', tipo: 'Gasto', creditoId: null },
      _sum: { monto: true },
    }),
    prisma.creditoPago.aggregate({
      where: { quincenaId, estatus: 'Pendiente' },
      _sum: { montoTotal: true },
    }),
    prisma.presupuesto.findMany({
      where: { quincenaId },
      include: { categoria: true },
    }),
  ])

  const pendientesDirectos = Number(pendientesDirectosAgg._sum.monto ?? 0)
  const abonosCredito = Number(abonosCreditoAgg._sum.montoTotal ?? 0)

  const presupuestoIds = presupuestos.map(p => p.id)
  const gastoRows = presupuestoIds.length > 0
    ? await prisma.transaccion.groupBy({
        by: ['presupuestoId'],
        where: { presupuestoId: { in: presupuestoIds } },
        _sum: { monto: true },
      })
    : []
  const realMap = new Map<number, number>()
  for (const g of gastoRows) realMap.set(g.presupuestoId as number, Number(g._sum.monto ?? 0))

  const presupuestoNoEjecutado = presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + Math.max(montoEfectivoDePrisma(p) - (realMap.get(p.id) ?? 0), 0), 0)

  return {
    pagosQuincena: pendientesDirectos + abonosCredito + presupuestoNoEjecutado,
    desglose: { pendientesDirectos, abonosCredito, presupuestoNoEjecutado },
  }
}
