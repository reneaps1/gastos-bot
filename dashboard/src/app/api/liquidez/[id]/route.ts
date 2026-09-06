import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { faltaPorPagarDeQuincena } from '@/lib/cierre-quincena-server'
import { calcularPagosQuincena } from '@/lib/pagos-quincena'
import { calcularGastosAlCorte } from '@/lib/gastos-snapshot'

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
      teorico, notas, validado
    } = body

    // faltaPagar y pagosQuincena nunca se aceptan del cliente -- se recalculan
    // en vivo contra el presupuesto/creditos reales de la quincena efectiva (la
    // nueva si se reasigna, si no la que ya tenía el snapshot). Ver
    // cierre-quincena-server.ts y lib/pagos-quincena.ts.
    const existing = await prisma.liquidezSnapshot.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    const quincenaIdEfectiva = quincenaId ? parseInt(quincenaId) : existing.quincenaId
    const fechaCorteEfectiva = fechaCorte ? new Date(fechaCorte) : existing.fechaCorte
    const [faltaPagarCalc, pagosQuincenaCalc, gastosAlCorte] = await Promise.all([
      faltaPorPagarDeQuincena(quincenaIdEfectiva),
      calcularPagosQuincena(quincenaIdEfectiva),
      calcularGastosAlCorte(quincenaIdEfectiva, fechaCorteEfectiva),
    ])

    const snapshot = await prisma.liquidezSnapshot.update({
      where: { id },
      data: {
        ...(fechaCorte && { fechaCorte: new Date(fechaCorte) }),
        ...(quincenaId && { quincenaId: quincenaIdEfectiva }),
        ...(bbva !== undefined && { bbva: parseFloat(bbva) }),
        ...(banamex !== undefined && { banamex: parseFloat(banamex) }),
        ...(uala !== undefined && { uala: parseFloat(uala) }),
        ...(ualaInversion !== undefined && { ualaInversion: parseFloat(ualaInversion) }),
        ...(efectivo !== undefined && { efectivo: parseFloat(efectivo) }),
        ...(valesDespensa !== undefined && { valesDespensa: parseFloat(valesDespensa) }),
        ...(valesGasolina !== undefined && { valesGasolina: parseFloat(valesGasolina) }),
        ...(otros !== undefined && { otros: parseFloat(otros) }),
        ...(otrosNota !== undefined && { otrosNota }),
        faltaPagar: faltaPagarCalc,
        pagosQuincena: pagosQuincenaCalc.pagosQuincena,
        gastosReales: gastosAlCorte.gastosReales,
        gastosPronosticados: gastosAlCorte.gastosPronosticados,
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
