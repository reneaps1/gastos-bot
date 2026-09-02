import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolverTipoYDireccion } from '@/lib/transaccion-ahorro'

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
      include: { categoria: true, user: true, quincena: true, metodoPago: true, presupuesto: true },
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
    const { fecha, quincenaId, userId, descripcion, categoriaId, tipo, direccion, apartadoId, monto, metodoPagoId, estatus, notas, presupuestoId } = body

    // Si cambia la categoria, el tipo, o la direccion, hay que re-resolver
    // contra la categoria efectiva para que una transaccion de "Ahorro"
    // nunca pueda terminar con otro tipo (ver @/lib/transaccion-ahorro).
    let tipoResuelto: string | undefined
    let direccionResuelta: string | null | undefined
    if (categoriaId !== undefined || tipo !== undefined || direccion !== undefined) {
      const current = await prisma.transaccion.findUnique({ where: { id }, select: { categoriaId: true } })
      if (!current) {
        return NextResponse.json({ error: 'Transacción not found' }, { status: 404 })
      }
      const effectiveCategoriaId = categoriaId ? parseInt(categoriaId) : current.categoriaId
      const categoria = await prisma.categoria.findUnique({ where: { id: effectiveCategoriaId } })
      if (!categoria) {
        return NextResponse.json({ error: 'Categoria not found' }, { status: 400 })
      }
      const resuelto = resolverTipoYDireccion(categoria.tipo, tipo, direccion)
      tipoResuelto = resuelto.tipo
      direccionResuelta = resuelto.direccion
    }

    const transaccion = await prisma.transaccion.update({
      where: { id },
      data: {
        ...(fecha && { fecha: new Date(fecha) }),
        ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
        ...(userId !== undefined && { userId: userId ? parseInt(userId) : null }),
        ...(descripcion && { descripcion }),
        ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
        ...(tipoResuelto !== undefined && { tipo: tipoResuelto, direccion: direccionResuelta }),
        ...(apartadoId !== undefined && { apartadoId: apartadoId ? parseInt(apartadoId) : null }),
        ...(monto !== undefined && { monto: parseFloat(monto) }),
        ...(metodoPagoId !== undefined && { metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null }),
        ...(estatus && { estatus }),
        ...(notas !== undefined && { notas }),
        ...(presupuestoId !== undefined && { presupuestoId: presupuestoId ? parseInt(presupuestoId) : null }),
      },
      include: { categoria: true, user: true, quincena: true, presupuesto: true },
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
