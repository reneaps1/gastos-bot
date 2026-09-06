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
      include: { quincena: true, montos: { include: { cuenta: true } } },
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
    const { fechaCorte, quincenaId, montos, teorico, notas, validado } = body

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

    const montosList: { cuentaId: number; monto: number; nota: string | null }[] | undefined = Array.isArray(montos)
      ? montos
          .map((m: { cuentaId: number | string; monto?: number | string; nota?: string | null }) => ({
            cuentaId: parseInt(String(m.cuentaId)),
            monto: parseFloat(String(m.monto ?? 0)) || 0,
            nota: m.nota || null,
          }))
          .filter(m => !isNaN(m.cuentaId))
      : undefined

    // Las lineas de montos se reemplazan por completo cuando el cliente manda
    // el arreglo -- mas simple y seguro que hacer un diff fila por fila, y el
    // formulario siempre manda el estado completo del corte.
    const snapshot = await prisma.$transaction(async tx => {
      if (montosList) {
        await tx.liquidezSnapshotCuenta.deleteMany({ where: { snapshotId: id } })
      }
      return tx.liquidezSnapshot.update({
        where: { id },
        data: {
          ...(fechaCorte && { fechaCorte: new Date(fechaCorte) }),
          ...(quincenaId && { quincenaId: quincenaIdEfectiva }),
          faltaPagar: faltaPagarCalc,
          pagosQuincena: pagosQuincenaCalc.pagosQuincena,
          gastosReales: gastosAlCorte.gastosReales,
          gastosPronosticados: gastosAlCorte.gastosPronosticados,
          ...(teorico !== undefined && { teorico: teorico ? parseFloat(teorico) : null }),
          ...(notas !== undefined && { notas }),
          ...(validado !== undefined && { validado }),
          ...(montosList && { montos: { create: montosList } }),
        },
        include: { quincena: true, montos: { include: { cuenta: true } } },
      })
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
