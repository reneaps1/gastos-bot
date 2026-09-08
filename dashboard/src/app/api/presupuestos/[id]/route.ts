import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { computeQuincenasTarget, fechaDiaCobroEnQuincena } from '@/lib/recurrencia'
import { conNota } from '@/lib/cierre-quincena-server'
import { getSession } from '@/lib/auth'
import {
  montoEfectivoPresupuesto,
  registrarCambioPresupuesto,
  registrarCreacionPresupuesto,
} from '@/lib/presupuesto-cambios'

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

function revisadoParaOriginal(original: unknown, efectivo: number) {
  const originalNum = Number(original)
  return Math.abs(originalNum - efectivo) < 0.005 ? null : efectivo
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
      quincenaId, descripcion, categoriaId, montoPresupuestado, montoRevisado, clasificacion, tipo, notas,
      diaCobro, fechaVencimiento, recurrente, frecuencia, numOcurrencias, scope,
    } = body

    const current = await prisma.presupuesto.findUnique({ where: { id }, include: { quincena: true } })
    if (!current) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }

    const session = await getSession()
    const actor = session?.username ?? null
    const montoActual = montoEfectivoPresupuesto(current)
    const montoOriginal = Number(current.montoPresupuestado)
    const montoEnBody = montoRevisado !== undefined || montoPresupuestado !== undefined

    // Compatibilidad con la UI existente: el formulario históricamente manda
    // `montoPresupuestado` al editar. Desde ahora, en una fila YA existente,
    // ese valor significa "monto vigente deseado". El Original nunca se
    // sobreescribe; si difiere se guarda en montoRevisado.
    let montoDeseado = montoActual
    if (montoRevisado !== undefined) {
      montoDeseado = montoRevisado === null || montoRevisado === ''
        ? montoOriginal
        : parseFloat(montoRevisado)
    } else if (montoPresupuestado !== undefined) {
      montoDeseado = parseFloat(montoPresupuestado)
    }
    if (montoEnBody && (!Number.isFinite(montoDeseado) || montoDeseado <= 0)) {
      return NextResponse.json({ error: 'monto invalido' }, { status: 400 })
    }
    const hayCambioMonto = montoEnBody && Math.abs(montoDeseado - montoActual) >= 0.005
    const motivoCambio = typeof body.motivoCambio === 'string' && body.motivoCambio.trim()
      ? body.motivoCambio.trim()
      : 'Ajuste manual de presupuesto'

    const diaCobro_ = diaCobro !== undefined
      ? (diaCobro !== null && diaCobro !== '' ? parseInt(diaCobro) : null)
      : current.diaCobro

    // Fields for the row being edited itself. montoPresupuestado NO aparece:
    // es el Original y queda inmutable después de la creación.
    const ownData: any = {
      ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
      ...(descripcion && { descripcion }),
      ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
      ...(montoEnBody && { montoRevisado: revisadoParaOriginal(current.montoPresupuestado, montoDeseado) }),
      ...(clasificacion !== undefined && { clasificacion }),
      ...(tipo && { tipo }),
      ...(notas !== undefined && { notas }),
      ...(diaCobro !== undefined && { diaCobro: diaCobro_ }),
      ...(fechaVencimiento !== undefined && { fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null }),
    }

    if (hayCambioMonto) {
      ownData.notas = conNota(ownData.notas ?? current.notas, `Presupuesto vigente ajustado: $${montoActual.toFixed(2)} → $${montoDeseado.toFixed(2)}`)
    }

    // Final values (body override, falling back to current) — used to
    // propagate shared fields to future rows in a recurrence.
    const finalDescripcion = descripcion || current.descripcion
    const finalCategoriaId = categoriaId ? parseInt(categoriaId) : current.categoriaId
    const finalMonto = montoEnBody ? montoDeseado : montoActual
    const finalClasificacion = clasificacion !== undefined ? clasificacion : current.clasificacion
    const finalTipo = tipo || current.tipo
    const finalNotas = notas !== undefined ? notas : current.notas
    const finalFrecuencia = recurrente ? (frecuencia || current.frecuencia || 'CADA_QUINCENA') : null
    const finalNumOcurrencias = numOcurrencias !== undefined ? numOcurrencias : current.numOcurrencias

    // La propia fila que se esta editando tambien puede ser MENSUAL con
    // diaCobro. Una fecha explicita en el body siempre gana.
    if (!ownData.fechaVencimiento && finalFrecuencia === 'MENSUAL' && diaCobro_ != null) {
      const ownQuincenaId = quincenaId ? parseInt(quincenaId) : current.quincenaId
      const ownQuincena = ownQuincenaId === current.quincenaId
        ? current.quincena
        : await prisma.quincena.findUnique({ where: { id: ownQuincenaId } })
      if (ownQuincena) ownData.fechaVencimiento = new Date(fechaDiaCobroEnQuincena(ownQuincena, diaCobro_))
    }

    async function registrarAjusteActual(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], quincenaFinalId: number) {
      if (!hayCambioMonto) return
      await registrarCambioPresupuesto(tx, {
        presupuestoId: current.id,
        quincenaId: quincenaFinalId,
        tipo: 'AJUSTE_MANUAL',
        montoAnterior: montoActual,
        montoNuevo: montoDeseado,
        motivo: motivoCambio,
        actor,
      })
    }

    if (!current.recurrenciaGrupoId) {
      // Standalone item (not part of any recurring series).
      if (!recurrente) {
        const presupuesto = await prisma.$transaction(async tx => {
          const updated = await tx.presupuesto.update({
            where: { id }, data: ownData, include: { categoria: true, quincena: true },
          })
          await registrarAjusteActual(tx, updated.quincenaId)
          return updated
        })
        return NextResponse.json(presupuesto)
      }

      // Activar recurrencia sobre una fila existente: la fila actual conserva
      // su Original; las ocurrencias nuevas nacen con su propio Original.
      const grupoId = randomUUID()
      const finalQuincenaId = quincenaId ? parseInt(quincenaId) : current.quincenaId

      const updated = await prisma.$transaction(async tx => {
        const filaActual = await tx.presupuesto.update({
          where: { id },
          data: { ...ownData, recurrente: true, frecuencia: finalFrecuencia, diaCobro: diaCobro_, recurrenciaGrupoId: grupoId, numOcurrencias: finalNumOcurrencias },
          include: { categoria: true, quincena: true },
        })
        await registrarAjusteActual(tx, filaActual.quincenaId)

        const allQuincenas = await tx.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
        const quincenaInicio = allQuincenas.find(q => q.id === finalQuincenaId) ?? filaActual.quincena
        const quincenesTarget = computeQuincenasTarget(allQuincenas, quincenaInicio, finalFrecuencia!, diaCobro_, finalNumOcurrencias)
          .filter(q => q.id !== finalQuincenaId)

        if (quincenesTarget.length > 0) {
          await tx.presupuesto.createMany({
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
              fechaVencimiento: q.fechaVencimiento ? new Date(q.fechaVencimiento) : null,
              numOcurrencias: finalNumOcurrencias,
              recurrenciaGrupoId: grupoId,
              quincenaId: q.id,
            })),
            skipDuplicates: true,
          })
          const nuevas = await tx.presupuesto.findMany({
            where: { recurrenciaGrupoId: grupoId, id: { not: id } },
          })
          for (const fila of nuevas) {
            await registrarCreacionPresupuesto(tx, fila, actor, 'Ocurrencia recurrente creada')
          }
        }
        return filaActual
      })

      return NextResponse.json(updated)
    }

    // Already part of an existing recurring series.
    if (scope === 'single' || (scope !== 'future' && scope !== 'this_forward' && scope !== 'all')) {
      const presupuesto = await prisma.$transaction(async tx => {
        const updated = await tx.presupuesto.update({
          where: { id }, data: ownData, include: { categoria: true, quincena: true },
        })
        await registrarAjusteActual(tx, updated.quincenaId)
        return updated
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

    await prisma.$transaction(async tx => {
      if (scope === 'this_forward' || scope === 'all') {
        const filaActual = await tx.presupuesto.update({
          where: { id },
          data: { ...ownData, recurrente: !!recurrente, frecuencia: finalFrecuencia, diaCobro: diaCobro_, numOcurrencias: finalNumOcurrencias },
        })
        await registrarAjusteActual(tx, filaActual.quincenaId)
      }

      // Regenerate future occurrences. Al ser filas futuras reemplazadas por
      // una nueva definición de la serie, cada nueva fila obtiene su CREACION.
      if (futuras.length > 0) {
        await tx.presupuesto.deleteMany({ where: { id: { in: futuras.map(f => f.id) } } })
      }
      if (recurrente) {
        const allQuincenas = await tx.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
        const quincenesTarget = computeQuincenasTarget(allQuincenas, current.quincena, finalFrecuencia!, diaCobro_, finalNumOcurrencias)
          .filter(q => q.fechaInicio > currentFechaInicio)

        if (quincenesTarget.length > 0) {
          await tx.presupuesto.createMany({
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
              fechaVencimiento: q.fechaVencimiento ? new Date(q.fechaVencimiento) : null,
              numOcurrencias: finalNumOcurrencias,
              recurrenciaGrupoId: current.recurrenciaGrupoId,
              quincenaId: q.id,
            })),
            skipDuplicates: true,
          })
          const targetIds = quincenesTarget.map(q => q.id)
          const nuevas = await tx.presupuesto.findMany({
            where: { recurrenciaGrupoId: current.recurrenciaGrupoId, quincenaId: { in: targetIds } },
          })
          for (const fila of nuevas) {
            await registrarCreacionPresupuesto(tx, fila, actor, 'Ocurrencia recurrente regenerada')
          }
        }
      }

      // Una fila pasada ya resuelta no se toca. Para filas pasadas todavía
      // Abiertas, "all" puede actualizar el Vigente, pero jamás el Original.
      const pasadasEditables = pasadas.filter(p => p.estadoLinea === 'Abierta')
      if (scope === 'all' && pasadasEditables.length > 0) {
        for (const pasada of pasadasEditables) {
          const dataPasada: any = {
            descripcion: finalDescripcion,
            categoriaId: finalCategoriaId,
            clasificacion: finalClasificacion,
            tipo: finalTipo,
            notas: finalNotas,
            frecuencia: finalFrecuencia,
            diaCobro: diaCobro_,
            numOcurrencias: finalNumOcurrencias,
          }
          if (montoEnBody) {
            dataPasada.montoRevisado = revisadoParaOriginal(pasada.montoPresupuestado, finalMonto)
          }
          await tx.presupuesto.update({ where: { id: pasada.id }, data: dataPasada })
          if (montoEnBody) {
            await registrarCambioPresupuesto(tx, {
              presupuestoId: pasada.id,
              quincenaId: pasada.quincenaId,
              tipo: 'AJUSTE_MANUAL',
              montoAnterior: montoEfectivoPresupuesto(pasada),
              montoNuevo: finalMonto,
              motivo: `${motivoCambio} · aplicado a toda la serie`,
              actor,
            })
          }
        }
      }
    })

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
    const scope = searchParams.get('scope')

    if (grupoId && scope === 'future') {
      const current = await prisma.presupuesto.findUnique({ where: { id }, include: { quincena: true } })
      if (!current || !current.recurrenciaGrupoId) {
        return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
      }
      const { count } = await prisma.presupuesto.deleteMany({
        where: {
          recurrenciaGrupoId: current.recurrenciaGrupoId,
          quincena: { fechaInicio: { gt: current.quincena.fechaInicio } },
        },
      })
      return NextResponse.json({ message: 'Ocurrencias futuras eliminadas', count })
    }

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
