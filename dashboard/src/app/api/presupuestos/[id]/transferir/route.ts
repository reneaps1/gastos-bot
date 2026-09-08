import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { cerrarSiCorresponde, conNota } from '@/lib/cierre-quincena-server'
import { montoEfectivoPresupuesto, registrarCambioPresupuesto } from '@/lib/presupuesto-cambios'

// Cubre un excedente moviendo Presupuesto Modificado entre dos lineas (o
// desde el colchon "sin asignar" de la quincena, sin donante). El Original
// (montoPresupuestado) nunca se toca. Cada movimiento queda registrado en
// presupuesto_cambios dentro de la MISMA transaccion que modifica los montos.
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

    const body = await request.json()
    const monto = parseFloat(body.monto)
    const origenId = body.origenId ? parseInt(body.origenId) : null
    const nota: string | undefined = body.nota || undefined

    if (!monto || monto <= 0) {
      return NextResponse.json({ error: 'monto invalido' }, { status: 400 })
    }
    if (origenId === id) {
      return NextResponse.json({ error: 'La línea origen y destino deben ser distintas' }, { status: 400 })
    }

    const session = await getSession()
    const actor = session?.username ?? null
    const grupoCambioId = randomUUID()

    const resultado = await prisma.$transaction(async tx => {
      const destino = await tx.presupuesto.findUnique({ where: { id } })
      if (!destino) throw new Error('PRESUPUESTO_NOT_FOUND')

      const efectivoDestinoActual = montoEfectivoPresupuesto(destino)
      const nuevoEfectivoDestino = efectivoDestinoActual + monto

      if (origenId) {
        const origen = await tx.presupuesto.findUnique({ where: { id: origenId } })
        if (!origen) throw new Error('ORIGEN_NOT_FOUND')
        if (origen.quincenaId !== destino.quincenaId) throw new Error('QUINCENA_DISTINTA')

        const origenRealAgg = await tx.transaccion.aggregate({
          where: { presupuestoId: origenId },
          _sum: { monto: true },
        })
        const origenReal = Number(origenRealAgg._sum.monto ?? 0)
        const efectivoOrigenActual = montoEfectivoPresupuesto(origen)
        const disponibleOrigen = efectivoOrigenActual - origenReal

        // Nunca dejar a la linea donante con menos de lo que ya gasto -- si no,
        // el traspaso es un numero de papel que no refleja liquidez real.
        if (monto > disponibleOrigen) {
          throw new Error(`DISPONIBLE_ORIGEN:${disponibleOrigen.toFixed(2)}:${origen.descripcion}`)
        }

        const nuevoEfectivoOrigen = efectivoOrigenActual - monto

        await tx.presupuesto.update({
          where: { id: origenId },
          data: {
            montoRevisado: nuevoEfectivoOrigen,
            notas: conNota(origen.notas, `Traspaso: -$${monto.toFixed(2)} hacia "${destino.descripcion}"`, nota),
          },
        })
        await registrarCambioPresupuesto(tx, {
          presupuestoId: origen.id,
          quincenaId: origen.quincenaId,
          tipo: 'TRASPASO_SALIDA',
          montoAnterior: efectivoOrigenActual,
          montoNuevo: nuevoEfectivoOrigen,
          grupoCambioId,
          presupuestoRelacionadoId: destino.id,
          motivo: nota ?? null,
          actor,
        })

        await tx.presupuesto.update({
          where: { id },
          data: {
            montoRevisado: nuevoEfectivoDestino,
            notas: conNota(destino.notas, `Traspaso: +$${monto.toFixed(2)} desde "${origen.descripcion}"`, nota),
          },
        })
        await registrarCambioPresupuesto(tx, {
          presupuestoId: destino.id,
          quincenaId: destino.quincenaId,
          tipo: 'TRASPASO_ENTRADA',
          montoAnterior: efectivoDestinoActual,
          montoNuevo: nuevoEfectivoDestino,
          grupoCambioId,
          presupuestoRelacionadoId: origen.id,
          motivo: nota ?? null,
          actor,
        })
      } else {
        await tx.presupuesto.update({
          where: { id },
          data: {
            montoRevisado: nuevoEfectivoDestino,
            notas: conNota(destino.notas, `Cubierto desde sin asignar: +$${monto.toFixed(2)}`, nota),
          },
        })
        await registrarCambioPresupuesto(tx, {
          presupuestoId: destino.id,
          quincenaId: destino.quincenaId,
          tipo: 'DESDE_SIN_ASIGNAR',
          montoAnterior: efectivoDestinoActual,
          montoNuevo: nuevoEfectivoDestino,
          grupoCambioId,
          motivo: nota ?? null,
          actor,
        })
      }

      return { quincenaId: destino.quincenaId }
    })

    await cerrarSiCorresponde(resultado.quincenaId, actor)

    const updated = await prisma.presupuesto.findUnique({
      where: { id },
      include: { categoria: true, quincena: true },
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'PRESUPUESTO_NOT_FOUND') {
        return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
      }
      if (error.message === 'ORIGEN_NOT_FOUND') {
        return NextResponse.json({ error: 'Línea origen no encontrada' }, { status: 404 })
      }
      if (error.message === 'QUINCENA_DISTINTA') {
        return NextResponse.json({ error: 'El traspaso solo aplica entre líneas de la misma quincena' }, { status: 400 })
      }
      if (error.message.startsWith('DISPONIBLE_ORIGEN:')) {
        const [, disponible, descripcion] = error.message.split(':')
        return NextResponse.json(
          { error: `"${descripcion}" solo tiene ${disponible} disponible` },
          { status: 400 }
        )
      }
    }
    console.error('Error en traspaso de presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
