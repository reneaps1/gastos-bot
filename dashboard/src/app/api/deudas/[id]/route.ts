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

    const deuda = await prisma.deuda.findUnique({ where: { id } })
    if (!deuda) return NextResponse.json({ error: 'Deuda not found' }, { status: 404 })

    return NextResponse.json(deuda)
  } catch (error) {
    console.error('Error fetching deuda:', error)
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
    const { acreedor, deudaOriginal, abonoMensual, notas, fechaInicio, activo } = body

    const deuda = await prisma.deuda.update({
      where: { id },
      data: {
        ...(acreedor !== undefined && { acreedor }),
        ...(deudaOriginal !== undefined && { deudaOriginal: parseFloat(deudaOriginal) }),
        ...(abonoMensual !== undefined && { abonoMensual: abonoMensual ? parseFloat(abonoMensual) : null }),
        ...(notas !== undefined && { notas }),
        ...(fechaInicio !== undefined && { fechaInicio: fechaInicio ? new Date(fechaInicio) : null }),
        ...(activo !== undefined && { activo }),
      },
    })

    return NextResponse.json(deuda)
  } catch (error) {
    console.error('Error updating deuda:', error)
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

    await prisma.deuda.delete({ where: { id } })

    return NextResponse.json({ message: 'Deuda deleted' })
  } catch (error) {
    console.error('Error deleting deuda:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
