import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findOverlap, findGapWarnings } from '@/lib/quincena-validation'
import { parseMontoReferencia } from '@/lib/referencia'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const quincena = await prisma.quincena.findUnique({ where: { id } })
    if (!quincena) return NextResponse.json({ error: 'Quincena not found' }, { status: 404 })

    return NextResponse.json(quincena)
  } catch (error) {
    console.error('Error fetching quincena:', error)
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

    const current = await prisma.quincena.findUnique({ where: { id } })
    if (!current) return NextResponse.json({ error: 'Quincena not found' }, { status: 404 })

    const body = await request.json()
    const { codigo, fechaInicio, fechaFin, tipo, ingresoReferencia, limiteGastoReferencia } = body

    const ingreso = parseMontoReferencia(ingresoReferencia, 'ingresoReferencia')
    if (!ingreso.ok) return NextResponse.json({ error: ingreso.error }, { status: 400 })
    const limite = parseMontoReferencia(limiteGastoReferencia, 'limiteGastoReferencia')
    if (!limite.ok) return NextResponse.json({ error: limite.error }, { status: 400 })

    const nextFechaInicio = fechaInicio !== undefined ? fechaInicio : current.fechaInicio.toISOString().slice(0, 10)
    const nextFechaFin = fechaFin !== undefined ? fechaFin : current.fechaFin.toISOString().slice(0, 10)
    if (nextFechaFin < nextFechaInicio) {
      return NextResponse.json({ error: 'fechaFin debe ser posterior a fechaInicio' }, { status: 400 })
    }

    if (codigo !== undefined && codigo !== current.codigo) {
      const dup = await prisma.quincena.findFirst({ where: { codigo, id: { not: id } } })
      if (dup) return NextResponse.json({ error: 'Quincena already exists' }, { status: 409 })
    }

    const others = await prisma.quincena.findMany({ where: { id: { not: id } }, orderBy: { fechaInicio: 'asc' } })
    const datesChanged = fechaInicio !== undefined || fechaFin !== undefined
    if (datesChanged) {
      const overlap = findOverlap(others, nextFechaInicio, nextFechaFin)
      if (overlap) {
        return NextResponse.json({ error: `Se traslapa con ${overlap.codigo}` }, { status: 409 })
      }
    }

    const warnings: string[] = []
    if (datesChanged) {
      warnings.push(...findGapWarnings(others, nextFechaInicio, nextFechaFin))

      const [txFuera, pagosFuera] = await Promise.all([
        prisma.transaccion.count({
          where: {
            OR: [{ quincenaId: id }, { quincenaConsumoId: id }],
            NOT: { fecha: { gte: new Date(`${nextFechaInicio}T00:00:00.000Z`), lte: new Date(`${nextFechaFin}T00:00:00.000Z`) } },
          },
        }),
        prisma.creditoPago.count({
          where: {
            quincenaId: id,
            NOT: { fechaPagoProgramada: { gte: new Date(`${nextFechaInicio}T00:00:00.000Z`), lte: new Date(`${nextFechaFin}T00:00:00.000Z`) } },
          },
        }),
      ])
      if (txFuera > 0) warnings.push(`${txFuera} transaccion(es) con fecha fuera del nuevo rango siguen asignadas a esta quincena.`)
      if (pagosFuera > 0) warnings.push(`${pagosFuera} pago(s) de credito con fecha programada fuera del nuevo rango siguen asignados a esta quincena.`)
    }

    const quincena = await prisma.quincena.update({
      where: { id },
      data: {
        ...(codigo !== undefined && { codigo }),
        ...(fechaInicio !== undefined && { fechaInicio: new Date(fechaInicio) }),
        ...(fechaFin !== undefined && { fechaFin: new Date(fechaFin) }),
        ...(tipo !== undefined && { tipo }),
        ...(ingreso.value !== undefined && { ingresoReferencia: ingreso.value }),
        ...(limite.value !== undefined && { limiteGastoReferencia: limite.value }),
      },
    })

    return NextResponse.json({ ...quincena, warnings })
  } catch (error) {
    console.error('Error updating quincena:', error)
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

    const [transacciones, transaccionesConsumo, presupuestos, liquidez, creditoPagos, pendientes] = await Promise.all([
      prisma.transaccion.count({ where: { quincenaId: id } }),
      prisma.transaccion.count({ where: { quincenaConsumoId: id } }),
      prisma.presupuesto.count({ where: { quincenaId: id } }),
      prisma.liquidezSnapshot.count({ where: { quincenaId: id } }),
      prisma.creditoPago.count({ where: { quincenaId: id } }),
      prisma.pendingExpense.count({ where: { quincenaId: id } }),
    ])
    const total = transacciones + transaccionesConsumo + presupuestos + liquidez + creditoPagos + pendientes
    if (total > 0) {
      const detalle = [
        transacciones && `${transacciones} transaccion(es)`,
        transaccionesConsumo && `${transaccionesConsumo} transaccion(es) (consumo)`,
        presupuestos && `${presupuestos} presupuesto(s)`,
        liquidez && `${liquidez} snapshot(s) de liquidez`,
        creditoPagos && `${creditoPagos} pago(s) de credito`,
        pendientes && `${pendientes} gasto(s) pendiente(s)`,
      ].filter(Boolean).join(', ')
      return NextResponse.json({ error: `No se puede eliminar: tiene ${detalle} asociados` }, { status: 409 })
    }

    await prisma.quincena.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting quincena:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
