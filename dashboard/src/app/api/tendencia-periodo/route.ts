import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPeriodoRange, shiftPeriodo } from '@/lib/periodo'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const granularidad = searchParams.get('granularidad')
    const anchor = searchParams.get('anchor')
    const range = parseInt(searchParams.get('range') ?? '3')

    if ((granularidad !== 'semana' && granularidad !== 'mes') || !anchor) {
      return NextResponse.json({ error: 'granularidad (semana|mes) y anchor requeridos' }, { status: 400 })
    }

    const buckets = []
    for (let i = -range; i <= range; i++) {
      const bucketAnchor = shiftPeriodo(granularidad, anchor, i)
      const { desde, hasta, label } = getPeriodoRange(granularidad, bucketAnchor)
      buckets.push({ desde, hasta, label, esCurrent: i === 0 })
    }

    const overallDesde = new Date(`${buckets[0].desde}T00:00:00.000Z`)
    const overallHasta = new Date(`${buckets[buckets.length - 1].hasta}T23:59:59.999Z`)

    const txs = await prisma.transaccion.findMany({
      where: { fecha: { gte: overallDesde, lte: overallHasta } },
      select: { fecha: true, tipo: true, monto: true },
    })

    const result = buckets.map(b => {
      const desdeD = new Date(`${b.desde}T00:00:00.000Z`)
      const hastaD = new Date(`${b.hasta}T23:59:59.999Z`)
      let ingresos = 0
      let gastos = 0
      for (const t of txs) {
        if (t.fecha >= desdeD && t.fecha <= hastaD) {
          const monto = Number(t.monto)
          if (t.tipo === 'Ingreso') ingresos += monto
          else if (t.tipo === 'Gasto') gastos += monto
        }
      }
      return { codigo: b.label, fechaInicio: b.desde, ingresos, gastos, esCurrent: b.esCurrent }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching tendencia-periodo:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
