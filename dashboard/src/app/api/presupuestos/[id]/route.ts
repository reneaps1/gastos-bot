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

    const presupuesto = await prisma.presupuesto.findUnique({
      where: { id },
      include: { categoria: true, quincena: true },
    })

    if (!presupuesto) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    return NextResponse.json(presupuesto)
  } catch (error) {
    console.error('Error fetching presupuesto:', error)
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
    const { quincenaId, descripcion, categoriaId, montoPresupuestado, clasificacion, tipo, notas, diaCobro, fechaVencimiento } = body

    const presupuesto = await prisma.presupuesto.update({
      where: { id },
      data: {
        ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
        ...(descripcion && { descripcion }),
        ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
        ...(montoPresupuestado !== undefined && { montoPresupuestado: parseFloat(montoPresupuestado) }),
        ...(clasificacion !== undefined && { clasificacion }),
        ...(tipo && { tipo }),
        ...(notas !== undefined && { notas }),
        ...(diaCobro !== undefined && { diaCobro: diaCobro !== null && diaCobro !== '' ? parseInt(diaCobro) : null }),
        ...(fechaVencimiento !== undefined && { fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null }),
      },
      include: { categoria: true, quincena: true },
    })

    return NextResponse.json(presupuesto)
  } catch (error) {
    console.error('Error updating presupuesto:', error)
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

    const { searchParams } = new URL(request.url)
    const grupoId = searchParams.get('grupoId')

    if (grupoId) {
      const { count } = await prisma.presupuesto.deleteMany({
        where: { recurrenciaGrupoId: grupoId },
      })
      return NextResponse.json({ message: 'Grupo eliminado', count })
    }

    await prisma.presupuesto.delete({ where: { id } })
    return NextResponse.json({ message: 'Presupuesto deleted' })
  } catch (error) {
    console.error('Error deleting presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
