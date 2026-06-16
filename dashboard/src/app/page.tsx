'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatMXN, formatDate, formatDateStr } from '@/lib/utils'
import { TrendingUp, TrendingDown, Wallet, PiggyBank, Clock, BarChart3, ArrowRight, Zap, ChevronRight, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { getInitialQuincenaId, getMexicoDateString, persistQuincenaId } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
interface User { id: number; nombre: string }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: string; monto: number; estatus: string
  categoria: Categoria; user: User | null; presupuestoId: number | null
}
interface Snapshot {
  id: number; bbva: number; banamex: number; uala: number; ualaInversion: number
  efectivo: number; valesDespensa: number; valesGasolina: number; faltaPagar: number
  teorico: number | null; quincena: Quincena
}
interface EntradaRapida {
  id: number; descripcion: string; monto: number; tipo: string | null
  categoria: { nombre: string } | null; procesado: boolean
}
interface Presupuesto {
  id: number; descripcion: string; montoPresupuestado: number; tipo: string
  diaCobro?: number | null; fechaVencimiento?: string | null
  categoria: Categoria; real: number; pct: number
}
interface PresupuestoCategoria {
  nombre: string; presupuestado: number; gastado: number; restante: number; pct: number
}

const CAT_DOT: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

function getSemaforo(margen: number, ingresos: number) {
  if (ingresos === 0) return { color: 'bg-slate-300 dark:bg-slate-500', label: 'Sin datos', text: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800/80 dark:border dark:border-slate-700' }
  const ratio = margen / ingresos
  if (ratio >= 0.15) return { color: 'bg-emerald-500', label: 'Saludable', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40 dark:border dark:border-emerald-800/60' }
  if (ratio >= 0) return { color: 'bg-amber-500', label: 'Ajustado', text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40 dark:border dark:border-amber-800/60' }
  return { color: 'bg-rose-500', label: 'En rojo', text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/60' }
}

export default function DashboardPage() {
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaId, setQuincenaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [transacciones, setTransacciones] = useState<Transaccion[]>([])
  const [gastosPendientes, setGastosPendientes] = useState<Transaccion[]>([])
  const [gastosPorCategoria, setGastosPorCategoria] = useState<{ nombre: string; monto: number; pct: number }[]>([])
  const [presupuestoPorCategoria, setPresupuestoPorCategoria] = useState<PresupuestoCategoria[]>([])
  const [presupuestosDisplay, setPresupuestosDisplay] = useState<Presupuesto[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [entradasPendientes, setEntradasPendientes] = useState<EntradaRapida[]>([])
  const [metricas, setMetricas] = useState({
    ingresos: 0, gastos: 0, ahorros: 0, margen: 0,
    presupTotal: 0, pendientePorPagar: 0, totalGastosPendientes: 0, pctPresup: 0,
    gastosNoCubiertos: 0,
  })

  useEffect(() => {
    fetch('/api/quincenas').then(r => r.json()).then((data: Quincena[]) => {
      setQuincenas(data)
      setQuincenaId(getInitialQuincenaId(data))
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
  }

  const fetchData = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    try {
      const [txRes, pendRes, presupRes, liqRes, entradasRes] = await Promise.all([
        fetch(`/api/transacciones?quincenaId=${quincenaId}&limit=200`),
        fetch(`/api/transacciones?quincenaId=${quincenaId}&tipo=Gasto&estatus=Pendiente&limit=200`),
        fetch(`/api/presupuestos?quincenaId=${quincenaId}`),
        fetch(`/api/liquidez?quincenaId=${quincenaId}`),
        fetch(`/api/entradas-rapidas?quincenaId=${quincenaId}&procesado=false`),
      ])
      const txJson = await txRes.json()
      const pendJson = await pendRes.json()
      const presupData: Presupuesto[] = await presupRes.json()
      const liqData: Snapshot[] = await liqRes.json()
      const entradasData: EntradaRapida[] = await entradasRes.json()

      const txs: Transaccion[] = txJson.data ?? []
      const pends: Transaccion[] = pendJson.data ?? []

      const ingresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + Number(t.monto), 0)
      const gastos = txs.filter(t => t.tipo === 'Gasto').reduce((s, t) => s + Number(t.monto), 0)
      const ahorros = txs.filter(t => t.tipo === 'Ahorro').reduce((s, t) => s + Number(t.monto), 0)
      const gastosPagados = txs.filter(t => t.tipo === 'Gasto' && t.estatus === 'Pagado').reduce((s, t) => s + Number(t.monto), 0)
      const presupTotal = presupData.reduce((s: number, p: { montoPresupuestado: number }) => s + Number(p.montoPresupuestado), 0)

      const gastosCat = txs.filter(t => t.tipo === 'Gasto').reduce((acc, t) => {
        acc[t.categoria.nombre] = (acc[t.categoria.nombre] ?? 0) + Number(t.monto)
        return acc
      }, {} as Record<string, number>)
      const gastosCatArr = Object.entries(gastosCat)
        .map(([nombre, monto]) => ({ nombre, monto, pct: gastos > 0 ? (monto / gastos) * 100 : 0 }))
        .sort((a, b) => b.monto - a.monto)

      const presupCat = presupData
        .filter(p => p.tipo === 'Gasto' || p.categoria.tipo === 'Gasto')
        .reduce((acc, p) => {
          const nombre = p.categoria.nombre
          acc[nombre] = (acc[nombre] ?? 0) + Number(p.montoPresupuestado)
          return acc
        }, {} as Record<string, number>)
      const presupuestoCatArr = Object.entries(presupCat)
        .map(([nombre, presupuestado]) => {
          const gastado = gastosCat[nombre] ?? 0
          return {
            nombre,
            presupuestado,
            gastado,
            restante: presupuestado - gastado,
            pct: presupuestado > 0 ? (gastado / presupuestado) * 100 : 0,
          }
        })
        .sort((a, b) => b.pct - a.pct)

      const gastosNoCubiertos = txs
        .filter(t => t.tipo === 'Gasto' && t.presupuestoId == null)
        .reduce((s, t) => s + Number(t.monto), 0)

      setTransacciones(txs.slice(0, 8))
      setGastosPendientes(pends)
      setGastosPorCategoria(gastosCatArr)
      setPresupuestoPorCategoria(presupuestoCatArr)
      setPresupuestosDisplay([...presupData].filter(p => p.tipo === 'Gasto').sort((a, b) => b.pct - a.pct))
      setSnapshot(liqData.length > 0 ? liqData[0] : null)
      setEntradasPendientes(entradasData)
      setMetricas({
        ingresos, gastos, ahorros, margen: ingresos - gastos,
        presupTotal, pendientePorPagar: gastos - gastosPagados,
        totalGastosPendientes: pends.reduce((s, t) => s + Number(t.monto), 0),
        pctPresup: presupTotal > 0 ? (gastos / presupTotal) * 100 : 0,
        gastosNoCubiertos,
      })
    } finally { setLoading(false) }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  const today = getMexicoDateString()
  const sem = getSemaforo(metricas.margen, metricas.ingresos)
  const qActual = quincenas.find(q => q.id.toString() === quincenaId)
  const totalLiquidez = snapshot ? snapshot.bbva + snapshot.banamex + snapshot.uala + snapshot.ualaInversion + snapshot.efectivo : 0
  const totalPresupuestoCategorias = presupuestoPorCategoria.reduce((s, c) => s + c.presupuestado, 0)
  const totalGastadoPresupuesto = presupuestoPorCategoria.reduce((s, c) => s + c.gastado, 0)
  const pctPresupuestoCategorias = totalPresupuestoCategorias > 0 ? (totalGastadoPresupuesto / totalPresupuestoCategorias) * 100 : 0
  const sinAsignar = metricas.ingresos - metricas.presupTotal
  const pctPresupAsignado = metricas.ingresos > 0 ? (metricas.presupTotal / metricas.ingresos) * 100 : 0
  const pctSinPresupuesto = metricas.ingresos > 0 ? (metricas.gastosNoCubiertos / metricas.ingresos) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {qActual ? qActual.codigo : 'Sin quincena activa'}
          </h1>
          {qActual && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {formatDateStr(qActual.fechaInicio, { day: '2-digit', month: 'long' })}
              {' — '}
              {formatDateStr(qActual.fechaFin, { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${sem.bg}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${sem.color}`} />
            <span className={`text-sm font-semibold ${sem.text}`}>{sem.label}</span>
          </div>
          <select
            value={quincenaId}
            onChange={e => selectQuincena(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm dark:shadow-none"
          >
            {quincenas.map(q => {
              const ini = q.fechaInicio.split('T')[0]
              const fin = q.fechaFin.split('T')[0]
              const isActive = today >= ini && today <= fin
              return <option key={q.id} value={q.id}>{isActive ? '● ' : ''}{q.codigo}{isActive ? ' · En curso' : ''}</option>
            })}
          </select>
        </div>
      </div>

      <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Ingresos" value={formatMXN(metricas.ingresos)} icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50" />
            <KpiCard label="Gastos" value={formatMXN(metricas.gastos)} icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />} color="text-rose-600 dark:text-rose-400" bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50" />
            <KpiCard label="Ahorros" value={formatMXN(metricas.ahorros)} icon={<PiggyBank size={20} className="text-blue-600 dark:text-blue-300" />} color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50" />
            <KpiCard label="Margen" value={formatMXN(metricas.margen)} icon={metricas.margen >= 0 ? <TrendingUp size={20} className="text-indigo-600 dark:text-indigo-300" /> : <TrendingDown size={20} className="text-orange-600 dark:text-orange-300" />} color={metricas.margen >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-orange-600 dark:text-orange-400'} bg={metricas.margen >= 0 ? 'bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50' : 'bg-orange-50 dark:bg-orange-950/50 dark:ring-1 dark:ring-orange-800/50'} />
            <KpiCard label="Pendiente" value={formatMXN(metricas.pendientePorPagar)} icon={<Clock size={20} className="text-amber-600 dark:text-amber-300" />} color="text-amber-600 dark:text-amber-400" bg="bg-amber-50 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50" />
            <KpiCard label="Presupuesto" value={`${metricas.pctPresup.toFixed(0)}%`} icon={<BarChart3 size={20} className={metricas.pctPresup > 90 ? 'text-rose-600 dark:text-rose-300' : metricas.pctPresup > 70 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'} />} color={metricas.pctPresup > 90 ? 'text-rose-600 dark:text-rose-400' : metricas.pctPresup > 70 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} bg={metricas.pctPresup > 90 ? 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50' : metricas.pctPresup > 70 ? 'bg-amber-50 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50' : 'bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50'} />
          </div>

          {/* Planificación del presupuesto */}
          {metricas.ingresos > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Planificación del presupuesto</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sinAsignar < 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : sinAsignar === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
                  {sinAsignar < 0 ? 'Over-budget' : sinAsignar === 0 ? 'Totalmente asignado' : 'Sin asignar'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ingresos</p>
                  <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(metricas.ingresos)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Presupuestado</p>
                  <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(metricas.presupTotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sin asignar</p>
                  <p className={`text-base font-bold tabular-nums ${sinAsignar < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatMXN(Math.abs(sinAsignar))}{sinAsignar < 0 ? ' de más' : ''}</p>
                </div>
              </div>
              {/* Stacked bar con tooltips */}
              <div className="relative mt-1">
                {/* Barra visual (overflow-hidden para pill shape) */}
                <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                  <div
                    className={`h-full transition-all ${pctPresupAsignado > 100 ? 'bg-rose-500' : pctPresupAsignado > 85 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(pctPresupAsignado, 100)}%` }}
                  />
                  {metricas.gastosNoCubiertos > 0 && (
                    <div
                      className="h-full bg-rose-500 transition-all"
                      style={{ width: `${Math.min(pctSinPresupuesto, Math.max(0, 100 - pctPresupAsignado))}%` }}
                    />
                  )}
                </div>
                {/* Overlay invisible para tooltips (no afecta overflow-hidden de la barra) */}
                <div className="absolute inset-0 flex">
                  <div
                    className="relative group/budget h-full cursor-default"
                    style={{ width: `${Math.min(pctPresupAsignado, 100)}%` }}
                  >
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover/budget:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${pctPresupAsignado > 85 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      Presupuestado: <span className="font-semibold">{formatMXN(metricas.presupTotal)}</span> · {pctPresupAsignado.toFixed(0)}%
                    </div>
                  </div>
                  {metricas.gastosNoCubiertos > 0 && (
                    <div
                      className="relative group/unbudget h-full cursor-default"
                      style={{ width: `${Math.min(pctSinPresupuesto, Math.max(0, 100 - pctPresupAsignado))}%` }}
                    >
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover/unbudget:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-rose-400" />
                        Sin presupuesto: <span className="font-semibold">{formatMXN(metricas.gastosNoCubiertos)}</span> · {pctSinPresupuesto.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${pctPresupAsignado > 100 ? 'bg-rose-500' : pctPresupAsignado > 85 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {pctPresupAsignado.toFixed(0)}% presupuestado
                </span>
                {metricas.gastosNoCubiertos > 0 && (
                  <span className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
                    <span className="w-2 h-2 rounded-full shrink-0 bg-rose-500" />
                    {pctSinPresupuesto.toFixed(1)}% sin presupuesto
                  </span>
                )}
              </div>
              {/* Alert strip */}
              {metricas.gastosNoCubiertos > 0 && (
                <div className="mt-2.5 flex items-center justify-between gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                    <span><span className="font-semibold tabular-nums">{formatMXN(metricas.gastosNoCubiertos)}</span> sin presupuesto · {pctSinPresupuesto.toFixed(1)}% del ingreso</span>
                  </span>
                  <Link href="/presupuesto" className="text-xs font-medium text-rose-700 dark:text-rose-400 hover:underline flex items-center gap-0.5 shrink-0">
                    Agregar <ChevronRight size={11} />
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Presupuesto por partida */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h3 className="font-semibold text-slate-700 dark:text-slate-200">Gastos vs presupuesto</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Partidas de presupuesto de esta quincena
                </p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-bold tabular-nums ${pctPresupuestoCategorias > 100 ? 'text-rose-600 dark:text-rose-400' : pctPresupuestoCategorias > 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {pctPresupuestoCategorias.toFixed(0)}%
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatMXN(totalGastadoPresupuesto)} de {formatMXN(totalPresupuestoCategorias)}
                </p>
              </div>
            </div>

            {presupuestosDisplay.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                <p className="text-sm">Sin presupuesto de gasto para esta quincena</p>
                <Link href="/presupuesto" className="inline-flex items-center gap-1 mt-2 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                  Configurar presupuesto <ChevronRight size={12} />
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {presupuestosDisplay.map(p => {
                  const restante = Number(p.montoPresupuestado) - p.real
                  const status = p.pct > 100 ? 'Excedido' : p.pct > 80 ? 'Vigilando' : 'En rango'
                  const barColor = p.pct > 100 ? 'bg-rose-500' : p.pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                  const statusColor = p.pct > 100 ? 'text-rose-600 dark:text-rose-400' : p.pct > 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                  return (
                    <div key={p.id} className="rounded-xl border border-slate-100 dark:border-slate-700/60 p-3 bg-slate-50/60 dark:bg-slate-900/30">
                      <div className="flex items-start justify-between gap-3 mb-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.descripcion}</span>
                        </div>
                        <span className={`text-xs font-semibold shrink-0 ${statusColor}`}>{status}</span>
                      </div>
                      <div className="flex items-center gap-2 ml-4.5 mb-2">
                        <p className="text-xs text-slate-400 dark:text-slate-500">{p.categoria.nombre}</p>
                        {p.fechaVencimiento && (() => {
                          const d = new Date(`${p.fechaVencimiento.split('T')[0]}T00:00:00`)
                          const dia = d.getDate()
                          const esQ1 = dia <= 15
                          return (
                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${esQ1 ? 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400' : 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'}`}>
                              vence {d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
                            </span>
                          )
                        })()}
                      </div>
                      <div className="flex items-end justify-between gap-3 mb-2">
                        <div>
                          <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(p.real)}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">presupuesto {formatMXN(Number(p.montoPresupuestado))}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-semibold tabular-nums ${restante < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
                            {restante < 0 ? '+' : ''}{formatMXN(Math.abs(restante))}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{restante < 0 ? 'excedido' : 'restante'}</p>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                        <div className={`h-2.5 rounded-full ${barColor}`} style={{ width: `${Math.min(p.pct, 100)}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{p.pct.toFixed(1)}% usado</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recurrence + Gastos por categoría */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Conceptos recurrentes pendientes */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50 flex items-center justify-center">
                    <Zap size={16} className="text-amber-600 dark:text-amber-300" />
                  </div>
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">Recurrentes</h3>
                </div>
                <Link href="/configuracion/entradas-rapidas" className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-0.5">
                  Ver todas <ChevronRight size={12} />
                </Link>
              </div>
              {entradasPendientes.length === 0 ? (
                <div className="text-center py-6 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Sin pendientes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {entradasPendientes.slice(0, 5).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CAT_DOT[e.categoria?.nombre ?? ''] ?? 'bg-slate-400'}`} />
                        <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{e.descripcion}</span>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ml-2 ${e.tipo === 'INGRESO' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {e.tipo === 'INGRESO' ? '+' : '-'}{formatMXN(Number(e.monto))}
                      </span>
                    </div>
                  ))}
                  {entradasPendientes.length > 5 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-1">+{entradasPendientes.length - 5} más</p>
                  )}
                </div>
              )}
            </div>

            {/* Gastos por categoría */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 lg:col-span-2">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4">Gastos por categoría</h3>
              {gastosPorCategoria.length === 0 ? (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Sin gastos en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {gastosPorCategoria.map(cat => (
                    <div key={cat.nombre}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${CAT_DOT[cat.nombre] ?? 'bg-slate-400'}`} />
                          {cat.nombre}
                        </span>
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(cat.monto)}</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${cat.pct > 50 ? 'bg-rose-500' : cat.pct > 25 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                          style={{ width: `${cat.pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{cat.pct.toFixed(1)}% del total</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Gastos pendientes + Últimos movimientos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50 flex items-center justify-center">
                    <Clock size={16} className="text-amber-600 dark:text-amber-300" />
                  </div>
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">Gastos pendientes</h3>
                </div>
                {metricas.totalGastosPendientes > 0 && (
                  <span className="text-sm font-bold text-amber-600 tabular-nums">{formatMXN(metricas.totalGastosPendientes)}</span>
                )}
              </div>
              {gastosPendientes.length === 0 ? (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Todo pagado en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {gastosPendientes.slice(0, 6).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{tx.descripcion}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{tx.categoria.nombre} · {tx.user?.nombre ?? '—'}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-rose-600 tabular-nums ml-2">-{formatMXN(Number(tx.monto))}</span>
                    </div>
                  ))}
                </div>
              )}
              {gastosPendientes.length > 0 && (
                <Link href="/transacciones?estatus=Pendiente&tipo=Gasto" className="flex items-center justify-center gap-1 mt-3 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                  Ver todos <ArrowRight size={12} />
                </Link>
              )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200">Últimos movimientos</h3>
                <Link href="/transacciones" className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-0.5">
                  Ver todos <ChevronRight size={12} />
                </Link>
              </div>
              {transacciones.length === 0 ? (
                <div className="text-center py-10 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Sin transacciones en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {transacciones.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{tx.descripcion}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{tx.categoria.nombre} · {formatDate(tx.fecha)}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ml-2 ${tx.tipo === 'Ingreso' ? 'text-emerald-600' : tx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'}`}>
                        {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Liquidez */}
          {snapshot && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200">Liquidez</h3>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(totalLiquidez)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'BBVA', value: snapshot.bbva },
                  { label: 'Banamex', value: snapshot.banamex },
                  { label: 'Ualá', value: snapshot.uala },
                  { label: 'Efectivo', value: snapshot.efectivo },
                ].map(c => (
                  <div key={c.label} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(c.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quincenas */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4">Quincenas</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
              {quincenas.slice(0, 14).map(q => {
                const isActual = quincenaId === q.id.toString()
                return (
                  <button
                    key={q.id}
                    onClick={() => selectQuincena(q.id.toString())}
                    className={`rounded-xl p-3 text-center border transition-all cursor-pointer ${
                      isActual ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/50' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                    }`}
                  >
                    <p className={`font-bold text-sm ${isActual ? 'text-white' : 'text-slate-800 dark:text-slate-100'}`}>{q.codigo}</p>
                    <p className={`text-xs mt-1 ${isActual ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>
                      {formatDateStr(q.fechaInicio, { day: '2-digit', month: 'short' })}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, icon, color, bg }: {
  label: string; value: string; icon: React.ReactNode; color: string; bg: string
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className={`text-lg font-bold ${color} truncate tabular-nums`}>{value}</p>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700" />
            <div className="flex-1">
              <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-16 mb-2" />
              <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between"><div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-24" /><div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-16" /></div>
          ))}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 lg:col-span-2 space-y-3">
          <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1"><div className="flex justify-between"><div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-28" /><div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-16" /></div><div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full" /></div>
          ))}
        </div>
      </div>
    </div>
  )
}
