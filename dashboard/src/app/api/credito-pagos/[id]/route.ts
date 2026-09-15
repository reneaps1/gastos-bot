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

    // Un pago Pagado SIEMPRE tiene que llevar fechaPagoReal: la conciliacion de
    // caja solo cuenta los abonos de credito que la tienen (ver
    // movimientosCajaEntre en @/lib/reconciliacion-plan-caja-server). Sin ella
    // el pago desaparece del neto y deja un descuadre que ningun ajuste cierra.
    // Si no viene en el body, se deriva de la fecha programada del propio pago.
    const existente = await prisma.creditoPago.findUnique({
      where: { id },
      select: { estatus: true, fechaPagoReal: true, fechaPagoProgramada: true },
    })
    if (!existente) return NextResponse.json({ error: 'Credito pago not found' }, { status: 404 })

    const estatusFinal = body.estatus !== undefined ? body.estatus : existente.estatus
    const fechaRealEnBody = body.fechaPagoReal !== undefined ? body.fechaPagoReal : undefined
    const fechaRealFinal = fechaRealEnBody !== undefined
      ? (fechaRealEnBody ? new Date(fechaRealEnBody) : null)
      : existente.fechaPagoReal
    const fechaRealDerivada = estatusFinal === 'Pagado' && fechaRealFinal == null
      ? (body.fechaPagoProgramada ? new Date(body.fechaPagoProgramada) : existente.fechaPagoProgramada)
      : undefined

    const pago = await prisma.creditoPago.update({
      where: { id },
      data: {
        ...(body.quincenaId !== undefined && { quincenaId: parseInt(body.quincenaId) }),
        ...(body.categoriaId !== undefined && { categoriaId: parseInt(body.categoriaId) }),
        ...(body.presupuestoId !== undefined && { presupuestoId: body.presupuestoId ? parseInt(body.presupuestoId) : null }),
        ...(body.fechaPagoProgramada !== undefined && { fechaPagoProgramada: new Date(body.fechaPagoProgramada) }),
        ...(body.fechaPagoReal !== undefined && { fechaPagoReal: body.fechaPagoReal ? new Date(body.fechaPagoReal) : null }),
        ...(fechaRealDerivada !== undefined && { fechaPagoReal: fechaRealDerivada }),
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
