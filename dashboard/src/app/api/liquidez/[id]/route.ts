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

    const snapshot = await prisma.liquidezSnapshot.findUnique({
      where: { id },
      include: { quincena: true },
    })
    if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('Error fetching liquidez snapshot:', error)
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
    const {
      fechaCorte, quincenaId, bbva, banamex, uala, ualaInversion,
      efectivo, valesDespensa, valesGasolina, otros, otrosNota,
      faltaPagar, teorico, notas, validado
    } = body

    const snapshot = await prisma.liquidezSnapshot.update({
      where: { id },
      data: {
        ...(fechaCorte && { fechaCorte: new Date(fechaCorte) }),
        ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
        ...(bbva !== undefined && { bbva: parseFloat(bbva) }),
        ...(banamex !== undefined && { banamex: parseFloat(banamex) }),
        ...(uala !== undefined && { uala: parseFloat(uala) }),
        ...(ualaInversion !== undefined && { ualaInversion: parseFloat(ualaInversion) }),
        ...(efectivo !== undefined && { efectivo: parseFloat(efectivo) }),
        ...(valesDespensa !== undefined && { valesDespensa: parseFloat(valesDespensa) }),
        ...(valesGasolina !== undefined && { valesGasolina: parseFloat(valesGasolina) }),
        ...(otros !== undefined && { otros: parseFloat(otros) }),
        ...(otrosNota !== undefined && { otrosNota }),
        ...(faltaPagar !== undefined && { faltaPagar: parseFloat(faltaPagar) }),
        ...(teorico !== undefined && { teorico: teorico ? parseFloat(teorico) : null }),
        ...(notas !== undefined && { notas }),
        ...(validado !== undefined && { validado }),
      },
      include: { quincena: true },
    })

    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('Error updating liquidez snapshot:', error)
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

    await prisma.liquidezSnapshot.delete({ where: { id } })

    return NextResponse.json({ message: 'Snapshot deleted' })
  } catch (error) {
    console.error('Error deleting liquidez snapshot:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
