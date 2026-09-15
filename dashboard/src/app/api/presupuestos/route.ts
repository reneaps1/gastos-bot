import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { computeQuincenasTarget } from '@/lib/recurrencia'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'
import { getSession } from '@/lib/auth'
import { registrarCreacionPresupuesto } from '@/lib/presupuesto-cambios'
import { calcularRealPorLinea, realDeLinea } from '@/lib/real-transacciones'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')
    const categoriaId = searchParams.get('categoriaId')
    const recurrenciaGrupoId = searchParams.get('recurrenciaGrupoId')

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (categoriaId) where.categoriaId = parseInt(categoriaId)
    if (recurrenciaGrupoId) where.recurrenciaGrupoId = recurrenciaGrupoId

    const presupuestos = await prisma.presupuesto.findMany({
      where,
      include: { categoria: true, quincena: true },
      orderBy: [{ quincena: { fechaInicio: 'desc' } }, { categoria: { nombre: 'asc' } }],
    })

    // Presupuesto Modificado si existe, si no el Original -- lo comprometido
    // *hoy* contra lo que se compara pct/excedido. montoPresupuestado (el
    // original crudo) sigue viajando sin tocar via el spread de abajo.
    const montoEfectivo = (p: { montoPresupuestado: unknown; montoRevisado: unknown }) =>
      p.montoRevisado != null ? Number(p.montoRevisado) : Number(p.montoPresupuestado)

    // Total efectivo por grupo (quincenaId, categoriaId), para el rollup de categoría en la UI.
    // Cancelada nunca cuenta -- una linea que "nunca paso" no debe inflar el
    // total de su categoria para siempre.
    const groupTotals = new Map<string, number>()
    for (const p of presupuestos) {
      if (!cuentaParaAgregados(p)) continue
      const key = `${p.quincenaId}-${p.categoriaId}`
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + montoEfectivo(p))
    }

    // Monto real por línea específica (presupuestoId) — una sola query agrupada en vez de N aggregates.
    // Sin filtro de tipo: una línea de Ingreso/Ahorro tiene sus propias transacciones
    // (tipo Ingreso/Ahorro) asignadas por presupuestoId, igual que una de Gasto. Por eso
    // el neteo de Retiro que hace calcularRealPorLinea es imprescindible aquí.
    const presupuestoIds = presupuestos.map(p => p.id)
    const realMap = await calcularRealPorLinea(presupuestoIds)

    const presupuestosConGasto = presupuestos.map(p => {
      const { real, pendiente } = realDeLinea(realMap, p.id)
      const efectivo = montoEfectivo(p)
      const pct = efectivo > 0 ? (real / efectivo) * 100 : 0
      const key = `${p.quincenaId}-${p.categoriaId}`
      const categoriaTotal = groupTotals.get(key) ?? efectivo
      const excedido = real > efectivo ? Number((real - efectivo).toFixed(2)) : 0
      return { ...p, real, pendiente, pct, categoriaTotal, excedido, montoEfectivo: efectivo }
    })

    return NextResponse.json(presupuestosConGasto)
  } catch (error) {
    console.error('Error fetching presupuestos:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      quincenaId, descripcion, categoriaId, montoPresupuestado,
      clasificacion, notas, fechaVencimiento,
      recurrente, frecuencia, numOcurrencias, diaCobro,
    } = body

    if (!quincenaId || !descripcion || !categoriaId || !montoPresupuestado) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const session = await getSession()
    const actor = session?.username ?? null
    const diaCobro_ = diaCobro ? parseInt(diaCobro) : null

    // `tipo` es una copia del tipo de la categoria. Dejar que se guarde otro
    // valor es lo que producia lineas que una pantalla contaba como Ingreso y
    // otra como Gasto (ver tipoDeLinea en @/lib/presupuesto-totales): se
    // resuelve contra la categoria en vez de creerle al cliente.
    const categoriaDeLinea = await prisma.categoria.findUnique({
      where: { id: parseInt(categoriaId) },
      select: { tipo: true },
    })
    if (!categoriaDeLinea) {
      return NextResponse.json({ error: 'Categoria not found' }, { status: 400 })
    }

    const baseData = {
      descripcion,
      categoriaId: parseInt(categoriaId),
      montoPresupuestado: parseFloat(montoPresupuestado),
      clasificacion: clasificacion ?? null,
      tipo: categoriaDeLinea.tipo,
      notas: notas ?? null,
      recurrente: recurrente ?? false,
      frecuencia: recurrente ? (frecuencia ?? 'CADA_QUINCENA') : null,
      diaCobro: diaCobro_ ?? null,
    }

    if (!recurrente) {
      const presupuesto = await prisma.$transaction(async tx => {
        const created = await tx.presupuesto.create({
          data: { ...baseData, quincenaId: parseInt(quincenaId), fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null },
          include: { categoria: true, quincena: true },
        })
        await registrarCreacionPresupuesto(tx, created, actor)
        return created
      })
      return NextResponse.json(presupuesto, { status: 201 })
    }

    // Recurring: find all future quincenas from the selected one
    const quincenaInicio = await prisma.quincena.findUnique({
      where: { id: parseInt(quincenaId) },
    })
    if (!quincenaInicio) {
      return NextResponse.json({ error: 'Quincena not found' }, { status: 404 })
    }

    const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })

    const quincenesTarget = computeQuincenasTarget(allQuincenas, quincenaInicio, frecuencia, diaCobro_, numOcurrencias)

    if (quincenesTarget.length === 0) {
      return NextResponse.json({ error: 'No matching quincenas found' }, { status: 400 })
    }

    const grupoId = randomUUID()

    const created = await prisma.$transaction(async tx => {
      await tx.presupuesto.createMany({
        data: quincenesTarget.map(q => ({
          ...baseData,
          quincenaId: q.id,
          fechaVencimiento: q.fechaVencimiento ? new Date(q.fechaVencimiento) : null,
          recurrenciaGrupoId: grupoId,
          numOcurrencias: numOcurrencias ?? null,
        })),
        skipDuplicates: true,
      })

      const filas = await tx.presupuesto.findMany({
        where: { recurrenciaGrupoId: grupoId },
        orderBy: { quincenaId: 'asc' },
      })
      for (const fila of filas) {
        await registrarCreacionPresupuesto(tx, fila, actor, 'Presupuesto recurrente creado')
      }
      return filas.length
    })

    return NextResponse.json({ created, grupoId }, { status: 201 })
  } catch (error) {
    console.error('Error creating presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
