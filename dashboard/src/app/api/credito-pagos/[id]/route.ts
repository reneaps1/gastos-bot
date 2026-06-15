import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await request.json()
    const pago = await prisma.creditoPago.update({
      where: { id },
      data: {
        ...(body.quincenaId !== undefined && { quincenaId: parseInt(body.quincenaId) }),
        ...(body.categoriaId !== undefined && { categoriaId: parseInt(body.categoriaId) }),
        ...(body.presupuestoId !== undefined && { presupuestoId: body.presupuestoId ? parseInt(body.presupuestoId) : null }),
        ...(body.fechaPagoProgramada !== undefined && { fechaPagoProgramada: new Date(body.fechaPagoProgramada) }),
        ...(body.fechaPagoReal !== undefined && { fechaPagoReal: body.fechaPagoReal ? new Date(body.fechaPagoReal) : null }),
        ...(body.montoCapital !== undefined && { montoCapital: parseFloat(body.montoCapital) || 0 }),
        ...(body.montoInteres !== undefined && { montoInteres: parseFloat(body.montoInteres) || 0 }),
        ...(body.montoTotal !== undefined && { montoTotal: parseFloat(body.montoTotal) }),
        ...(body.estatus !== undefined && { estatus: body.estatus }),
        ...(body.notas !== undefined && { notas: body.notas || null }),
      },
      include: { credito: true, quincena: true, categoria: true },
    })

    return NextResponse.json(pago)
  } catch (error) {
    console.error('Error updating credito pago:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
