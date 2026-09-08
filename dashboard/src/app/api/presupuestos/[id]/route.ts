import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
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
    const montoOriginalBody = montoPresupuestado !== undefined ? parseFloat(montoPresupuestado) : null

    // Compatibilidad temporal con el editor actual: al abrir una línea que ya
    // tiene montoRevisado, la UI todavía precarga montoPresupuestado (Original).
    // Si ese Original vuelve sin cambios y no viene montoRevisado explícito,
    // significa "el usuario editó otro campo", no "revierte el Vigente".
    const legacyOriginalSinCambio =
      montoRevisado === undefined &&
      montoPresupuestado !== undefined &&
      current.montoRevisado != null &&
      montoOriginalBody != null &&
      Number.isFinite(montoOriginalBody) &&
      Math.abs(montoOriginalBody - montoOriginal) < 0.005

    const montoEnBody =
      montoRevisado !== undefined ||
      (montoPresupuestado !== undefined && !legacyOriginalSinCambio)

    // En una fila existente, cualquier cambio de monto afecta el Vigente.
    // El Original queda inmutable después de la creación.
    let montoDeseado = montoActual
    if (montoRevisado !== undefined) {
      montoDeseado = montoRevisado === null || montoRevisado === ''
        ? montoOriginal
        : parseFloat(montoRevisado)
    } else if (montoEnBody && montoOriginalBody != null) {
      montoDeseado = montoOriginalBody
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

    const finalDescripcion = descripcion || current.descripcion
    const finalCategoriaId = categoriaId ? parseInt(categoriaId) : current.categoriaId
    const finalMonto = montoEnBody ? montoDeseado : montoActual
    const finalClasificacion = clasificacion !== undefined ? clasificacion : current.clasificacion
    const finalTipo = tipo || current.tipo
    const finalNotas = notas !== undefined ? notas : current.notas
    const finalFrecuencia = recurrente ? (frecuencia || current.frecuencia || 'CADA_QUINCENA') : null
    const finalNumOcurrencias = numOcurrencias !== undefined ? numOcurrencias : current.numOcurrencias

    if (!ownData.fechaVencimiento && finalFrecuencia === 'MENSUAL' && diaCobro_ != null) {
      const ownQuincenaId = quincenaId ? parseInt(quincenaId) : current.quincenaId
      const ownQuincena = ownQuincenaId === current.quincenaId
        ? current.quincena
        : await prisma.quincena.findUnique({ where: { id: ownQuincenaId } })
      if (ownQuincena) ownData.fechaVencimiento = new Date(fechaDiaCobroEnQuincena(ownQuincena, diaCobro_))
    }

    async function registrarAjusteActual(tx: Prisma.TransactionClient, quincenaFinalId: number) {
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

      // Future rows in a recurring series are regenerated as a new future
      // definition. Their new instances therefore receive their own CREACION.
      // The DB guard introduced in D1 prevents hard-delete once a period has
      // started or has real movements; this path only remains safe for future
      // placeholders that have not become historical evidence yet.
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

async function cancelarPresupuestos(
  ids: number[],
  actor: string | null,
  motivo: string,
  desvincularRecurrencia = false,
) {
  if (ids.length === 0) return 0

  return prisma.$transaction(async tx => {
    const filas = await tx.presupuesto.findMany({
      where: { id: { in: ids } },
    })
    let count = 0

    for (const fila of filas) {
      if (fila.estadoLinea === 'Cancelada') continue
      const montoActual = montoEfectivoPresupuesto(fila)
      await tx.presupuesto.update({
        where: { id: fila.id },
        data: {
          estadoLinea: 'Cancelada',
          notas: conNota(fila.notas, 'Retirada del presupuesto', motivo),
          ...(desvincularRecurrencia
            ? { recurrente: false, recurrenciaGrupoId: null, frecuencia: null, numOcurrencias: null }
            : {}),
        },
      })
      await registrarCambioPresupuesto(tx, {
        presupuestoId: fila.id,
        quincenaId: fila.quincenaId,
        tipo: 'AJUSTE_MANUAL',
        montoAnterior: montoActual,
        montoNuevo: 0,
        motivo,
        actor,
      })
      count += 1
    }

    return count
  })
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

    const session = await getSession()
    const actor = session?.username ?? null
    const { searchParams } = new URL(request.url)
    const grupoId = searchParams.get('grupoId')
    const scope = searchParams.get('scope')

    // Desde D1, "eliminar" desde la aplicación significa retirar del plan.
    // La fila se conserva como Cancelada para que Original e historial sigan
    // siendo auditables. Los DELETE físicos quedan reservados a plantillas
    // futuras internas y además están protegidos por trigger en PostgreSQL.
    if (grupoId && scope === 'future') {
      const current = await prisma.presupuesto.findUnique({ where: { id }, include: { quincena: true } })
      if (!current || !current.recurrenciaGrupoId) {
        return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
      }
      const futuras = await prisma.presupuesto.findMany({
        where: {
          recurrenciaGrupoId: current.recurrenciaGrupoId,
          quincena: { fechaInicio: { gt: current.quincena.fechaInicio } },
        },
        select: { id: true },
      })
      const count = await cancelarPresupuestos(
        futuras.map(f => f.id),
        actor,
        'Ocurrencia futura retirada de la serie',
        true,
      )
      return NextResponse.json({ message: 'Ocurrencias futuras retiradas', count })
    }

    if (grupoId) {
      const grupo = await prisma.presupuesto.findMany({
        where: { recurrenciaGrupoId: grupoId },
        select: { id: true },
      })
      const count = await cancelarPresupuestos(
        grupo.map(f => f.id),
        actor,
        'Serie recurrente retirada del presupuesto',
        true,
      )
      return NextResponse.json({ message: 'Grupo retirado', count })
    }

    const current = await prisma.presupuesto.findUnique({ where: { id } })
    if (!current) {
      return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })
    }
    const count = await cancelarPresupuestos([id], actor, 'Partida retirada del presupuesto')
    return NextResponse.json({ message: 'Presupuesto retirado', count })
  } catch (error) {
    console.error('Error deleting presupuesto:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
