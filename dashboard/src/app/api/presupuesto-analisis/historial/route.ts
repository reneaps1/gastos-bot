import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const MAX_QUINCENAS = 48

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ids = Array.from(new Set(
      (searchParams.get('quincenaIds') ?? '')
        .split(',')
        .map(v => Number.parseInt(v.trim(), 10))
        .filter(Number.isFinite),
    )).slice(0, MAX_QUINCENAS)

    if (ids.length === 0) {
      return NextResponse.json({ cambios: [] })
    }

    const cambios = await prisma.presupuestoCambio.findMany({
      where: {
        quincenaId: { in: ids },
        presupuesto: { categoria: { tipo: 'Gasto' } },
      },
      orderBy: [
        { fechaCreacion: 'asc' },
        { id: 'asc' },
      ],
      include: {
        presupuesto: {
          select: {
            id: true,
            descripcion: true,
            categoriaId: true,
            categoria: { select: { nombre: true } },
          },
        },
        presupuestoRelacionado: {
          select: {
            id: true,
            descripcion: true,
            categoriaId: true,
            categoria: { select: { nombre: true } },
          },
        },
        quincena: {
          select: {
            id: true,
            codigo: true,
            fechaInicio: true,
            fechaFin: true,
          },
        },
      },
    })

    return NextResponse.json({
      cambios: cambios.map(c => ({
        id: c.id,
        quincenaId: c.quincenaId,
        tipo: c.tipo,
        montoAnterior: Number(c.montoAnterior),
        montoNuevo: Number(c.montoNuevo),
        delta: Number(c.delta),
        grupoCambioId: c.grupoCambioId,
        motivo: c.motivo,
        actor: c.actor,
        fechaCreacion: c.fechaCreacion,
        presupuesto: {
          id: c.presupuesto.id,
          descripcion: c.presupuesto.descripcion,
          categoriaId: c.presupuesto.categoriaId,
          categoria: c.presupuesto.categoria.nombre,
        },
        relacionado: c.presupuestoRelacionado
          ? {
              id: c.presupuestoRelacionado.id,
              descripcion: c.presupuestoRelacionado.descripcion,
              categoriaId: c.presupuestoRelacionado.categoriaId,
              categoria: c.presupuestoRelacionado.categoria.nombre,
            }
          : null,
        quincena: c.quincena,
      })),
    })
  } catch (error) {
    console.error('Error fetching presupuesto analysis history:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
