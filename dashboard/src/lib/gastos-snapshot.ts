import { prisma } from '@/lib/prisma'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'
import { montoEfectivoDePrisma } from '@/lib/cierre-quincena-server'

function redondearMoneda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

export async function calcularGastosAlCorte(quincenaId: number, fechaCorte: Date) {
  const [lineas, gastos] = await Promise.all([
    prisma.presupuesto.findMany({
      where: { quincenaId, categoria: { tipo: 'Gasto' } },
      select: {
        id: true,
        montoPresupuestado: true,
        montoRevisado: true,
        estadoLinea: true,
      },
    }),
    prisma.transaccion.groupBy({
      by: ['presupuestoId'],
      where: {
        quincenaId,
        tipo: 'Gasto',
        fecha: { lte: fechaCorte },
      },
      _sum: { monto: true },
    }),
  ])

  const gastoPorLinea = new Map<number | null, number>()
  let gastosReales = 0
  for (const gasto of gastos) {
    const monto = Number(gasto._sum.monto ?? 0)
    gastoPorLinea.set(gasto.presupuestoId, monto)
    gastosReales += monto
  }

  const lineasActivas = lineas.filter(cuentaParaAgregados)
  const idsActivos = new Set(lineasActivas.map(linea => linea.id))
  const pronosticoLineas = lineasActivas.reduce((total, linea) => {
    const presupuestado = montoEfectivoDePrisma(linea)
    const real = gastoPorLinea.get(linea.id) ?? 0
    return total + Math.max(presupuestado, real)
  }, 0)
  const realesFueraDePresupuestoActivo = gastos.reduce((total, gasto) => {
    if (gasto.presupuestoId != null && idsActivos.has(gasto.presupuestoId)) return total
    return total + Number(gasto._sum.monto ?? 0)
  }, 0)

  return {
    gastosReales: redondearMoneda(gastosReales),
    gastosPronosticados: redondearMoneda(pronosticoLineas + realesFueraDePresupuestoActivo),
  }
}
