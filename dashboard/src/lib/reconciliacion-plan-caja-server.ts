import { prisma } from '@/lib/prisma'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'
import { montoEfectivoDePrisma } from '@/lib/cierre-quincena-server'
import { calcularPagosQuincena } from '@/lib/pagos-quincena'
import { calcularLibreSinAsignar } from '@/lib/presupuesto-totales'
import { getMexicoDateString } from '@/lib/quincena-selection'

function totalSnapshot(snapshot: { montos: { monto: unknown }[] }) {
  return snapshot.montos.reduce<number>((total, m) => total + Number(m.monto), 0)
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b
}

function dayBefore(date: Date) {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() - 1)
  return copy
}

export interface MovimientoCajaResumen {
  ingresos: number
  gastos: number
  ahorroAportes: number
  ahorroRetiros: number
  pagosCredito: number
  neto: number
}

async function movimientosCajaEntre(desdeExclusivo: Date, hastaInclusivo: Date): Promise<MovimientoCajaResumen> {
  if (hastaInclusivo.getTime() <= desdeExclusivo.getTime()) {
    return { ingresos: 0, gastos: 0, ahorroAportes: 0, ahorroRetiros: 0, pagosCredito: 0, neto: 0 }
  }

  const [movimientos, pagosCreditoAgg] = await Promise.all([
    prisma.transaccion.groupBy({
      by: ['tipo', 'direccion'],
      where: {
        fecha: { gt: desdeExclusivo, lte: hastaInclusivo },
        estatus: 'Pagado',
        tipo: { in: ['Ingreso', 'Gasto', 'Ahorro'] },
      },
      _sum: { monto: true },
    }),
    prisma.creditoPago.aggregate({
      where: {
        estatus: 'Pagado',
        fechaPagoReal: { gt: desdeExclusivo, lte: hastaInclusivo },
      },
      _sum: { montoTotal: true },
    }),
  ])

  let ingresos = 0
  let gastos = 0
  let ahorroAportes = 0
  let ahorroRetiros = 0

  for (const row of movimientos) {
    const monto = Number(row._sum.monto ?? 0)
    if (row.tipo === 'Ingreso') ingresos += monto
    else if (row.tipo === 'Gasto') gastos += monto
    else if (row.tipo === 'Ahorro' && row.direccion === 'Retiro') ahorroRetiros += monto
    else if (row.tipo === 'Ahorro') ahorroAportes += monto
  }

  const pagosCredito = Number(pagosCreditoAgg._sum.montoTotal ?? 0)
  const neto = ingresos + ahorroRetiros - gastos - ahorroAportes - pagosCredito

  return { ingresos, gastos, ahorroAportes, ahorroRetiros, pagosCredito, neto }
}

async function descuadreEntreSnapshots(actual: {
  id: number
  fechaCorte: Date
  montos: { monto: unknown }[]
}) {
  const inicioDia = new Date(Date.UTC(
    actual.fechaCorte.getUTCFullYear(),
    actual.fechaCorte.getUTCMonth(),
    actual.fechaCorte.getUTCDate(),
  ))

  const anterior = await prisma.liquidezSnapshot.findFirst({
    where: { fechaCorte: { lt: inicioDia } },
    include: { montos: true, quincena: true },
    orderBy: [
      { fechaCorte: 'desc' },
      { fechaRegistro: 'desc' },
      { id: 'desc' },
    ],
  })

  if (!anterior) return null

  const movimientos = await movimientosCajaEntre(anterior.fechaCorte, actual.fechaCorte)
  const saldoAnterior = totalSnapshot(anterior)
  const saldoEsperado = saldoAnterior + movimientos.neto
  const saldoActual = totalSnapshot(actual)

  return {
    snapshotAnteriorId: anterior.id,
    fechaCorteAnterior: anterior.fechaCorte,
    saldoAnterior,
    saldoEsperado,
    saldoActual,
    diferencia: saldoActual - saldoEsperado,
    movimientos,
  }
}

