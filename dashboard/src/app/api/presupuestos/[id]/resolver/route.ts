import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { motivoPendiente } from '@/lib/cierre-quincena'

// Revisa si a esta quincena (ya terminada) le sigue faltando resolver alguna
// linea de Gasto "Abierta" -- mismo calculo real/pendiente que ya hace el GET
// de /api/presupuestos, acotado a una sola quincena. Si ya no queda nada, la
// cierra sola (fechaCierre/cerradaPor). Se llama despues de cada accion de
// esta ruta porque cualquiera de ellas puede haber sido la ultima pendiente.
async function cerrarSiCorresponde(quincenaId: number, username: string | null) {
  const quincena = await prisma.quincena.findUnique({ where: { id: quincenaId } })
  if (!quincena || quincena.fechaCierre) return
  if (quincena.fechaFin.toISOString().split('T')[0] >= getMexicoDateString()) return

  const lineas = await prisma.presupuesto.findMany({
    where: { quincenaId, estadoLinea: 'Abierta' },
    include: { categoria: true },
  })
  const gastoLineas = lineas.filter(l => l.categoria.tipo === 'Gasto')
  if (gastoLineas.length === 0) {
    await prisma.quincena.update({ where: { id: quincenaId }, data: { fechaCierre: new Date(), cerradaPor: username } })
    return
  }

  const ids = gastoLineas.map(l => l.id)
  const rows = await prisma.transaccion.groupBy({
    by: ['presupuestoId', 'estatus'],
    where: { presupuestoId: { in: ids } },
    _sum: { monto: true },
  })
  const realMap = new Map<number, number>()
  const pendMap = new Map<number, number>()
  for (const r of rows) {
    const id = r.presupuestoId as number
    const monto = Number(r._sum.monto ?? 0)
    realMap.set(id, (realMap.get(id) ?? 0) + monto)
    if (r.estatus === 'Pendiente') pendMap.set(id, (pendMap.get(id) ?? 0) + monto)
  }

  const quedaAlgo = gastoLineas.some(l => motivoPendiente({
    id: l.id,
    descripcion: l.descripcion,
    montoPresupuestado: l.montoPresupuestado.toString(),
    real: realMap.get(l.id) ?? 0,
    pendiente: pendMap.get(l.id) ?? 0,
    estadoLinea: l.estadoLinea,
    categoria: l.categoria,
  }) !== null)

  if (!quedaAlgo) {
    await prisma.quincena.update({ where: { id: quincenaId }, data: { fechaCierre: new Date(), cerradaPor: username } })
  }
}

function conNota(notasActuales: string | null, etiqueta: string, nota?: string) {
  const linea = nota ? `${etiqueta}: ${nota}` : `${etiqueta} (${getMexicoDateString()})`
  return notasActuales ? `${notasActuales}\n${linea}` : linea
}

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
