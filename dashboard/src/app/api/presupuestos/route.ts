import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')
    const categoriaId = searchParams.get('categoriaId')

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (categoriaId) where.categoriaId = parseInt(categoriaId)

    const presupuestos = await prisma.presupuesto.findMany({
      where,
      include: { categoria: true, quincena: true },
      orderBy: [{ quincena: { fechaInicio: 'desc' } }, { categoria: { nombre: 'asc' } }],
    })

    const presupuestosConGasto = await Promise.all(
      presupuestos.map(async (p) => {
        const gastado = await prisma.transaccion.aggregate({
          where: { quincenaId: p.quincenaId, categoriaId: p.categoriaId },
          _sum: { monto: true },
        })
        const real = Number(gastado._sum.monto ?? 0)
        const presup = Number(p.montoPresupuestado)
        const pct = presup > 0 ? Math.min((real / presup) * 100, 100) : 0
        return { ...p, real, pct }
      })
    )

    return NextResponse.json(presupuestosConGasto)
  } catch (error) {
    console.error('Error fetching presupuestos:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { quincenaId, descripcion, categoriaId, montoPresupuestado, clasificacion, tipo, notas } = body

    if (!quincenaId || !descripcion || !categoriaId || !montoPresupuestado) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const presupuesto = await prisma.presupuesto.create({
      data: {
        quincenaId: parseInt(quincenaId),
        descripcion,
        categoriaId: parseInt(categoriaId),
        montoPresupuestado: parseFloat(montoPresupuestado),
        clasificacion,
        tipo: tipo ?? 'Gasto',
        notas,
      },
      include: { categoria: true, quincena: true },
    })

    return NextResponse.json(presupuesto, { status: 201 })
  } catch (error) {
    console.error('Error creating presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
