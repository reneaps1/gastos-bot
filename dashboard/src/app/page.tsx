'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Droplets,
  Gauge,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { QuincenaChips } from '@/components/ui/QuincenaChips'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { KpiCard } from '@/components/ui/KpiCard'
import { cuentaParaAgregados, quincenasPendientesDeCierre, type GrupoCierre } from '@/lib/cierre-quincena'
import { calcularPosicionFinanciera } from '@/lib/financial-position'
import { normalizeMontos, sumLiquidez, type LiquidezMontos } from '@/lib/liquidez'
import { getInitialQuincenaId, getMexicoDateString, persistQuincenaId } from '@/lib/quincena-selection'
import { formatDate, formatDateStr, formatMXN } from '@/lib/utils'

interface Categoria {
  id: number
  nombre: string
  tipo: string
}

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

interface PresupuestoConQuincena {
  id: number
  descripcion: string
  montoEfectivo: number
  real: number
  pendiente: number
  estadoLinea: string
  categoria: { tipo: string; nombre: string }
  quincena: { id: number; codigo: string; fechaFin: string; fechaCierre: string | null }
}

interface Presupuesto {
  id: number
  descripcion: string
  montoEfectivo: number
  real: number
  pendiente: number
  excedido?: number
  pct: number
  estadoLinea: string
  fechaVencimiento?: string | null
  categoria: Categoria
}

interface Transaccion {
  id: number
  fecha: string
  descripcion: string
  tipo: string
  monto: number
  presupuestoId: number | null
  categoria: Categoria
}

interface Snapshot extends LiquidezMontos {
  id: number
  fechaCorte?: string
}

interface TendenciaPoint {
  quincenaId: number
  codigo: string
  ingresos: number
  gastos: number
  presupuestado: number
  esCurrent: boolean
}

interface ReconciliacionPlanCaja {
  snapshot: null | {
    id: number
    fechaCorte: string
    saldoCorte: number
    saldoEstimadoHoy: number
  }
  snapshotApertura?: null | {
    fechaCorte: string
    saldoAperturaEstimado: number | null
  }
  plan: {
    ingresosRegistrados: number
    ingresosPagados: number
    ingresosPorCobrar: number
    totalComprometido: number
    margenPlan: number
  }
  pagos: {
    pagosQuincena: number
    ahorroPendiente: number
    pagosPorSalir?: number
  }
  caja: null | {
    saldoProyectadoCierre: number
    resultadoCajaQuincena: number | null
    diferenciaVsPlan: number | null
    cuadraConPlan: boolean | null
  }
  diagnostico: null | {
    ajustesTiming: number
    residual: number | null
    requiereAccion: boolean
  }
}

interface DashboardData {
  presupuestos: Presupuesto[]
  transacciones: Transaccion[]
  tendencia: TendenciaPoint[]
  snapshot: Snapshot | null
  ingresos: number
  ingresosPagados: number
  gastos: number
  ahorroQuincena: number
  gastosNoCubiertos: number
  pagosQuincena: number
  pendientesCierre: GrupoCierre[]
  reconciliacion: ReconciliacionPlanCaja | null
}

const EMPTY_DATA: DashboardData = {
  presupuestos: [],
  transacciones: [],
  tendencia: [],
  snapshot: null,
  ingresos: 0,
  ingresosPagados: 0,
  gastos: 0,
  ahorroQuincena: 0,
  gastosNoCubiertos: 0,
  pagosQuincena: 0,
  pendientesCierre: [],
  reconciliacion: null,
}

function lineFalta(p: Presupuesto) {
  if (p.categoria.tipo !== 'Gasto' || !cuentaParaAgregados(p)) return 0
  return Number(p.pendiente) + Math.max(Number(p.montoEfectivo) - Number(p.real), 0)
}

function daysBetweenDateStrings(fromValue: string, toValue: string) {
  const parseDate = (value: string) => {
    const [year, month, day] = value.split('T')[0].split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }

  return Math.max(Math.floor((parseDate(toValue) - parseDate(fromValue)) / 86_400_000), 0)
}

