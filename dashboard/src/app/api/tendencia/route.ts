import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = parseInt(searchParams.get('quincenaId') ?? '0')
    const range = parseInt(searchParams.get('range') ?? '3')

    if (!quincenaId) return NextResponse.json({ error: 'quincenaId required' }, { status: 400 })

    const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
    const currentIdx = allQuincenas.findIndex(q => q.id === quincenaId)
    if (currentIdx === -1) return NextResponse.json({ error: 'Quincena not found' }, { status: 404 })

    const start = Math.max(0, currentIdx - range)
    const end = Math.min(allQuincenas.length - 1, currentIdx + range)
    const slice = allQuincenas.slice(start, end + 1)
    const sliceIds = slice.map(q => q.id)

    const rows = await prisma.transaccion.groupBy({
      by: ['quincenaId', 'tipo'],
      where: { quincenaId: { in: sliceIds } },
      _sum: { monto: true },
    })

    const result = slice.map(q => {
      const ingRow = rows.find(r => r.quincenaId === q.id && r.tipo === 'Ingreso')
      const gastoRow = rows.find(r => r.quincenaId === q.id && r.tipo === 'Gasto')
      return {
        quincenaId: q.id,
        codigo: q.codigo,
        fechaInicio: q.fechaInicio,
        ingresos: Number(ingRow?._sum?.monto ?? 0),
        gastos: Number(gastoRow?._sum?.monto ?? 0),
        esCurrent: q.id === quincenaId,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching tendencia:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
