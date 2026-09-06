import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const apartado = await prisma.apartado.findUnique({ where: { id } })
    if (!apartado) return NextResponse.json({ error: 'Apartado not found' }, { status: 404 })

    return NextResponse.json(apartado)
  } catch (error) {
    console.error('Error fetching apartado:', error)
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
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await request.json()
    const { nombre, metaMonto, icono, color, activo } = body

    const apartado = await prisma.apartado.update({
      where: { id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(metaMonto !== undefined && { metaMonto: metaMonto === null || metaMonto === '' ? null : parseFloat(metaMonto) }),
        ...(icono !== undefined && { icono: icono || null }),
        ...(color !== undefined && { color: color || null }),
        ...(activo !== undefined && { activo }),
      },
    })

    return NextResponse.json(apartado)
  } catch (error) {
    console.error('Error updating apartado:', error)
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
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const txCount = await prisma.transaccion.count({ where: { apartadoId: id } })
    if (txCount > 0) {
      return NextResponse.json({ error: `No se puede eliminar: tiene ${txCount} transacciones asociadas` }, { status: 409 })
    }

    await prisma.apartado.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting apartado:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
