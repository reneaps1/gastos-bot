import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const creditoId = searchParams.get('creditoId')
    const quincenaId = searchParams.get('quincenaId')
    const estatus = searchParams.get('estatus')

    const where: Record<string, unknown> = {}
    if (creditoId) where.creditoId = parseInt(creditoId)
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (estatus) where.estatus = estatus

    const pagos = await prisma.creditoPago.findMany({
      where,
      include: { credito: true, quincena: true, categoria: true, presupuesto: true, transaccion: true },
      orderBy: { fechaPagoProgramada: 'asc' },
    })

    return NextResponse.json(pagos)
  } catch (error) {
    console.error('Error fetching credito pagos:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { creditoId, transaccionId, quincenaId, categoriaId, presupuestoId, numeroPago, totalPagos, fechaPagoProgramada, montoCapital, montoInteres, montoTotal, estatus, notas } = body

    if (!creditoId || !quincenaId || !categoriaId || !fechaPagoProgramada || montoTotal === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const pago = await prisma.creditoPago.create({
      data: {
        creditoId: parseInt(creditoId),
        transaccionId: transaccionId ? parseInt(transaccionId) : null,
        quincenaId: parseInt(quincenaId),
        categoriaId: parseInt(categoriaId),
        presupuestoId: presupuestoId ? parseInt(presupuestoId) : null,
        numeroPago: numeroPago ? parseInt(numeroPago) : null,
        totalPagos: totalPagos ? parseInt(totalPagos) : null,
        fechaPagoProgramada: new Date(fechaPagoProgramada),
        montoCapital: montoCapital ? parseFloat(montoCapital) : 0,
        montoInteres: montoInteres ? parseFloat(montoInteres) : 0,
        montoTotal: parseFloat(montoTotal),
        estatus: estatus || 'Pendiente',
        notas: notas || null,
      },
      include: { credito: true, quincena: true, categoria: true },
    })

    return NextResponse.json(pago, { status: 201 })
  } catch (error) {
    console.error('Error creating credito pago:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
