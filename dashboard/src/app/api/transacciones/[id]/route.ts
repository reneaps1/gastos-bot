import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const transaccion = await prisma.transaccion.findUnique({
      where: { id },
      include: { categoria: true, user: true, quincena: true, metodoPago: true },
    })

    if (!transaccion) {
      return NextResponse.json({ error: 'Transacción not found' }, { status: 404 })
    }

    return NextResponse.json(transaccion)
  } catch (error) {
    console.error('Error fetching transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const body = await request.json()
    const { fecha, quincenaId, userId, descripcion, categoriaId, tipo, monto, metodoPagoId, estatus, notas } = body

    const transaccion = await prisma.transaccion.update({
      where: { id },
      data: {
        ...(fecha && { fecha: new Date(fecha) }),
        ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
        ...(userId !== undefined && { userId: userId ? parseInt(userId) : null }),
        ...(descripcion && { descripcion }),
        ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
        ...(tipo && { tipo }),
        ...(monto !== undefined && { monto: parseFloat(monto) }),
        ...(metodoPagoId !== undefined && { metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null }),
        ...(estatus && { estatus }),
        ...(notas !== undefined && { notas }),
      },
      include: { categoria: true, user: true, quincena: true },
    })

    return NextResponse.json(transaccion)
  } catch (error) {
    console.error('Error updating transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    await prisma.transaccion.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Transacción deleted' })
  } catch (error) {
    console.error('Error deleting transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
