import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { montoEfectivoPresupuesto, type TipoCambioPresupuesto } from '@/lib/presupuesto-cambios'

interface CambioRaw {
  id: number
  presupuesto_id: number
  quincena_id: number
  tipo: TipoCambioPresupuesto
  monto_anterior: unknown
  monto_nuevo: unknown
  delta: unknown
  grupo_cambio_id: string | null
  presupuesto_relacionado_id: number | null
  motivo: string | null
  actor: string | null
  fecha_creacion: Date
  relacionado_descripcion: string | null
  relacionado_categoria: string | null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const presupuesto = await prisma.presupuesto.findUnique({
      where: { id },
      select: {
        id: true,
        quincenaId: true,
        descripcion: true,
        montoPresupuestado: true,
        montoRevisado: true,
        estadoLinea: true,
        categoria: { select: { nombre: true } },
        quincena: { select: { codigo: true, fechaInicio: true, fechaFin: true } },
      },
    })
    if (!presupuesto) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    const cambios = await prisma.$queryRaw<CambioRaw[]>`
      SELECT
        pc."id",
        pc."presupuesto_id",
        pc."quincena_id",
        pc."tipo",
        pc."monto_anterior",
        pc."monto_nuevo",
        pc."delta",
        pc."grupo_cambio_id",
        pc."presupuesto_relacionado_id",
        pc."motivo",
        pc."actor",
        pc."fecha_creacion",
        relacionado."descripcion" AS "relacionado_descripcion",
        categoria_relacionada."nombre" AS "relacionado_categoria"
      FROM "presupuesto_cambios" pc
      LEFT JOIN "presupuesto" relacionado
        ON relacionado."id" = pc."presupuesto_relacionado_id"
      LEFT JOIN "categorias" categoria_relacionada
        ON categoria_relacionada."id" = relacionado."categoria_id"
      WHERE pc."presupuesto_id" = ${id}
      ORDER BY pc."fecha_creacion" ASC, pc."id" ASC
    `

    const original = Number(presupuesto.montoPresupuestado)
    // Una Cancelada sigue existiendo para preservar el Original, pero ya no
    // forma parte del plan actual: su Vigente es 0 para lectura histórica.
    const vigente = presupuesto.estadoLinea === 'Cancelada'
      ? 0
      : montoEfectivoPresupuesto(presupuesto)

    return NextResponse.json({
      presupuesto: {
        id: presupuesto.id,
        quincenaId: presupuesto.quincenaId,
        quincena: presupuesto.quincena,
        categoria: presupuesto.categoria.nombre,
        descripcion: presupuesto.descripcion,
        original,
        vigente,
        ajusteAcumulado: Number((vigente - original).toFixed(2)),
        estadoLinea: presupuesto.estadoLinea,
      },
      cambios: cambios.map(c => ({
        id: c.id,
        tipo: c.tipo,
        montoAnterior: Number(c.monto_anterior),
        montoNuevo: Number(c.monto_nuevo),
        delta: Number(c.delta),
        grupoCambioId: c.grupo_cambio_id,
        presupuestoRelacionadoId: c.presupuesto_relacionado_id,
        relacionado: c.relacionado_descripcion
          ? {
              descripcion: c.relacionado_descripcion,
              categoria: c.relacionado_categoria,
            }
          : null,
        motivo: c.motivo,
        actor: c.actor,
        fechaCreacion: c.fecha_creacion,
      })),
    })
  } catch (error) {
    console.error('Error fetching presupuesto historial:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
