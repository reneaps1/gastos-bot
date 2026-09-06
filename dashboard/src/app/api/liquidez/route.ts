import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { faltaPorPagarDeQuincena } from '@/lib/cierre-quincena-server'
import { calcularPagosQuincena } from '@/lib/pagos-quincena'
import { calcularGastosAlCorte } from '@/lib/gastos-snapshot'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')

    const where: { quincenaId?: number } = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)

    const snapshots = await prisma.liquidezSnapshot.findMany({
      where,
      include: {
        quincena: true,
        montos: { include: { cuenta: true }, orderBy: { cuenta: { orden: 'asc' } } },
      },
      orderBy: [
        { fechaCorte: 'desc' },
        { fechaRegistro: 'desc' },
        { id: 'desc' },
      ],
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
    const { fechaCorte, quincenaId, montos, teorico, notas, validado } = body

    if (!fechaCorte || !quincenaId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const quincenaIdNum = parseInt(quincenaId)
    // faltaPagar y pagosQuincena nunca se aceptan del cliente -- se calculan en
    // vivo contra el presupuesto/creditos reales de la quincena, para que un
    // snapshot nunca nazca ya desactualizado. Ver
    // dashboard/src/lib/cierre-quincena-server.ts y lib/pagos-quincena.ts.
    const fechaCorteDate = new Date(fechaCorte)
    const [faltaPagarCalc, pagosQuincenaCalc, gastosAlCorte] = await Promise.all([
      faltaPorPagarDeQuincena(quincenaIdNum),
      calcularPagosQuincena(quincenaIdNum),
      calcularGastosAlCorte(quincenaIdNum, fechaCorteDate),
    ])

    const montosList: { cuentaId: number; monto: number; nota: string | null }[] = Array.isArray(montos)
      ? montos
          .map((m: { cuentaId: number | string; monto?: number | string; nota?: string | null }) => ({
            cuentaId: parseInt(String(m.cuentaId)),
            monto: parseFloat(String(m.monto ?? 0)) || 0,
            nota: m.nota || null,
          }))
          .filter(m => !isNaN(m.cuentaId))
      : []

    const snapshot = await prisma.liquidezSnapshot.create({
      data: {
        fechaCorte: fechaCorteDate,
        quincenaId: quincenaIdNum,
        faltaPagar: faltaPagarCalc,
        pagosQuincena: pagosQuincenaCalc.pagosQuincena,
        gastosReales: gastosAlCorte.gastosReales,
        gastosPronosticados: gastosAlCorte.gastosPronosticados,
        teorico: teorico ? parseFloat(teorico) : null,
        notas,
        validado: validado ?? false,
        montos: { create: montosList },
      },
      include: { quincena: true, montos: { include: { cuenta: true } } },
    })

    return NextResponse.json(snapshot, { status: 201 })
  } catch (error) {
    console.error('Error creating liquidez snapshot:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
