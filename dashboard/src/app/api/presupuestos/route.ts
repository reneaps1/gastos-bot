import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

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
    const {
      quincenaId, descripcion, categoriaId, montoPresupuestado,
      clasificacion, tipo, notas,
      recurrente, frecuencia, numOcurrencias,
    } = body

    if (!quincenaId || !descripcion || !categoriaId || !montoPresupuestado) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const baseData = {
      descripcion,
      categoriaId: parseInt(categoriaId),
      montoPresupuestado: parseFloat(montoPresupuestado),
      clasificacion: clasificacion ?? null,
      tipo: tipo ?? 'Gasto',
      notas: notas ?? null,
      recurrente: recurrente ?? false,
      frecuencia: recurrente ? (frecuencia ?? 'CADA_QUINCENA') : null,
    }

    if (!recurrente) {
      const presupuesto = await prisma.presupuesto.create({
        data: { ...baseData, quincenaId: parseInt(quincenaId) },
        include: { categoria: true, quincena: true },
      })
      return NextResponse.json(presupuesto, { status: 201 })
    }

    // Recurring: find all future quincenas from the selected one
    const quincenaInicio = await prisma.quincena.findUnique({
      where: { id: parseInt(quincenaId) },
    })
    if (!quincenaInicio) {
      return NextResponse.json({ error: 'Quincena not found' }, { status: 404 })
    }

    const todasQuincenas = await prisma.quincena.findMany({
      where: { fechaInicio: { gte: quincenaInicio.fechaInicio } },
      orderBy: { fechaInicio: 'asc' },
    })

    // Filter by frequency
    let quincenesTarget = todasQuincenas.filter((q, idx) => {
      if (frecuencia === 'MENSUAL') {
        // Only quincenas starting on day 1 of the month (first half)
        const d = new Date(q.fechaInicio.toISOString().split('T')[0] + 'T00:00:00Z')
        return d.getUTCDate() === 1
      }
      return true // CADA_QUINCENA: all
    })

    // Limit by number of occurrences
    if (numOcurrencias && numOcurrencias > 0) {
      quincenesTarget = quincenesTarget.slice(0, numOcurrencias)
    }

    if (quincenesTarget.length === 0) {
      return NextResponse.json({ error: 'No matching quincenas found' }, { status: 400 })
    }

    const grupoId = randomUUID()

    await prisma.presupuesto.createMany({
      data: quincenesTarget.map(q => ({
        ...baseData,
        quincenaId: q.id,
        recurrenciaGrupoId: grupoId,
        numOcurrencias: numOcurrencias ?? null,
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({ created: quincenesTarget.length, grupoId }, { status: 201 })
  } catch (error) {
    console.error('Error creating presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
