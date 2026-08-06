import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { computeQuincenasTarget } from '@/lib/recurrencia'

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

    // Total presupuestado por grupo (quincenaId, categoriaId), para el rollup de categoría en la UI
    const groupTotals = new Map<string, number>()
    for (const p of presupuestos) {
      const key = `${p.quincenaId}-${p.categoriaId}`
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + Number(p.montoPresupuestado))
    }

    // Gasto real por línea específica (presupuestoId) — una sola query agrupada en vez de N aggregates.
    // Se agrupa también por estatus para poder separar cuánto de ese real sigue Pendiente de pago.
    const presupuestoIds = presupuestos.map(p => p.id)
    const gastosRows = presupuestoIds.length > 0
      ? await prisma.transaccion.groupBy({
          by: ['presupuestoId', 'estatus'],
          where: { presupuestoId: { in: presupuestoIds }, tipo: 'Gasto' },
          _sum: { monto: true },
        })
      : []

    const gastoMap = new Map<number, number>()
    const pendienteMap = new Map<number, number>()
    for (const g of gastosRows) {
      const id = g.presupuestoId as number
      const monto = Number(g._sum.monto ?? 0)
      gastoMap.set(id, (gastoMap.get(id) ?? 0) + monto)
      if (g.estatus === 'Pendiente') pendienteMap.set(id, (pendienteMap.get(id) ?? 0) + monto)
    }

    const presupuestosConGasto = presupuestos.map(p => {
      const real = gastoMap.get(p.id) ?? 0
      const pendiente = pendienteMap.get(p.id) ?? 0
      const presup = Number(p.montoPresupuestado)
      const pct = presup > 0 ? (real / presup) * 100 : 0
      const key = `${p.quincenaId}-${p.categoriaId}`
      const categoriaTotal = groupTotals.get(key) ?? presup
      const excedido = real > presup ? Number((real - presup).toFixed(2)) : 0
      return { ...p, real, pendiente, pct, categoriaTotal, excedido }
    })

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
      recurrente, frecuencia, numOcurrencias, diaCobro,
    } = body

    if (!quincenaId || !descripcion || !categoriaId || !montoPresupuestado) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const diaCobro_ = diaCobro ? parseInt(diaCobro) : null

    const baseData = {
      descripcion,
      categoriaId: parseInt(categoriaId),
      montoPresupuestado: parseFloat(montoPresupuestado),
      clasificacion: clasificacion ?? null,
      tipo: tipo ?? 'Gasto',
      notas: notas ?? null,
      recurrente: recurrente ?? false,
      frecuencia: recurrente ? (frecuencia ?? 'CADA_QUINCENA') : null,
      diaCobro: diaCobro_ ?? null,
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

    const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })

    const quincenesTarget = computeQuincenasTarget(allQuincenas, quincenaInicio, frecuencia, diaCobro_, numOcurrencias)

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
