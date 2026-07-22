import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { computeQuincenasTarget } from '@/lib/recurrencia'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const presupuesto = await prisma.presupuesto.findUnique({
      where: { id },
      include: { categoria: true, quincena: true },
    })

    if (!presupuesto) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    return NextResponse.json(presupuesto)
  } catch (error) {
    console.error('Error fetching presupuesto:', error)
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
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const body = await request.json()
    const {
      quincenaId, descripcion, categoriaId, montoPresupuestado, clasificacion, tipo, notas,
      diaCobro, fechaVencimiento, recurrente, frecuencia, numOcurrencias, scope,
    } = body

    const current = await prisma.presupuesto.findUnique({ where: { id }, include: { quincena: true } })
    if (!current) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    const diaCobro_ = diaCobro !== undefined
      ? (diaCobro !== null && diaCobro !== '' ? parseInt(diaCobro) : null)
      : current.diaCobro

    // Fields for the row being edited itself.
    const ownData: any = {
      ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
      ...(descripcion && { descripcion }),
      ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
      ...(montoPresupuestado !== undefined && { montoPresupuestado: parseFloat(montoPresupuestado) }),
      ...(clasificacion !== undefined && { clasificacion }),
      ...(tipo && { tipo }),
      ...(notas !== undefined && { notas }),
      ...(diaCobro !== undefined && { diaCobro: diaCobro_ }),
      ...(fechaVencimiento !== undefined && { fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null }),
    }

    // Final values (body override, falling back to the current record) — used to
    // propagate shared fields to other rows in the series (future/past).
    const finalDescripcion = descripcion || current.descripcion
    const finalCategoriaId = categoriaId ? parseInt(categoriaId) : current.categoriaId
    const finalMonto = montoPresupuestado !== undefined ? parseFloat(montoPresupuestado) : current.montoPresupuestado
    const finalClasificacion = clasificacion !== undefined ? clasificacion : current.clasificacion
    const finalTipo = tipo || current.tipo
    const finalNotas = notas !== undefined ? notas : current.notas
    const finalFrecuencia = recurrente ? (frecuencia || current.frecuencia || 'CADA_QUINCENA') : null
    const finalNumOcurrencias = numOcurrencias !== undefined ? numOcurrencias : current.numOcurrencias

    if (!current.recurrenciaGrupoId) {
      // Standalone item (not part of any recurring series).
      if (!recurrente) {
        // Case A — plain single-row update, unchanged behavior.
        const presupuesto = await prisma.presupuesto.update({
          where: { id }, data: ownData, include: { categoria: true, quincena: true },
        })
        return NextResponse.json(presupuesto)
      }

      // Case B — activating recurrence on a previously standalone item: turn
      // it into the first row of a brand new series, generating the future
      // occurrences the same way the recurring POST does.
      const grupoId = randomUUID()
      const finalQuincenaId = quincenaId ? parseInt(quincenaId) : current.quincenaId

      const updated = await prisma.presupuesto.update({
        where: { id },
        data: { ...ownData, recurrente: true, frecuencia: finalFrecuencia, diaCobro: diaCobro_, recurrenciaGrupoId: grupoId, numOcurrencias: finalNumOcurrencias },
        include: { categoria: true, quincena: true },
      })

      const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
      const quincenaInicio = allQuincenas.find(q => q.id === finalQuincenaId) ?? updated.quincena
      const quincenesTarget = computeQuincenasTarget(allQuincenas, quincenaInicio, finalFrecuencia!, diaCobro_, finalNumOcurrencias)
        .filter(q => q.id !== finalQuincenaId)

      if (quincenesTarget.length > 0) {
        await prisma.presupuesto.createMany({
          data: quincenesTarget.map(q => ({
            descripcion: finalDescripcion,
            categoriaId: finalCategoriaId,
            montoPresupuestado: finalMonto,
            clasificacion: finalClasificacion,
            tipo: finalTipo,
            notas: finalNotas,
            recurrente: true,
            frecuencia: finalFrecuencia,
            diaCobro: diaCobro_,
            numOcurrencias: finalNumOcurrencias,
            recurrenciaGrupoId: grupoId,
            quincenaId: q.id,
          })),
          skipDuplicates: true,
        })
      }

      return NextResponse.json(updated)
    }

    // Already part of an existing recurring series.
    if (scope === 'single' || (scope !== 'future' && scope !== 'this_forward' && scope !== 'all')) {
      // "Solo esta quincena" (or no scope sent) — only this row, series untouched.
      const presupuesto = await prisma.presupuesto.update({
        where: { id }, data: ownData, include: { categoria: true, quincena: true },
      })
      return NextResponse.json(presupuesto)
    }

    const grupo = await prisma.presupuesto.findMany({
      where: { recurrenciaGrupoId: current.recurrenciaGrupoId },
      include: { quincena: true },
    })
    const currentFechaInicio = current.quincena.fechaInicio
    const futuras = grupo.filter(g => g.id !== id && g.quincena.fechaInicio > currentFechaInicio)
    const pasadas = grupo.filter(g => g.id !== id && g.quincena.fechaInicio < currentFechaInicio)

    if (scope === 'this_forward' || scope === 'all') {
      await prisma.presupuesto.update({
        where: { id },
        data: { ...ownData, recurrente: !!recurrente, frecuencia: finalFrecuencia, diaCobro: diaCobro_, numOcurrencias: finalNumOcurrencias },
      })
    }

    // Regenerate future occurrences (future/this_forward/all all touch the future).
    if (futuras.length > 0) {
      await prisma.presupuesto.deleteMany({ where: { id: { in: futuras.map(f => f.id) } } })
    }
    if (recurrente) {
      const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
      const quincenesTarget = computeQuincenasTarget(allQuincenas, current.quincena, finalFrecuencia!, diaCobro_, finalNumOcurrencias)
        .filter(q => q.fechaInicio > currentFechaInicio)

      if (quincenesTarget.length > 0) {
        await prisma.presupuesto.createMany({
          data: quincenesTarget.map(q => ({
            descripcion: finalDescripcion,
            categoriaId: finalCategoriaId,
            montoPresupuestado: finalMonto,
            clasificacion: finalClasificacion,
            tipo: finalTipo,
            notas: finalNotas,
            recurrente: true,
            frecuencia: finalFrecuencia,
            diaCobro: diaCobro_,
            numOcurrencias: finalNumOcurrencias,
            recurrenciaGrupoId: current.recurrenciaGrupoId,
            quincenaId: q.id,
          })),
          skipDuplicates: true,
        })
      }
    }

    if (scope === 'all' && pasadas.length > 0) {
      await prisma.presupuesto.updateMany({
        where: { id: { in: pasadas.map(p => p.id) } },
        data: {
          descripcion: finalDescripcion,
          categoriaId: finalCategoriaId,
          montoPresupuestado: finalMonto,
          clasificacion: finalClasificacion,
          tipo: finalTipo,
          notas: finalNotas,
          frecuencia: finalFrecuencia,
          diaCobro: diaCobro_,
          numOcurrencias: finalNumOcurrencias,
        },
      })
    }

    const presupuesto = await prisma.presupuesto.findUnique({
      where: { id }, include: { categoria: true, quincena: true },
    })
    return NextResponse.json(presupuesto)
  } catch (error) {
    console.error('Error updating presupuesto:', error)
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
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const grupoId = searchParams.get('grupoId')

    if (grupoId) {
      const { count } = await prisma.presupuesto.deleteMany({
        where: { recurrenciaGrupoId: grupoId },
      })
      return NextResponse.json({ message: 'Grupo eliminado', count })
    }

    await prisma.presupuesto.delete({ where: { id } })
    return NextResponse.json({ message: 'Presupuesto deleted' })
  } catch (error) {
    console.error('Error deleting presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
