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

    const [movimientos, pagosCreditoAgg] = await Promise.all([
      prisma.transaccion.groupBy({
        by: ['tipo', 'direccion'],
        where: {
          fecha: { gt: anterior.fechaCorte, lte: actual.fechaCorte },
          estatus: 'Pagado',
          tipo: { in: ['Ingreso', 'Gasto', 'Ahorro'] },
        },
        _sum: { monto: true },
      }),
      prisma.creditoPago.aggregate({
        where: {
          estatus: 'Pagado',
          fechaPagoReal: { gt: anterior.fechaCorte, lte: actual.fechaCorte },
        },
        _sum: { montoTotal: true },
      }),
    ])

    let ingresos = 0
    let gastos = 0
    let ahorroAportes = 0
    let ahorroRetiros = 0

    for (const row of movimientos) {
      const monto = Number(row._sum.monto ?? 0)
      if (row.tipo === 'Ingreso') ingresos += monto
      else if (row.tipo === 'Gasto') gastos += monto
      else if (row.tipo === 'Ahorro' && row.direccion === 'Retiro') ahorroRetiros += monto
      else if (row.tipo === 'Ahorro') ahorroAportes += monto
    }

    const pagosCredito = Number(pagosCreditoAgg._sum.montoTotal ?? 0)
    const ingresosCaja = ingresos + ahorroRetiros
    const gastosCaja = gastos + ahorroAportes + pagosCredito

    const conciliacion = calcularDescuadre({
      saldoAnterior: totalSnapshot(anterior),
      ingresosPagados: ingresosCaja,
      gastosPagados: gastosCaja,
      saldoActual: totalSnapshot(actual),
    })

    return NextResponse.json({
      actual,
      anterior,
      capturasMismaFecha,
      intervalo: { desdeExclusivo: anterior.fechaCorte, hastaInclusivo: actual.fechaCorte },
      movimientosCaja: {
        ingresos,
        gastos,
        ahorroAportes,
        ahorroRetiros,
        pagosCredito,
        neto: ingresosCaja - gastosCaja,
      },
      conciliacion,
    })
  } catch (error) {
    console.error('Error conciliando liquidez:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
