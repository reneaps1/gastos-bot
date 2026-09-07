import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

function efectivo(p: { montoPresupuestado: unknown; montoRevisado: unknown }) {
  return Number(p.montoRevisado ?? p.montoPresupuestado ?? 0)
}

function stats(valores: number[]) {
  if (valores.length === 0) return { promedio: 0, desviacion: 0, n: 0 }
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length
  const varianza = valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length
  return { promedio, desviacion: Math.sqrt(varianza), n: valores.length }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const hoyParam = searchParams.get('hoy')
    const horizonteParam = Number(searchParams.get('horizonte') ?? 3)
    const horizonte = Number.isInteger(horizonteParam) ? Math.min(Math.max(horizonteParam, 1), 6) : 3
    const hoy = /^\d{4}-\d{2}-\d{2}$/.test(hoyParam ?? '')
      ? hoyParam!
      : new Date().toISOString().slice(0, 10)

    const [quincenas, config] = await Promise.all([
      prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } }),
      prisma.configuracion.findFirst(),
    ])

    // Forecast = siguientes periodos completos. La Q en curso no entra porque
    // mezclar gasto ya ejercido con gasto futuro requiere otra logica de remanente.
    const futuras = quincenas
      .filter(q => dateKey(q.fechaInicio) > hoy)
      .slice(0, horizonte)

    if (futuras.length === 0) {
      return NextResponse.json({
        hoy,
        historicoVariable: {},
        quincenas: [],
        deudasSinCalendario: { totalMensual: 0, conteo: 0, items: [] },
      })
    }

    const futurasIds = futuras.map(q => q.id)

    // Historial variable separado por tipo de periodo para no mezclar una Q
    // quincenal con una semanal/mensual si la configuracion cambia.
    const tiposFuturos = new Set(futuras.map(q => q.tipo))
    const cerradasPorTipo = new Map<string, typeof quincenas>()
    for (const tipo of tiposFuturos) {
      cerradasPorTipo.set(
        tipo,
        quincenas
          .filter(q => q.tipo === tipo && dateKey(q.fechaFin) < hoy)
          .slice(-6),
      )
    }
    const historicas = [...cerradasPorTipo.values()].flat()
    const historicasIds = historicas.map(q => q.id)

    const [presupuestosFuturos, pagosCredito, transaccionesHistoricas, deudas] = await Promise.all([
      prisma.presupuesto.findMany({
        where: { quincenaId: { in: futurasIds } },
        include: { categoria: true },
      }),
      prisma.creditoPago.findMany({
        where: {
          quincenaId: { in: futurasIds },
          estatus: { in: ['Pendiente', 'Vencido'] },
          presupuestoId: null,
        },
        include: { credito: { select: { nombre: true } } },
      }),
      historicasIds.length > 0
        ? prisma.transaccion.findMany({
            where: { quincenaId: { in: historicasIds }, tipo: 'Gasto' },
            include: {
              categoria: { select: { clasificacion: true } },
              presupuesto: { select: { clasificacion: true } },
            },
          })
        : Promise.resolve([]),
      prisma.deuda.findMany({
        where: { activo: true },
        select: { acreedor: true, abonoMensual: true },
      }),
    ])

    const variablePorQ = new Map<number, number>()
    for (const q of historicas) variablePorQ.set(q.id, 0)
    for (const tx of transaccionesHistoricas) {
      const clasificacion = tx.clasificacion ?? tx.presupuesto?.clasificacion ?? tx.categoria.clasificacion
      if (clasificacion === 'Fijo') continue
      variablePorQ.set(tx.quincenaId, (variablePorQ.get(tx.quincenaId) ?? 0) + Number(tx.monto))
    }

    const historicoVariable: Record<string, { promedio: number; desviacion: number; n: number }> = {}
    for (const [tipo, qs] of cerradasPorTipo) {
      historicoVariable[tipo] = stats(qs.map(q => variablePorQ.get(q.id) ?? 0))
    }

    const pagosPorQ = new Map<number, { total: number; items: { nombre: string; monto: number }[] }>()
    for (const pago of pagosCredito) {
      const acc = pagosPorQ.get(pago.quincenaId) ?? { total: 0, items: [] }
      const monto = Number(pago.montoTotal)
      acc.total += monto
      acc.items.push({ nombre: pago.credito.nombre, monto })
      pagosPorQ.set(pago.quincenaId, acc)
    }

    const filasPorQ = new Map<number, typeof presupuestosFuturos>()
    for (const p of presupuestosFuturos) {
      if (!cuentaParaAgregados(p)) continue
      const arr = filasPorQ.get(p.quincenaId) ?? []
      arr.push(p)
      filasPorQ.set(p.quincenaId, arr)
    }

    const resultado = futuras.map(q => {
      const filas = filasPorQ.get(q.id) ?? []
      let ingresoPlaneado = 0
      let gastoFijo = 0
      let gastoVariablePlan = 0
      let ahorroPlaneado = 0

      for (const p of filas) {
        const monto = efectivo(p)
        if (p.tipo === 'Ingreso' || p.categoria.tipo === 'Ingreso') {
          ingresoPlaneado += monto
          continue
        }
        if (p.tipo === 'Ahorro' || p.categoria.tipo === 'Ahorro') {
          ahorroPlaneado += monto
          continue
        }
        if (p.tipo !== 'Gasto' && p.categoria.tipo !== 'Gasto') continue

        const clasificacion = p.clasificacion ?? p.categoria.clasificacion
        if (clasificacion === 'Fijo') gastoFijo += monto
        else gastoVariablePlan += monto
      }

      const hist = historicoVariable[q.tipo] ?? { promedio: 0, desviacion: 0, n: 0 }
      const variableEstimado = hist.n > 0 ? hist.promedio : gastoVariablePlan
      const creditoExtra = pagosPorQ.get(q.id) ?? { total: 0, items: [] }
      const gastoPlan = gastoFijo + gastoVariablePlan + creditoExtra.total
      const gastoEstimado = gastoFijo + variableEstimado + creditoExtra.total
      const necesidadPlan = gastoPlan + ahorroPlaneado
      const necesidadEstimada = gastoEstimado + ahorroPlaneado

      const referenciaIngreso = q.ingresoReferencia != null
        ? Number(q.ingresoReferencia)
        : config?.ingresoReferencia != null
          ? Number(config.ingresoReferencia)
          : null
      const ingresoEsperado = ingresoPlaneado > 0 ? ingresoPlaneado : referenciaIngreso
      const fuenteIngreso = ingresoPlaneado > 0 ? 'presupuesto' : referenciaIngreso != null ? 'referencia' : 'sin_dato'

      return {
        quincenaId: q.id,
        codigo: q.codigo,
        fechaInicio: dateKey(q.fechaInicio),
        fechaFin: dateKey(q.fechaFin),
        tipo: q.tipo,
        ingresoEsperado,
        fuenteIngreso,
        gastoFijo,
        gastoVariablePlan,
        gastoVariableEstimado: variableEstimado,
        variableHistoricoN: hist.n,
        variableHistoricoDesviacion: hist.desviacion,
        creditosProgramadosExtra: creditoExtra.total,
        creditosDetalle: creditoExtra.items,
        ahorroPlaneado,
        gastoPlan,
        gastoEstimado,
        necesidadPlan,
        necesidadEstimada,
        margenPlan: ingresoEsperado == null ? null : ingresoEsperado - necesidadPlan,
        margenEstimado: ingresoEsperado == null ? null : ingresoEsperado - necesidadEstimada,
        cubreEstimado: ingresoEsperado == null ? null : ingresoEsperado >= necesidadEstimada,
        diferenciaEstimadoVsPlan: necesidadEstimada - necesidadPlan,
      }
    })

    // Deuda manual solo tiene abono mensual, no una Q/fecha programada. Se
    // expone como advertencia, pero NO se reparte artificialmente entre Q para
    // evitar doble conteo contra lineas de presupuesto ya creadas.
    const deudaItems = deudas
      .filter(d => Number(d.abonoMensual ?? 0) > 0)
      .map(d => ({ acreedor: d.acreedor, abonoMensual: Number(d.abonoMensual) }))
    const totalMensual = deudaItems.reduce((s, d) => s + d.abonoMensual, 0)

    return NextResponse.json({
      hoy,
      historicoVariable,
      quincenas: resultado,
      deudasSinCalendario: {
        totalMensual,
        conteo: deudaItems.length,
        items: deudaItems,
      },
    })
  } catch (error) {
    console.error('Error building presupuesto forecast:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
