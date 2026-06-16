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

    // Total presupuestado por grupo (quincenaId, categoriaId), para el rollup de categoría en la UI
    const groupTotals = new Map<string, number>()
    for (const p of presupuestos) {
      const key = `${p.quincenaId}-${p.categoriaId}`
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + Number(p.montoPresupuestado))
    }

    // Gasto real por línea específica (presupuestoId) — una sola query agrupada en vez de N aggregates
    const presupuestoIds = presupuestos.map(p => p.id)
    const gastosRows = presupuestoIds.length > 0
      ? await prisma.transaccion.groupBy({
          by: ['presupuestoId'],
          where: { presupuestoId: { in: presupuestoIds } },
          _sum: { monto: true },
        })
      : []

    const gastoMap = new Map<number, number>(
      gastosRows.map(g => [g.presupuestoId as number, Number(g._sum.monto ?? 0)])
    )

    const presupuestosConGasto = presupuestos.map(p => {
      const real = gastoMap.get(p.id) ?? 0
      const presup = Number(p.montoPresupuestado)
      const pct = presup > 0 ? Math.min((real / presup) * 100, 100) : 0
      const key = `${p.quincenaId}-${p.categoriaId}`
      const categoriaTotal = groupTotals.get(key) ?? presup
      return { ...p, real, pct, categoriaTotal }
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

    let quincenesTarget: typeof allQuincenas

    if (frecuencia === 'MENSUAL') {
      // Target-date lookup: for each calendar month find the quincena that covers diaCobro
      const targetDay = diaCobro_ ?? 1
      const startDate = quincenaInicio.fechaInicio
      const startYear = startDate.getUTCFullYear()
      const startMonth = startDate.getUTCMonth()

      const lastQuincena = allQuincenas.at(-1)
      const lastDate = lastQuincena?.fechaFin ?? startDate
      const lastYear = lastDate.getUTCFullYear()
      const lastMonth = lastDate.getUTCMonth()
      const maxMonths = (lastYear - startYear) * 12 + (lastMonth - startMonth) + 1
      const monthCount = numOcurrencias ? Math.min(numOcurrencias, maxMonths) : maxMonths

      const selectedIds = new Set<number>()
      for (let i = 0; i < monthCount; i++) {
        const y = startYear + Math.floor((startMonth + i) / 12)
        const mo = (startMonth + i) % 12
        const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
        const d = Math.min(targetDay, daysInMonth)
        const target = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const q = allQuincenas.find(q => {
          const ini = q.fechaInicio.toISOString().split('T')[0]
          const fin = q.fechaFin.toISOString().split('T')[0]
          return ini <= target && target <= fin
        })
        if (q && q.fechaInicio >= quincenaInicio.fechaInicio) selectedIds.add(q.id)
      }
      quincenesTarget = allQuincenas.filter(q => selectedIds.has(q.id))
    } else {
      // CADA_QUINCENA: all quincenas from start, optionally limited
      quincenesTarget = allQuincenas.filter(q => q.fechaInicio >= quincenaInicio.fechaInicio)
      if (numOcurrencias && numOcurrencias > 0) {
        quincenesTarget = quincenesTarget.slice(0, numOcurrencias)
      }
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