export async function calcularReconciliacionPlanCaja(quincenaId: number) {
  const quincena = await prisma.quincena.findUnique({ where: { id: quincenaId } })
  if (!quincena) return null

  const hoy = dateOnly(getMexicoDateString())
  const hastaHoy = minDate(hoy, quincena.fechaFin)

  const [snapshot, snapshotApertura, presupuestos, ingresosRows, gastosNoCubiertosAgg, pagosQuincena] = await Promise.all([
    prisma.liquidezSnapshot.findFirst({
      where: { quincenaId },
      include: { montos: true, quincena: true },
      orderBy: [
        { fechaCorte: 'desc' },
        { fechaRegistro: 'desc' },
        { id: 'desc' },
      ],
    }),
    prisma.liquidezSnapshot.findFirst({
      where: { fechaCorte: { lt: quincena.fechaInicio } },
      include: { montos: true, quincena: true },
      orderBy: [
        { fechaCorte: 'desc' },
        { fechaRegistro: 'desc' },
        { id: 'desc' },
      ],
    }),
    prisma.presupuesto.findMany({
      where: { quincenaId },
      include: { categoria: true },
    }),
    prisma.transaccion.groupBy({
      by: ['estatus'],
      where: { quincenaId, tipo: 'Ingreso' },
      _sum: { monto: true },
    }),
    prisma.transaccion.aggregate({
      where: { quincenaId, tipo: 'Gasto', presupuestoId: null },
      _sum: { monto: true },
    }),
    calcularPagosQuincena(quincenaId),
  ])

  const presupuestoIds = presupuestos.map(p => p.id)
  const rowsPresupuesto = presupuestoIds.length > 0
    ? await prisma.transaccion.groupBy({
        by: ['presupuestoId'],
        where: { presupuestoId: { in: presupuestoIds } },
        _sum: { monto: true },
      })
    : []

  const realMap = new Map<number, number>()
  for (const row of rowsPresupuesto) {
    if (row.presupuestoId == null) continue
    realMap.set(row.presupuestoId, Number(row._sum.monto ?? 0))
  }

  const presupuestosParaLibre = presupuestos.map(p => {
    const montoEfectivo = montoEfectivoDePrisma(p)
    const real = realMap.get(p.id) ?? 0
    return {
      montoEfectivo,
      excedido: Math.max(real - montoEfectivo, 0),
      categoria: { tipo: p.categoria.tipo },
      estadoLinea: p.estadoLinea,
    }
  })

  const ingresosRegistrados = ingresosRows.reduce((s, r) => s + Number(r._sum.monto ?? 0), 0)
  const ingresosPagados = Number(ingresosRows.find(r => r.estatus === 'Pagado')?._sum.monto ?? 0)
  const ingresosPorCobrar = Number(ingresosRows.find(r => r.estatus === 'Pendiente')?._sum.monto ?? 0)
  const gastosNoCubiertos = Number(gastosNoCubiertosAgg._sum.monto ?? 0)
  const margenPlan = calcularLibreSinAsignar(ingresosRegistrados, presupuestosParaLibre, gastosNoCubiertos)
  const totalComprometido = ingresosRegistrados - margenPlan

  const ahorroPendiente = presupuestos
    .filter(p => p.categoria.tipo === 'Ahorro' && cuentaParaAgregados(p))
    .reduce((s, p) => {
      const real = realMap.get(p.id) ?? 0
      return s + Math.max(montoEfectivoDePrisma(p) - real, 0)
    }, 0)

  const ingresosPendientes = await prisma.transaccion.findMany({
    where: { quincenaId, tipo: 'Ingreso', estatus: 'Pendiente' },
    select: {
      id: true,
      fecha: true,
      descripcion: true,
      monto: true,
      categoria: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  })

  if (!snapshot) {
    return {
      quincena: { id: quincena.id, codigo: quincena.codigo, fechaInicio: quincena.fechaInicio, fechaFin: quincena.fechaFin },
      snapshot: null,
      plan: { ingresosRegistrados, ingresosPagados, ingresosPorCobrar, totalComprometido, margenPlan },
      pagos: { ...pagosQuincena, ahorroPendiente },
      ingresosPendientes: ingresosPendientes.map(i => ({ ...i, monto: Number(i.monto) })),
      caja: null,
      diagnostico: null,
    }
  }

  const saldoCorte = totalSnapshot(snapshot)
  const movimientosDesdeCorte = await movimientosCajaEntre(snapshot.fechaCorte, hastaHoy)
  const saldoEstimadoHoy = saldoCorte + movimientosDesdeCorte.neto
  const pagosPorSalir = pagosQuincena.pagosQuincena + ahorroPendiente
  const saldoProyectadoCierre = saldoEstimadoHoy + ingresosPorCobrar - pagosPorSalir

  let saldoAperturaEstimado: number | null = null
  let movimientoHastaApertura: MovimientoCajaResumen | null = null
  if (snapshotApertura) {
    const limiteApertura = dayBefore(quincena.fechaInicio)
    movimientoHastaApertura = await movimientosCajaEntre(snapshotApertura.fechaCorte, limiteApertura)
    saldoAperturaEstimado = totalSnapshot(snapshotApertura) + movimientoHastaApertura.neto
  }

  const resultadoCajaQuincena = saldoAperturaEstimado == null
    ? null
    : saldoProyectadoCierre - saldoAperturaEstimado
  const diferenciaVsPlan = resultadoCajaQuincena == null
    ? null
    : resultadoCajaQuincena - margenPlan

  const [movimientosOtraQuincenaRows, pagosCreditoQ, comprasCreditoQ, descuadreCorte] = await Promise.all([
    prisma.transaccion.findMany({
      where: {
        fecha: { gte: quincena.fechaInicio, lte: hastaHoy },
        estatus: 'Pagado',
        quincenaId: { not: quincenaId },
        tipo: { in: ['Ingreso', 'Gasto', 'Ahorro'] },
      },
      select: {
        id: true,
        fecha: true,
        quincenaId: true,
        descripcion: true,
        tipo: true,
        direccion: true,
        monto: true,
        categoria: { select: { nombre: true } },
        quincena: { select: { codigo: true } },
      },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    }),
    prisma.creditoPago.findMany({
      where: { quincenaId, estatus: { not: 'Cancelado' } },
      select: {
        id: true,
        transaccionId: true,
        montoTotal: true,
        estatus: true,
        fechaPagoProgramada: true,
        credito: { select: { nombre: true } },
      },
    }),
    prisma.transaccion.findMany({
      where: { quincenaId, tipo: 'Gasto', creditoId: { not: null } },
      select: { id: true, monto: true, presupuestoId: true, descripcion: true },
    }),
    descuadreEntreSnapshots(snapshot),
  ])

  const parentIds = Array.from(new Set(pagosCreditoQ.map(p => p.transaccionId).filter((id): id is number => id != null)))
  const parents = parentIds.length > 0
    ? await prisma.transaccion.findMany({ where: { id: { in: parentIds } }, select: { id: true, quincenaId: true } })
    : []
  const parentQMap = new Map(parents.map(p => [p.id, p.quincenaId]))

  const creditoArrastrado = pagosCreditoQ.reduce((s, p) => {
    const parentQ = p.transaccionId == null ? null : parentQMap.get(p.transaccionId)
    return parentQ !== quincenaId ? s + Number(p.montoTotal) : s
  }, 0)

  const pagosPorTransaccion = new Map<number, number>()
  for (const p of pagosCreditoQ) {
    if (p.transaccionId == null) continue
    pagosPorTransaccion.set(p.transaccionId, (pagosPorTransaccion.get(p.transaccionId) ?? 0) + Number(p.montoTotal))
  }
  const idsPresupuestoQ = new Set(presupuestoIds)
  const creditoDiferidoActual = comprasCreditoQ.reduce((s, tx) => {
    if (tx.presupuestoId == null || !idsPresupuestoQ.has(tx.presupuestoId)) return s
    const pagosEnQ = pagosPorTransaccion.get(tx.id) ?? 0
    return s + Math.max(Number(tx.monto) - pagosEnQ, 0)
  }, 0)

  let movimientosOtraQuincenaNeto = 0
  for (const tx of movimientosOtraQuincenaRows) {
    const monto = Number(tx.monto)
    if (tx.tipo === 'Ingreso') movimientosOtraQuincenaNeto += monto
    else if (tx.tipo === 'Gasto') movimientosOtraQuincenaNeto -= monto
    else if (tx.tipo === 'Ahorro' && tx.direccion === 'Retiro') movimientosOtraQuincenaNeto += monto
    else movimientosOtraQuincenaNeto -= monto
  }

  const ajustesTiming = movimientosOtraQuincenaNeto - creditoArrastrado + creditoDiferidoActual
  const residual = diferenciaVsPlan == null ? null : diferenciaVsPlan - ajustesTiming
  const tolerancia = 1

  return {
    quincena: { id: quincena.id, codigo: quincena.codigo, fechaInicio: quincena.fechaInicio, fechaFin: quincena.fechaFin },
    snapshot: {
      id: snapshot.id,
      fechaCorte: snapshot.fechaCorte,
      saldoCorte,
      saldoEstimadoHoy,
      movimientosDesdeCorte,
    },
    snapshotApertura: snapshotApertura ? {
      id: snapshotApertura.id,
      fechaCorte: snapshotApertura.fechaCorte,
      saldoCapturado: totalSnapshot(snapshotApertura),
      movimientosHastaApertura: movimientoHastaApertura,
      saldoAperturaEstimado,
    } : null,
    plan: { ingresosRegistrados, ingresosPagados, ingresosPorCobrar, totalComprometido, margenPlan },
    pagos: { ...pagosQuincena, ahorroPendiente, pagosPorSalir },
    ingresosPendientes: ingresosPendientes.map(i => ({ ...i, monto: Number(i.monto) })),
    caja: {
      saldoProyectadoCierre,
      resultadoCajaQuincena,
      diferenciaVsPlan,
      cuadraConPlan: diferenciaVsPlan == null ? null : Math.abs(diferenciaVsPlan) < tolerancia,
    },
    diagnostico: {
      movimientosOtraQuincenaNeto,
      movimientosOtraQuincena: movimientosOtraQuincenaRows.map(tx => ({ ...tx, monto: Number(tx.monto) })),
      creditoArrastrado,
      creditoDiferidoActual,
      ajustesTiming,
      residual,
      descuadreCorte,
      requiereAccion: residual == null ? false : Math.abs(residual) >= tolerancia,
    },
  }
}
