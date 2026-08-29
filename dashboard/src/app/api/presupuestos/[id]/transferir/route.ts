import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { cerrarSiCorresponde, conNota, montoEfectivoDePrisma } from '@/lib/cierre-quincena-server'

// Cubre un excedente moviendo Presupuesto Modificado entre dos lineas (o
// desde el colchon "sin asignar" de la quincena, sin donante). El Original
// (montoPresupuestado) nunca se toca en ninguna de las dos filas -- es
// exactamente el traspaso presupuestal de doble entrada que discutimos:
// conservacion total, nunca automatico, siempre con rastro en notas.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const destino = await prisma.presupuesto.findUnique({ where: { id } })
    if (!destino) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    const body = await request.json()
    const monto = parseFloat(body.monto)
    const origenId = body.origenId ? parseInt(body.origenId) : null
    const nota: string | undefined = body.nota || undefined

    if (!monto || monto <= 0) {
      return NextResponse.json({ error: 'monto invalido' }, { status: 400 })
    }

    const efectivoDestinoActual = montoEfectivoDePrisma(destino)
    const nuevoEfectivoDestino = efectivoDestinoActual + monto
    const session = await getSession()

    if (origenId) {
      const origen = await prisma.presupuesto.findUnique({ where: { id: origenId } })
      if (!origen) {
        return NextResponse.json({ error: 'Línea origen no encontrada' }, { status: 404 })
      }
      if (origen.quincenaId !== destino.quincenaId) {
        return NextResponse.json({ error: 'El traspaso solo aplica entre líneas de la misma quincena' }, { status: 400 })
      }

      const origenRealAgg = await prisma.transaccion.aggregate({
        where: { presupuestoId: origenId },
        _sum: { monto: true },
      })
      const origenReal = Number(origenRealAgg._sum.monto ?? 0)
      const efectivoOrigenActual = montoEfectivoDePrisma(origen)
      const disponibleOrigen = efectivoOrigenActual - origenReal

      // Nunca dejar a la linea donante con menos de lo que ya gasto -- si no,
      // el traspaso es un numero de papel que no refleja liquidez real.
      if (monto > disponibleOrigen) {
        return NextResponse.json(
          { error: `"${origen.descripcion}" solo tiene ${disponibleOrigen.toFixed(2)} disponible` },
          { status: 400 }
        )
      }

      await prisma.$transaction([
        prisma.presupuesto.update({
          where: { id: origenId },
          data: {
            montoRevisado: efectivoOrigenActual - monto,
            notas: conNota(origen.notas, `Traspaso: -$${monto.toFixed(2)} hacia "${destino.descripcion}"`, nota),
          },
        }),
        prisma.presupuesto.update({
          where: { id },
          data: {
            montoRevisado: nuevoEfectivoDestino,
            notas: conNota(destino.notas, `Traspaso: +$${monto.toFixed(2)} desde "${origen.descripcion}"`, nota),
          },
        }),
      ])
    } else {
      await prisma.presupuesto.update({
        where: { id },
        data: {
          montoRevisado: nuevoEfectivoDestino,
          notas: conNota(destino.notas, `Cubierto desde sin asignar: +$${monto.toFixed(2)}`, nota),
        },
      })
    }

    await cerrarSiCorresponde(destino.quincenaId, session?.username ?? null)

    const updated = await prisma.presupuesto.findUnique({ where: { id }, include: { categoria: true, quincena: true } })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error en traspaso de presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
