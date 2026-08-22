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

    const categoria = await prisma.categoria.findUnique({ where: { id } })
    if (!categoria) return NextResponse.json({ error: 'Categoria not found' }, { status: 404 })

    return NextResponse.json(categoria)
  } catch (error) {
    console.error('Error fetching categoria:', error)
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
    const { nombre, tipo, clasificacion, ejemplos, activo, cuentaParaLimite } = body

    const categoria = await prisma.categoria.update({
      where: { id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(tipo !== undefined && { tipo }),
        ...(clasificacion !== undefined && { clasificacion }),
        ...(ejemplos !== undefined && { ejemplos }),
        ...(activo !== undefined && { activo }),
        ...(cuentaParaLimite !== undefined && { cuentaParaLimite }),
      },
    })

    return NextResponse.json(categoria)
  } catch (error) {
    console.error('Error updating categoria:', error)
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

    const txCount = await prisma.transaccion.count({ where: { categoriaId: id } })
    if (txCount > 0) {
      return NextResponse.json({ error: `No se puede eliminar: tiene ${txCount} transacciones asociadas` }, { status: 409 })
    }

    await prisma.categoria.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting categoria:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
