import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcularDescuadre } from '@/lib/liquidez-descuadre'

function totalSnapshot(snapshot: { montos: { monto: unknown }[] }) {
  return snapshot.montos.reduce<number>((total, m) => total + Number(m.monto), 0)
}

function limitesDiaUtc(fecha: Date) {
  const inicio = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()))
  const siguiente = new Date(inicio)
  siguiente.setUTCDate(siguiente.getUTCDate() + 1)
  return { inicio, siguiente }
}

export async function GET(request: Request) {
  try {
    const snapshotId = Number(new URL(request.url).searchParams.get('snapshotId'))
    if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
      return NextResponse.json({ error: 'snapshotId invalido' }, { status: 400 })
    }

    const actual = await prisma.liquidezSnapshot.findUnique({
      where: { id: snapshotId },
      include: { quincena: true, montos: true },
    })
    if (!actual) {
      return NextResponse.json({ error: 'Snapshot no encontrado' }, { status: 404 })
    }
    const diaActual = limitesDiaUtc(actual.fechaCorte)

    const [anterior, capturasMismaFecha] = await Promise.all([
      prisma.liquidezSnapshot.findFirst({
        where: { fechaCorte: { lt: diaActual.inicio } },
        include: { quincena: true, montos: true },
        orderBy: [
          { fechaCorte: 'desc' },
          { fechaRegistro: 'desc' },
          { id: 'desc' },
        ],
      }),
      prisma.liquidezSnapshot.count({
        where: { fechaCorte: { gte: diaActual.inicio, lt: diaActual.siguiente } },
      }),
    ])

    if (!anterior) {
      return NextResponse.json({ actual, anterior: null, capturasMismaFecha, conciliacion: null })
    }

    const movimientos = await prisma.transaccion.groupBy({
      by: ['tipo'],
      where: {
        fecha: { gt: anterior.fechaCorte, lte: actual.fechaCorte },
        estatus: 'Pagado',
        tipo: { in: ['Ingreso', 'Gasto'] },
      },
      _sum: { monto: true },
    })

    const ingresosPagados = Number(movimientos.find(m => m.tipo === 'Ingreso')?._sum.monto ?? 0)
    const gastosPagados = Number(movimientos.find(m => m.tipo === 'Gasto')?._sum.monto ?? 0)
    const conciliacion = calcularDescuadre({
      saldoAnterior: totalSnapshot(anterior),
      ingresosPagados,
      gastosPagados,
      saldoActual: totalSnapshot(actual),
    })

    return NextResponse.json({
      actual,
      anterior,
      capturasMismaFecha,
      intervalo: { desdeExclusivo: anterior.fechaCorte, hastaInclusivo: actual.fechaCorte },
      conciliacion,
    })
  } catch (error) {
    console.error('Error conciliando liquidez:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
