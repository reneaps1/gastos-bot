import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { faltaPorPagarDeQuincena } from '@/lib/cierre-quincena-server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)

    const snapshots = await prisma.liquidezSnapshot.findMany({
      where,
      include: { quincena: true },
      orderBy: { fechaCorte: 'desc' },
    })

    return NextResponse.json(snapshots)
  } catch (error) {
    console.error('Error fetching liquidez:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      fechaCorte, quincenaId, bbva, banamex, uala, ualaInversion,
      efectivo, valesDespensa, valesGasolina, otros, otrosNota,
      teorico, notas, validado
    } = body

    if (!fechaCorte || !quincenaId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const quincenaIdNum = parseInt(quincenaId)
    // faltaPagar nunca se acepta del cliente -- se calcula en vivo contra el
    // presupuesto real de la quincena, para que un snapshot nunca nazca ya
    // desactualizado. Ver dashboard/src/lib/cierre-quincena-server.ts.
    const faltaPagarCalc = await faltaPorPagarDeQuincena(quincenaIdNum)

    const snapshot = await prisma.liquidezSnapshot.create({
      data: {
        fechaCorte: new Date(fechaCorte),
        quincenaId: quincenaIdNum,
        bbva: bbva ? parseFloat(bbva) : 0,
        banamex: banamex ? parseFloat(banamex) : 0,
        uala: uala ? parseFloat(uala) : 0,
        ualaInversion: ualaInversion ? parseFloat(ualaInversion) : 0,
        efectivo: efectivo ? parseFloat(efectivo) : 0,
        valesDespensa: valesDespensa ? parseFloat(valesDespensa) : 0,
        valesGasolina: valesGasolina ? parseFloat(valesGasolina) : 0,
        otros: otros ? parseFloat(otros) : 0,
        otrosNota: otrosNota ?? null,
        faltaPagar: faltaPagarCalc,
        teorico: teorico ? parseFloat(teorico) : null,
        notas,
        validado: validado ?? false,
      },
      include: { quincena: true },
    })

    return NextResponse.json(snapshot, { status: 201 })
  } catch (error) {
    console.error('Error creating liquidez snapshot:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
