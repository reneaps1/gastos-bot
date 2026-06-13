import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')

    const today = new Date()

    let quincenaActual
    if (quincenaId) {
      quincenaActual = await prisma.quincena.findUnique({
        where: { id: parseInt(quincenaId) },
      })
    } else {
      quincenaActual = await prisma.quincena.findFirst({
        where: {
          fechaInicio: { lte: today },
          fechaFin: { gte: today },
        },
      })
    }

    const [todasQuincenas, categorias, ultimasTransacciones, totalesPorCategoria] = await Promise.all([
      prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' }, take: 20 }),
      prisma.categoria.findMany({ where: { activo: true } }),
      prisma.transaccion.findMany({
        take: 10,
        orderBy: { fechaRegistro: 'desc' },
        include: { categoria: true, user: true },
      }),
      prisma.transaccion.groupBy({
        by: ['categoriaId'],
        _sum: { monto: true },
        _count: true,
      }),
    ])

    const whereClause = quincenaActual ? { quincenaId: quincenaActual.id } : { id: -1 }

    const [ingresos, gastos, ahorros] = await Promise.all([
      prisma.transaccion.aggregate({
        where: { ...whereClause, tipo: 'Ingreso' },
        _sum: { monto: true },
      }),
      prisma.transaccion.aggregate({
        where: { ...whereClause, tipo: 'Gasto' },
        _sum: { monto: true },
      }),
      prisma.transaccion.aggregate({
        where: { ...whereClause, tipo: 'Ahorro' },
        _sum: { monto: true },
      }),
    ])

    return NextResponse.json({
      quincenaActual,
      todasQuincenas,
      categorias,
      ultimasTransacciones,
      totalesPorCategoria,
      metricas: {
        ingresos: Number(ingresos._sum.monto ?? 0),
        gastos: Number(gastos._sum.monto ?? 0),
        ahorros: Number(ahorros._sum.monto ?? 0),
        balance: Number(ingresos._sum.monto ?? 0) - Number(gastos._sum.monto ?? 0) - Number(ahorros._sum.monto ?? 0),
      },
    })
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