function statusFor({
  ingresoSinAsignar,
  ingresos,
  vencidos,
  excedidos,
  gastosNoCubiertos,
}: {
  ingresoSinAsignar: number
  ingresos: number
  vencidos: number
  excedidos: number
  gastosNoCubiertos: number
}) {
  if (ingresoSinAsignar < 0) {
    return {
      label: 'Crítico',
      dot: 'bg-rose-500',
      text: 'text-rose-700 dark:text-rose-300',
      bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/50',
    }
  }
  if (vencidos > 0 || excedidos > 0 || gastosNoCubiertos > 0) {
    return {
      label: 'Atención',
      dot: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/50',
    }
  }
  if (ingresos > 0 && ingresoSinAsignar / ingresos < 0.1) {
    return {
      label: 'Ajustado',
      dot: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/50',
    }
  }
  return {
    label: 'Saludable',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/50',
  }
}

function MetricBox({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const toneClass = {
    neutral: 'text-slate-900 dark:text-slate-100',
    good: 'text-emerald-700 dark:text-emerald-300',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-rose-700 dark:text-rose-300',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 px-4 py-3">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>
    </div>
  )
}

export default function DashboardPage() {
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaId, setQuincenaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData>(EMPTY_DATA)

  useEffect(() => {
    fetch('/api/quincenas')
      .then(r => r.json())
      .then((items: Quincena[]) => {
        setQuincenas(items)
        setQuincenaId(getInitialQuincenaId(items))
      })
  }, [])

  const qActual = quincenas.find(q => q.id.toString() === quincenaId) ?? null
  const today = getMexicoDateString()

  const fetchData = useCallback(async () => {
    if (!quincenaId || !qActual) return
    setLoading(true)
    try {
      const [txRes, presupRes, liqRes, tendRes, sinCubrirRes, pagosRes, allPresupRes, reconRes] = await Promise.all([
        fetch(`/api/transacciones?quincenaId=${quincenaId}&limit=200`),
        fetch(`/api/presupuestos?quincenaId=${quincenaId}`),
        fetch(`/api/liquidez?quincenaId=${quincenaId}`),
        fetch(`/api/tendencia?quincenaId=${quincenaId}&range=5`),
        fetch(`/api/transacciones?quincenaId=${quincenaId}&asignado=no&limit=1`),
        fetch(`/api/liquidez/pagos-quincena?quincenaId=${quincenaId}`),
        fetch('/api/presupuestos'),
        fetch(`/api/liquidez/reconciliacion-plan-caja?quincenaId=${quincenaId}`),
      ])

      const [txJson, presupuestos, liquidez, tendencia, sinCubrirJson, pagosJson, allPresupuestos, reconJson] = await Promise.all([
        txRes.json(),
        presupRes.json(),
        liqRes.json(),
        tendRes.json(),
        sinCubrirRes.json(),
        pagosRes.json(),
        allPresupRes.json(),
        reconRes.json(),
      ])

      const totales = txJson.totales ?? {}
      setData({
        presupuestos: Array.isArray(presupuestos) ? presupuestos : [],
        transacciones: Array.isArray(txJson.data) ? txJson.data : [],
        tendencia: Array.isArray(tendencia) ? tendencia : [],
        snapshot: Array.isArray(liquidez) && liquidez.length > 0 ? liquidez[0] : null,
        ingresos: Number(totales.Ingreso ?? 0),
        ingresosPagados: Number(totales.IngresoPagado ?? 0),
        gastos: Number(totales.Gasto ?? 0),
        ahorroQuincena: Number(totales.Ahorro ?? 0),
        gastosNoCubiertos: Number(sinCubrirJson?.totales?.Gasto ?? 0),
        pagosQuincena: Number(pagosJson?.pagosQuincena ?? 0),
        pendientesCierre: quincenasPendientesDeCierre(
          Array.isArray(allPresupuestos) ? (allPresupuestos as PresupuestoConQuincena[]) : [],
          today,
        ),
        reconciliacion: reconRes.ok && reconJson?.plan ? (reconJson as ReconciliacionPlanCaja) : null,
      })
    } finally {
      setLoading(false)
    }
  }, [quincenaId, qActual, today])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
  }

  const snapshotMontos = data.snapshot ? normalizeMontos(data.snapshot) : null
  const saldoEnCuentas = snapshotMontos ? sumLiquidez(snapshotMontos) : null
  const presupuestosNormalizados = data.presupuestos.map(p => ({
    ...p,
    excedido: Number(p.excedido ?? 0),
  }))

  const posicion = calcularPosicionFinanciera({
    saldoEnCuentas,
    ingresos: data.ingresos,
    presupuestos: presupuestosNormalizados,
    gastosNoCubiertos: data.gastosNoCubiertos,
  })

  // Fuente única para caja y conciliación. El dashboard ya no recalcula
  // una versión simplificada distinta a Configuración → Liquidez.
  const reconciliacion = data.reconciliacion
  const margenPlan = reconciliacion?.plan.margenPlan ?? posicion.ingresoSinAsignar
  const totalComprometido = reconciliacion?.plan.totalComprometido ?? (data.ingresos - margenPlan)
  const ingresosPorCobrar = reconciliacion?.plan.ingresosPorCobrar ?? Math.max(data.ingresos - data.ingresosPagados, 0)
  const pagosPorSalir = reconciliacion?.pagos.pagosPorSalir ?? data.pagosQuincena
  const saldoProyectado = reconciliacion?.caja?.saldoProyectadoCierre ?? null
  const resultadoCajaQuincena = reconciliacion?.caja?.resultadoCajaQuincena ?? null
  const diferenciaVsPlan = reconciliacion?.caja?.diferenciaVsPlan ?? null
  const cuadraConPlan = reconciliacion?.caja?.cuadraConPlan === true
  const saldoApertura = reconciliacion?.snapshotApertura?.saldoAperturaEstimado ?? null
  const saldoEstimadoHoy = reconciliacion?.snapshot?.saldoEstimadoHoy ?? saldoEnCuentas
  const residualConciliacion = reconciliacion?.diagnostico?.residual ?? null
  const requiereAccionConciliacion = reconciliacion?.diagnostico?.requiereAccion ?? false

  const presupuestosGasto = data.presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const totalPresupuesto = presupuestosGasto.reduce((s, p) => s + Number(p.montoEfectivo), 0)
  const gastadoPresupuesto = presupuestosGasto.reduce((s, p) => s + Number(p.real), 0)
  const pctPresupuesto = totalPresupuesto > 0 ? (gastadoPresupuesto / totalPresupuesto) * 100 : 0

  const vencidos = useMemo(() => presupuestosGasto.filter(p => {
    if (!p.fechaVencimiento || lineFalta(p) <= 0) return false
    return p.fechaVencimiento.split('T')[0] < today
  }), [presupuestosGasto, today])
  const excedidos = presupuestosGasto.filter(p => Number(p.excedido ?? 0) > 0)
  const vigilando = presupuestosGasto.filter(p => Number(p.excedido ?? 0) <= 0 && Number(p.pct ?? 0) > 80)

  const snapshotDate = data.snapshot?.fechaCorte?.split('T')[0] ?? null
  const liquidityAgeDays = snapshotDate ? daysBetweenDateStrings(snapshotDate, today) : null
  const liquidityIsStale = liquidityAgeDays != null && liquidityAgeDays >= 3

  const status = statusFor({
    ingresoSinAsignar: margenPlan,
    ingresos: data.ingresos,
    vencidos: vencidos.length,
    excedidos: excedidos.length,
    gastosNoCubiertos: data.gastosNoCubiertos,
  })

  const totalPendienteCierre = data.pendientesCierre.reduce((s, g) => s + g.total, 0)
  const attentionCount =
    vencidos.length +
    excedidos.length +
    vigilando.length +
    (data.gastosNoCubiertos > 0 ? 1 : 0) +
    (data.pendientesCierre.length > 0 ? 1 : 0)

  const planTone = margenPlan < 0 ? 'bad' : 'good'
  const liquidityTone = saldoProyectado == null
    ? 'neutral'
    : saldoProyectado < 0
      ? 'bad'
      : 'good'

  const planSummaryText = margenPlan >= 0
    ? `${formatMXN(margenPlan)} de tus ingresos registrados aún no tiene destino en el plan. Es una referencia de presupuesto, no dinero disponible en cuentas.`
    : `Tienes ${formatMXN(Math.abs(margenPlan))} comprometidos por encima del ingreso registrado.`

  const liquiditySummaryText = !data.snapshot
    ? 'No hay corte de liquidez. Sin una fotografía de cuentas no podemos proyectar cuánto te va a quedar.'
    : saldoProyectado != null && saldoProyectado >= 0
      ? `Con el corte actualizado por el ledger, lo que falta cobrar y lo que falta salir, proyectas cerrar con ${formatMXN(saldoProyectado)}.`
      : `Con el corte actualizado por el ledger, lo que falta cobrar y lo que falta salir, proyectas un faltante de ${formatMXN(Math.abs(saldoProyectado ?? 0))}.`

  const liquidityFreshnessText = liquidityAgeDays == null
    ? 'Sin corte'
    : liquidityAgeDays === 0
      ? 'Actualizada hoy'
      : liquidityAgeDays === 1
        ? 'Corte de ayer'
        : `Hace ${liquidityAgeDays} días`

  const diferenciaAbs = Math.abs(diferenciaVsPlan ?? 0)
  const diferenciaHint = diferenciaVsPlan == null
    ? 'Falta un corte anterior al inicio de la quincena para comparar correctamente.'
    : cuadraConPlan
      ? 'El resultado de caja de la quincena coincide con el margen del plan.'
      : requiereAccionConciliacion && residualConciliacion != null
        ? `${formatMXN(Math.abs(residualConciliacion))} siguen sin explicación después de los ajustes detectados.`
        : 'Hay una diferencia explicada total o parcialmente por timing, créditos o movimientos entre quincenas.'

  if (!qActual && loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {qActual?.codigo ?? 'Dashboard'}
            </h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${status.bg} ${status.text}`}>
              <span className={`h-2 w-2 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>
          {qActual && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {formatDateStr(qActual.fechaInicio, { day: '2-digit', month: 'long' })}
              {' — '}
              {formatDateStr(qActual.fechaFin, { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <Link
          href="/detalle"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Vista detallada <ArrowRight size={14} />
        </Link>
      </div>

      {quincenas.length > 0 && (
        <div className="space-y-2">
          <QuincenaChips quincenas={quincenas} quincenaId={quincenaId} today={today} onSelect={selectQuincena} />
          <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />
        </div>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className={`lg:col-span-2 overflow-hidden rounded-2xl border ${planTone === 'bad' ? 'border-rose-200 dark:border-rose-800/60' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}>
              <div className="p-5 md:p-6 border-b border-slate-100 dark:border-slate-700/80">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Plan de la quincena</p>
                      <span className="rounded-full border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                        Referencia de presupuesto
                      </span>
                    </div>
                    <div className="mt-2 flex items-end gap-2 flex-wrap">
                      <p className={`text-2xl md:text-3xl font-bold tabular-nums ${planTone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
                        {formatMXN(margenPlan)}
                      </p>
                      <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">ingreso aún sin destino</span>
                    </div>
                    <p className={`mt-2 max-w-2xl text-sm ${planTone === 'bad' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}`}>
                      {planSummaryText}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 md:p-5 bg-slate-50/70 dark:bg-slate-900/30">
                <MetricBox
                  label="Ingreso registrado"
                  value={formatMXN(data.ingresos)}
                  hint="Todo el ingreso registrado, cobrado o pendiente."
                  tone="neutral"
                />
                <MetricBox
                  label="Comprometido"
                  value={formatMXN(totalComprometido)}
                  hint="Presupuesto, ahorro planificado, excedidos y gastos sin presupuesto."
                  tone={totalComprometido > data.ingresos ? 'bad' : 'neutral'}
                />
                <MetricBox
                  label="Pendiente del plan"
                  value={formatMXN(posicion.pendientePorCubrir)}
                  hint="Ejecución presupuestal pendiente; no necesariamente sale de caja en esta quincena."
                  tone={posicion.pendientePorCubrir > 0 ? 'warn' : 'good'}
                />
              </div>
            </div>

            <div className={`lg:col-span-3 overflow-hidden rounded-2xl border ${liquidityTone === 'bad' ? 'border-rose-200 dark:border-rose-800/60' : liquidityIsStale ? 'border-amber-200 dark:border-amber-800/60' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}>
              <div className="p-5 md:p-6 border-b border-slate-100 dark:border-slate-700/80">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Caja proyectada</p>
                    <div className="mt-2 flex items-end gap-2 flex-wrap">
                      <p className={`text-3xl md:text-4xl font-bold tabular-nums ${liquidityTone === 'bad' ? 'text-rose-600 dark:text-rose-400' : liquidityTone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-800 dark:text-slate-100'}`}>
                        {saldoProyectado == null ? '—' : formatMXN(saldoProyectado)}
                      </p>
                      <span className="pb-0.5 text-xs text-slate-500 dark:text-slate-400">te va a quedar</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${liquidityAgeDays == null ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-300' : liquidityIsStale ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
                    {liquidityFreshnessText}
                  </span>
                </div>
                <p className={`mt-2 text-sm ${liquidityTone === 'bad' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}`}>
                  {liquiditySummaryText}
                </p>
                {data.snapshot?.fechaCorte && (
                  <p className={`mt-2 text-xs ${liquidityIsStale ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500'}`}>
                    Último corte: {formatDate(data.snapshot.fechaCorte)}{liquidityIsStale ? '. Actualízalo para una proyección más confiable.' : ''}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 p-4 md:p-5 bg-slate-50/70 dark:bg-slate-900/30">
                <MetricBox
                  label="Saldo estimado hoy"
                  value={saldoEstimadoHoy == null ? '—' : formatMXN(saldoEstimadoHoy)}
                  hint="Último corte actualizado con movimientos pagados posteriores."
                  tone={saldoEstimadoHoy != null && saldoEstimadoHoy < 0 ? 'bad' : 'neutral'}
                />
                <MetricBox
                  label="Ingresos por cobrar"
                  value={formatMXN(ingresosPorCobrar)}
                  hint="Ingresos registrados que aún no están marcados como pagados."
                  tone={ingresosPorCobrar > 0 ? 'good' : 'neutral'}
                />
                <MetricBox
                  label="Pagos por salir"
                  value={formatMXN(pagosPorSalir)}
                  hint="Efectivo que todavía debe salir en esta quincena."
                  tone={pagosPorSalir > 0 ? 'warn' : 'good'}
                />
                <MetricBox
                  label="Resultado vs plan"
                  value={diferenciaVsPlan == null ? '—' : formatMXN(diferenciaAbs)}
                  hint={diferenciaHint}
                  tone={cuadraConPlan ? 'good' : diferenciaVsPlan == null ? 'neutral' : 'warn'}
                />
                {qActual && (
                  <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Link
                      href={`/configuracion/liquidez/reconciliar?quincenaId=${quincenaId}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                    >
                      Explicar y corregir <ArrowRight size={13} />
                    </Link>
                    <Link
                      href={`/configuracion/liquidez?quincenaId=${quincenaId}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-blue-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      <Droplets size={14} /> {data.snapshot ? 'Actualizar corte' : 'Capturar corte'}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </section>

          {saldoEnCuentas != null && (
            <section className={`rounded-2xl border p-5 ${cuadraConPlan ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/50 dark:bg-emerald-950/15' : 'border-amber-200 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/15'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Reconciliación plan vs caja</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Compara lo que realmente produjo esta quincena contra el margen del plan. No compara el saldo final absoluto contra el presupuesto.
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cuadraConPlan ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
                  {diferenciaVsPlan == null ? 'Falta base de apertura' : cuadraConPlan ? 'Cuadra' : `${formatMXN(diferenciaAbs)} por explicar`}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricBox
                  label="Saldo al iniciar Q"
                  value={saldoApertura == null ? '—' : formatMXN(saldoApertura)}
                  hint="Saldo estimado justo antes de iniciar la quincena."
                  tone="neutral"
                />
                <MetricBox
                  label="Cierre proyectado"
                  value={saldoProyectado == null ? '—' : formatMXN(saldoProyectado)}
                  hint="Dinero físico estimado al cierre."
                  tone={saldoProyectado != null && saldoProyectado < 0 ? 'bad' : 'good'}
                />
                <MetricBox
                  label="Resultado de la Q"
                  value={resultadoCajaQuincena == null ? '—' : formatMXN(resultadoCajaQuincena)}
                  hint="Cierre proyectado menos lo que ya traías al iniciar."
                  tone={resultadoCajaQuincena != null && resultadoCajaQuincena < 0 ? 'bad' : 'neutral'}
                />
                <MetricBox
                  label="Margen del plan"
                  value={formatMXN(margenPlan)}
                  hint="Ingreso de esta Q que quedó sin destino presupuestal."
                  tone={margenPlan < 0 ? 'bad' : 'neutral'}
                />
              </div>

              <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                {diferenciaVsPlan == null ? (
                  <p className="text-slate-600 dark:text-slate-300">
                    Falta un corte anterior al inicio de la quincena. Sin esa base Milo puede proyectar cuánto te va a quedar, pero no puede afirmar todavía si plan y caja cuadran.
                  </p>
                ) : cuadraConPlan ? (
                  <p className="text-emerald-700 dark:text-emerald-300">
                    El resultado de caja de esta quincena coincide con el margen del plan.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-amber-700 dark:text-amber-300">
                      Hay {formatMXN(diferenciaAbs)} de diferencia entre lo que produjo la quincena en caja y lo que dice el plan.
                    </p>
                    {residualConciliacion != null && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Después de movimientos entre quincenas, timing y créditos detectados, quedan {formatMXN(Math.abs(residualConciliacion))} sin explicación directa.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {qActual && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/configuracion/liquidez/reconciliar?quincenaId=${quincenaId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Explicar y corregir <ArrowRight size={13} />
                  </Link>
                  <Link
                    href={`/configuracion/liquidez?quincenaId=${quincenaId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Droplets size={13} /> Actualizar corte
                  </Link>
                </div>
              )}
            </section>
          )}

          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Requiere tu atención</h2>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Solo lo que puede requerir una decisión o corrección.</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${attentionCount > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
                  {attentionCount}
                </span>
              </div>

              {attentionCount === 0 ? (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-800/40 px-4 py-3">
                  <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Sin pendientes relevantes</p>
                    <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">No hay vencidos, excedidos ni gastos sin presupuesto detectados.</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
                  {vencidos.length > 0 && (
                    <AttentionRow
                      icon={<Clock3 size={16} />}
                      tone="bad"
                      title={`${vencidos.length} ${vencidos.length === 1 ? 'partida vencida' : 'partidas vencidas'}`}
                      detail={formatMXN(vencidos.reduce((s, p) => s + lineFalta(p), 0))}
                    />
                  )}
                  {data.gastosNoCubiertos > 0 && (
                    <AttentionRow
                      icon={<ReceiptText size={16} />}
                      tone="warn"
                      title="Gastos sin presupuesto"
                      detail={formatMXN(data.gastosNoCubiertos)}
                    />
                  )}
                  {excedidos.length > 0 && (
                    <AttentionRow
                      icon={<AlertTriangle size={16} />}
                      tone="bad"
                      title={`${excedidos.length} ${excedidos.length === 1 ? 'partida excedida' : 'partidas excedidas'}`}
                      detail={formatMXN(excedidos.reduce((s, p) => s + Number(p.excedido ?? 0), 0))}
                    />
                  )}
                  {vigilando.length > 0 && (
                    <AttentionRow
                      icon={<Gauge size={16} />}
                      tone="warn"
                      title={`${vigilando.length} ${vigilando.length === 1 ? 'partida arriba de 80%' : 'partidas arriba de 80%'}`}
                      detail="Vigilar"
                    />
                  )}
                  {data.pendientesCierre.length > 0 && (
                    <AttentionRow
                      icon={<CircleDollarSign size={16} />}
                      tone="warn"
                      title={`${data.pendientesCierre.length} ${data.pendientesCierre.length === 1 ? 'quincena pendiente de cierre' : 'quincenas pendientes de cierre'}`}
                      detail={formatMXN(totalPendienteCierre)}
                    />
                  )}
                </div>
              )}

              <div className="mt-4 flex gap-2 flex-wrap">
                <Link href="/presupuesto" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                  Revisar presupuesto <ArrowRight size={11} />
                </Link>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <Link href="/detalle" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400">
                  Resolver en vista detallada <ArrowRight size={11} />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Presupuesto</h2>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Ejecución de partidas de gasto.</p>
                </div>
                <span className={`text-sm font-bold tabular-nums ${pctPresupuesto > 100 ? 'text-rose-600 dark:text-rose-400' : pctPresupuesto > 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {pctPresupuesto.toFixed(0)}%
                </span>
              </div>
              <div className="mt-5 h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pctPresupuesto > 100 ? 'bg-rose-500' : pctPresupuesto > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(Math.max(pctPresupuesto, 0), 100)}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Gastado / registrado</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(gastadoPresupuesto)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Presupuestado</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(totalPresupuesto)}</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                {margenPlan >= 0
                  ? `${formatMXN(margenPlan)} de tus ingresos aún no tiene destino en el plan.`
                  : `Tienes ${formatMXN(Math.abs(margenPlan))} comprometidos por encima del ingreso registrado.`}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="Ingresos"
              value={formatMXN(data.ingresos)}
              icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
              color="text-emerald-600 dark:text-emerald-400"
              bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50"
            />
            <KpiCard
              label="Gastos"
              value={formatMXN(data.gastos)}
              icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />}
              color="text-rose-600 dark:text-rose-400"
              bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50"
            />
            <KpiCard
              label="Ahorro de la Q"
              value={formatMXN(data.ahorroQuincena)}
              icon={<PiggyBank size={20} className="text-blue-600 dark:text-blue-300" />}
              color="text-blue-600 dark:text-blue-400"
              bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
            />
            <KpiCard
              label="Saldo en cuentas"
              value={saldoEnCuentas == null ? '—' : formatMXN(saldoEnCuentas)}
              subtitle={saldoEnCuentas == null ? 'sin corte de liquidez' : 'según último corte'}
              icon={<WalletCards size={20} className="text-slate-600 dark:text-slate-300" />}
              color="text-slate-700 dark:text-slate-200"
              bg="bg-slate-100 dark:bg-slate-700/70"
            />
          </section>

          {data.tendencia.length > 1 && (
            <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Tendencia</h2>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Ingresos y gastos de las últimas quincenas.</p>
                </div>
                <ShieldCheck size={18} className="text-slate-400 dark:text-slate-500" />
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={data.tendencia} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="codigo" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    width={44}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip formatter={(value) => [formatMXN(Number(value ?? 0))]} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3, fill: '#f43f5e' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700/80">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Actividad reciente</h2>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Últimos movimientos de la quincena.</p>
              </div>
              <Link href="/transacciones" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Ver todas <ArrowRight size={11} />
              </Link>
            </div>
            {data.transacciones.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400 dark:text-slate-500">Sin movimientos registrados.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {data.transacciones.slice(0, 6).map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{tx.descripcion}</p>
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{tx.categoria.nombre} · {formatDate(tx.fecha)}</p>
                    </div>
                    <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.tipo === 'Ingreso' ? 'text-emerald-600 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>
                      {tx.tipo === 'Ingreso' ? '+' : tx.tipo === 'Gasto' ? '−' : ''}{formatMXN(Number(tx.monto))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function AttentionRow({
  icon,
  tone,
  title,
  detail,
}: {
  icon: React.ReactNode
  tone: 'warn' | 'bad'
  title: string
  detail: string
}) {
  const toneClasses = tone === 'bad'
    ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/25'
    : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/25'

  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses}`}>{icon}</span>
        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">{detail}</span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-60 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
        <div className="lg:col-span-2 h-60 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      </div>
      <div className="h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
        <div className="lg:col-span-2 h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-200/70 dark:bg-slate-800" />)}
      </div>
    </div>
  )
}