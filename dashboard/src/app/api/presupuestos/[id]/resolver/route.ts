import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { cerrarSiCorresponde, conNota } from '@/lib/cierre-quincena-server'

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

    const current = await prisma.presupuesto.findUnique({ where: { id }, include: { categoria: true, quincena: true } })
    if (!current) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    const body = await request.json()
    const { accion } = body
    const session = await getSession()
    const quincenaOriginalId = current.quincenaId

    if (accion === 'pagar_existente') {
      await prisma.transaccion.updateMany({
        where: { presupuestoId: id, estatus: 'Pendiente' },
        data: { estatus: 'Pagado' },
      })
      await prisma.presupuesto.update({ where: { id }, data: { estadoLinea: 'Cumplida' } })
    } else if (accion === 'registrar_pagado') {
      const { fecha, monto } = body
      if (!fecha || monto === undefined) {
        return NextResponse.json({ error: 'fecha y monto son requeridos' }, { status: 400 })
      }
      await prisma.transaccion.create({
        data: {
          fecha: new Date(fecha),
          quincenaId: current.quincenaId,
          quincenaConsumoId: current.quincenaId,
          descripcion: current.descripcion,
          categoriaId: current.categoriaId,
          tipo: 'Gasto',
          monto: parseFloat(monto),
          estatus: 'Pagado',
          source: 'cierre-quincena',
          presupuestoId: id,
        },
      })
      await prisma.presupuesto.update({ where: { id }, data: { estadoLinea: 'Cumplida' } })
    } else if (accion === 'mover') {
      const { targetQuincenaId } = body
      if (!targetQuincenaId) {
        return NextResponse.json({ error: 'targetQuincenaId es requerido' }, { status: 400 })
      }
      await prisma.presupuesto.update({ where: { id }, data: { quincenaId: parseInt(targetQuincenaId) } })
    } else if (accion === 'cancelar') {
      await prisma.presupuesto.update({
        where: { id },
        data: { estadoLinea: 'Cancelada', notas: conNota(current.notas, 'Cancelada', body.nota) },
      })
    } else if (accion === 'absorber') {
      await prisma.presupuesto.update({
        where: { id },
        data: { estadoLinea: 'Absorbida', notas: conNota(current.notas, 'Variacion aceptada', body.nota) },
      })
    } else {
      return NextResponse.json({ error: 'accion invalida' }, { status: 400 })
    }

    await cerrarSiCorresponde(quincenaOriginalId, session?.username ?? null)

    const updated = await prisma.presupuesto.findUnique({ where: { id }, include: { categoria: true, quincena: true } })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error resolviendo presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
