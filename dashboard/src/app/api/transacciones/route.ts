import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function addMonths(dateString: string, months: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date
}

async function findQuincenaIdForDate(date: Date): Promise<number | null> {
  const quincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
  const found = quincenas.find(q => q.fechaInicio <= date && date <= q.fechaFin)
  // Return null for dates in gaps — callers must handle this explicitly
  return found?.id ?? null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')
    const tipo = searchParams.get('tipo')
    const categoriaId = searchParams.get('categoriaId')
    const userId = searchParams.get('userId')
    const page = parseInt(searchParams.get('page') ?? '1')
    const limit = parseInt(searchParams.get('limit') ?? '50')
    const skip = (page - 1) * limit

    const estatus = searchParams.get('estatus')
    const busqueda = searchParams.get('busqueda')
    const asignado = searchParams.get('asignado')
    const fechaDesde = searchParams.get('fechaDesde')
    const fechaHasta = searchParams.get('fechaHasta')

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (fechaDesde || fechaHasta) {
      where.fecha = {}
      if (fechaDesde) where.fecha.gte = new Date(`${fechaDesde}T00:00:00.000Z`)
      if (fechaHasta) where.fecha.lte = new Date(`${fechaHasta}T23:59:59.999Z`)
    }
    if (tipo) where.tipo = tipo
    if (categoriaId) where.categoriaId = parseInt(categoriaId)
    if (userId) where.userId = parseInt(userId)
    if (estatus) where.estatus = estatus
    if (busqueda) where.descripcion = { contains: busqueda, mode: 'insensitive' }
    if (asignado === 'si') where.presupuestoId = { not: null }
    else if (asignado === 'no') where.presupuestoId = null

    const [transacciones, total, totalesPorTipo] = await Promise.all([
      prisma.transaccion.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
        include: { categoria: true, user: true, quincena: true, metodoPago: true, presupuesto: true },
      }),
      prisma.transaccion.count({ where }),
      prisma.transaccion.groupBy({
        by: ['tipo', 'estatus'],
        where,
        _sum: { monto: true },
      }),
    ])

    // Suma real (no paginada) por tipo, respetando los mismos filtros que la
    // lista — evita que las tarjetas de totales se calculen sobre solo la
    // página de resultados devuelta.
    const totales = { Gasto: 0, Ingreso: 0, Ahorro: 0, GastoPagado: 0 }
    for (const row of totalesPorTipo) {
      const monto = Number(row._sum.monto ?? 0)
      if (row.tipo in totales) totales[row.tipo as 'Gasto' | 'Ingreso' | 'Ahorro'] += monto
      if (row.tipo === 'Gasto' && row.estatus === 'Pagado') totales.GastoPagado += monto
    }

    return NextResponse.json({
      data: transacciones,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      totales,
    })
  } catch (error) {
    console.error('Error fetching transacciones:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { fecha, quincenaId, quincenaConsumoId, userId, descripcion, categoriaId, tipo, monto, metodoPagoId, creditoId, fechaPagoProgramada, totalPagos, estatus, notas, source, presupuestoId } = body

    if (!fecha || !quincenaId || !descripcion || !categoriaId || !tipo || monto === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const parsedMonto = parseFloat(monto)
    const parsedCreditoId = creditoId ? parseInt(creditoId) : null
    const parsedTotalPagos = totalPagos ? parseInt(totalPagos) : (parsedCreditoId && fechaPagoProgramada ? 1 : null)

    if (parsedCreditoId && parsedTotalPagos && parsedTotalPagos > 0 && !fechaPagoProgramada) {
      return NextResponse.json({ error: 'fechaPagoProgramada required for credit payments' }, { status: 400 })
    }

    const pagosData: Array<{
      creditoId: number
      quincenaId: number
      categoriaId: number
      numeroPago: number
      totalPagos: number
      fechaPagoProgramada: Date
      montoCapital: number
      montoInteres: number
      montoTotal: number
      estatus: 'Pendiente'
      notas: string
    }> = []
    if (parsedCreditoId && parsedTotalPagos && parsedTotalPagos > 0) {
      const base = Math.floor((parsedMonto / parsedTotalPagos) * 100) / 100
      let accumulated = 0
      for (let i = 0; i < parsedTotalPagos; i++) {
        const paymentDate = addMonths(fechaPagoProgramada, i)
        const paymentQuincenaId = await findQuincenaIdForDate(paymentDate)
        if (!paymentQuincenaId) {
          return NextResponse.json({ error: `No quincena for payment ${i + 1}` }, { status: 400 })
        }

        const montoTotal = i === parsedTotalPagos - 1
          ? Number((parsedMonto - accumulated).toFixed(2))
          : base
        accumulated = Number((accumulated + montoTotal).toFixed(2))

        pagosData.push({
          creditoId: parsedCreditoId,
          quincenaId: paymentQuincenaId,
          categoriaId: parseInt(categoriaId),
          numeroPago: i + 1,
          totalPagos: parsedTotalPagos,
          fechaPagoProgramada: paymentDate,
          montoCapital: montoTotal,
          montoInteres: 0,
          montoTotal,
          estatus: 'Pendiente' as const,
          notas: `${descripcion} ${i + 1}/${parsedTotalPagos}`,
        })
      }
    }

    const transaccion = await prisma.$transaction(async (tx) => {
      const created = await tx.transaccion.create({
        data: {
          fecha: new Date(fecha),
          quincenaId: parseInt(quincenaId),
          quincenaConsumoId: quincenaConsumoId ? parseInt(quincenaConsumoId) : parseInt(quincenaId),
          userId: userId ? parseInt(userId) : null,
          descripcion,
          categoriaId: parseInt(categoriaId),
          tipo,
          monto: parsedMonto,
          metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null,
          creditoId: parsedCreditoId,
          presupuestoId: presupuestoId ? parseInt(presupuestoId) : null,
          fechaPagoProgramada: fechaPagoProgramada ? new Date(fechaPagoProgramada) : null,
          estatus: parsedCreditoId ? 'Pendiente' : (estatus ?? 'Pendiente'),
          notas,
          source: source ?? 'api',
        },
        include: { categoria: true, user: true, quincena: true, presupuesto: true },
      })

      if (pagosData.length > 0) {
        await tx.creditoPago.createMany({
          data: pagosData.map(p => ({ ...p, transaccionId: created.id })),
        })
      }

      return created
    })

    return NextResponse.json(transaccion, { status: 201 })
  } catch (error) {
    console.error('Error creating transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
