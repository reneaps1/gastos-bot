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

    const entrada = await prisma.entradaRapida.findUnique({
      where: { id },
      include: { categoria: true, quincena: true, transaccion: true },
    })
    if (!entrada) return NextResponse.json({ error: 'Entrada not found' }, { status: 404 })

    return NextResponse.json(entrada)
  } catch (error) {
    console.error('Error fetching entrada rapida:', error)
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
    const { fecha, descripcion, monto, categoriaId, tipo, quincenaId, notas, procesado, transaccionId } = body

    const entrada = await prisma.entradaRapida.update({
      where: { id },
      data: {
        ...(fecha && { fecha: new Date(fecha) }),
        ...(descripcion && { descripcion }),
        ...(monto !== undefined && { monto: parseFloat(monto) }),
        ...(categoriaId !== undefined && { categoriaId: categoriaId ? parseInt(categoriaId) : null }),
        ...(tipo !== undefined && { tipo }),
        ...(quincenaId !== undefined && { quincenaId: quincenaId ? parseInt(quincenaId) : null }),
        ...(notas !== undefined && { notas: notas || null }),
        ...(procesado !== undefined && { procesado }),
        ...(transaccionId !== undefined && { transaccionId: transaccionId ? parseInt(transaccionId) : null }),
      },
      include: { categoria: true, quincena: true },
    })

    return NextResponse.json(entrada)
  } catch (error) {
    console.error('Error updating entrada rapida:', error)
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

    await prisma.entradaRapida.delete({ where: { id } })

    return NextResponse.json({ message: 'Entrada rapida deleted' })
  } catch (error) {
    console.error('Error deleting entrada rapida:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
