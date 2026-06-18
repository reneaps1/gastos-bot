'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatMXN, formatDate, formatDateStr } from '@/lib/utils'
import { TrendingUp, TrendingDown, PiggyBank, ArrowRight, ChevronRight, ChevronDown, Plus, Loader2, Check } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
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
interface Presupuesto {
  id: number; descripcion: string; montoPresupuestado: number; tipo: string
  diaCobro?: number | null; fechaVencimiento?: string | null
  categoria: Categoria; real: number; pct: number; excedido?: number
}
interface PresupuestoCategoria {
  nombre: string; presupuestado: number; gastado: number; restante: number; pct: number
}
interface TendenciaPoint {
  quincenaId: number; codigo: string; fechaInicio: string
  ingresos: number; gastos: number; presupuestado: number; esCurrent: boolean
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
  const [gastosPorCategoria, setGastosPorCategoria] = useState<{ nombre: string; monto: number; pct: number }[]>([])
  const [presupuestoPorCategoria, setPresupuestoPorCategoria] = useState<PresupuestoCategoria[]>([])
  const [presupuestosDisplay, setPresupuestosDisplay] = useState<Presupuesto[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [metricas, setMetricas] = useState({
    ingresos: 0, gastos: 0, ahorros: 0, margen: 0, balanceNeto: 0,
    presupTotal: 0, pendientePorPagar: 0, pctPresup: 0,
    gastosNoCubiertos: 0, totalExcedido: 0,
  })
  const [txSinPresupuesto, setTxSinPresupuesto] = useState<Transaccion[]>([])
  const [expandedSinPresupuesto, setExpandedSinPresupuesto] = useState(false)
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null)
  const [assigningTxId, setAssigningTxId] = useState<number | null>(null)
  const [crearLineaForTxId, setCrearLineaForTxId] = useState<number | null>(null)
  const [crearLineaForm, setCrearLineaForm] = useState({ descripcion: '', categoriaId: '', monto: '' })
  const [creandoLinea, setCreandoLinea] = useState(false)
  const [expandedBudgetIds, setExpandedBudgetIds] = useState<Set<number>>(new Set())
  const [tendencia, setTendencia] = useState<TendenciaPoint[]>([])

  useEffect(() => {
    fetch('/api/quincenas').then(r => r.json()).then((data: Quincena[]) => {
      setQuincenas(data)
      setQuincenaId(getInitialQuincenaId(data))
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
    setExpandedSinPresupuesto(false)
    setOpenPopoverId(null)
    setExpandedBudgetIds(new Set())
  }

  function toggleBudget(id: number) {
    setExpandedBudgetIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAsignar(txId: number, presupuestoId: number) {
    setAssigningTxId(txId)
    setOpenPopoverId(null)
    try {
      const res = await fetch(`/api/transacciones/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presupuestoId }),
      })
      if (res.ok) {
        const tx = txSinPresupuesto.find(t => t.id === txId)
        setTxSinPresupuesto(prev => prev.filter(t => t.id !== txId))
        setMetricas(m => ({ ...m, gastosNoCubiertos: m.gastosNoCubiertos - (tx ? Number(tx.monto) : 0) }))
      }
    } finally {
      setAssigningTxId(null)
    }
  }

  async function handleCrearYAsignar(txId: number) {
    if (!crearLineaForm.descripcion || !crearLineaForm.categoriaId || !crearLineaForm.monto) return
    setCreandoLinea(true)
    try {
      const presupRes = await fetch('/api/presupuestos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quincenaId,
          descripcion: crearLineaForm.descripcion,
          categoriaId: crearLineaForm.categoriaId,
          montoPresupuestado: crearLineaForm.monto,
          tipo: 'Gasto',
        }),
      })
      if (!presupRes.ok) return
      const newPresup = await presupRes.json()
      const txRes = await fetch(`/api/transacciones/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presupuestoId: newPresup.id }),
      })
      if (txRes.ok) {
        const tx = txSinPresupuesto.find(t => t.id === txId)
        setTxSinPresupuesto(prev => prev.filter(t => t.id !== txId))
        setMetricas(m => ({ ...m, gastosNoCubiertos: m.gastosNoCubiertos - (tx ? Number(tx.monto) : 0) }))
        setOpenPopoverId(null)
        setCrearLineaForTxId(null)
      }
    } finally {
      setCreandoLinea(false)
    }
  }

  const fetchData = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    try {
      const [txRes, presupRes, liqRes, tendRes] = await Promise.all([
        fetch(`/api/transacciones?quincenaId=${quincenaId}&limit=200`),
        fetch(`/api/presupuestos?quincenaId=${quincenaId}`),
        fetch(`/api/liquidez?quincenaId=${quincenaId}`),
        fetch(`/api/tendencia?quincenaId=${quincenaId}&range=3`),
      ])
      const txJson = await txRes.json()
      const presupData: Presupuesto[] = await presupRes.json()
      const liqData: Snapshot[] = await liqRes.json()
      const tendData = await tendRes.json()

      const txs: Transaccion[] = txJson.data ?? []

      const ingresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + Number(t.monto), 0)
      const gastos = txs.filter(t => t.tipo === 'Gasto').reduce((s, t) => s + Number(t.monto), 0)
      const ahorros = txs.filter(t => t.tipo === 'Ahorro').reduce((s, t) => s + Number(t.monto), 0)
      const gastosPagados = txs.filter(t => t.tipo === 'Gasto' && t.estatus === 'Pagado').reduce((s, t) => s + Number(t.monto), 0)
      const presupTotal = presupData.filter((p: Presupuesto) => p.categoria.tipo === 'Gasto').reduce((s: number, p: Presupuesto) => s + Number(p.montoPresupuestado), 0)

      const gastosCat = txs.filter(t => t.tipo === 'Gasto').reduce((acc, t) => {
        acc[t.categoria.nombre] = (acc[t.categoria.nombre] ?? 0) + Number(t.monto)
        return acc
      }, {} as Record<string, number>)
      const gastosCatArr = Object.entries(gastosCat)
        .map(([nombre, monto]) => ({ nombre, monto, pct: gastos > 0 ? (monto / gastos) * 100 : 0 }))
        .sort((a, b) => b.monto - a.monto)

      const presupCat = presupData
        .filter(p => p.categoria.tipo === 'Gasto')
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

      const totalExcedido = presupData
        .filter(p => p.categoria.tipo === 'Gasto')
        .reduce((s, p) => s + Math.max(0, p.real - Number(p.montoPresupuestado)), 0)

      setTransacciones(txs.slice(0, 8))
      setTxSinPresupuesto(txs.filter(t => t.tipo === 'Gasto' && t.presupuestoId == null))
      setExpandedSinPresupuesto(false)
      setOpenPopoverId(null)
      setExpandedBudgetIds(new Set())
      setGastosPorCategoria(gastosCatArr)
      setPresupuestoPorCategoria(presupuestoCatArr)
      setPresupuestosDisplay([...presupData].filter(p => p.categoria.tipo === 'Gasto').sort((a, b) => b.pct - a.pct))
      setSnapshot(liqData.length > 0 ? liqData[0] : null)
      setTendencia(Array.isArray(tendData) ? tendData : [])
      setMetricas({
        ingresos, gastos, ahorros, margen: ingresos - gastos, balanceNeto: ingresos - gastos - ahorros,
        presupTotal, pendientePorPagar: gastos - gastosPagados,
        pctPresup: presupTotal > 0 ? (gastos / presupTotal) * 100 : 0,
        gastosNoCubiertos, totalExcedido,
      })
    } finally { setLoading(false) }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  const today = getMexicoDateString()
  const sem = getSemaforo(metricas.margen, metricas.ingresos)
  const qActual = quincenas.find(q => q.id.toString() === quincenaId)
  const totalLiquidez = snapshot ? snapshot.bbva + snapshot.banamex + snapshot.uala + snapshot.ualaInversion + snapshot.efectivo : 0
  const liquidezNeta = snapshot ? totalLiquidez - snapshot.faltaPagar : 0
  const totalPresupuestoCategorias = presupuestoPorCategoria.reduce((s, c) => s + c.presupuestado, 0)
  const totalGastadoPresupuesto = presupuestoPorCategoria.reduce((s, c) => s + c.gastado, 0)
  const pctPresupuestoCategorias = totalPresupuestoCategorias > 0 ? (totalGastadoPresupuesto / totalPresupuestoCategorias) * 100 : 0
  const sinAsignar = metricas.ingresos - metricas.presupTotal
  const totalComprometido = metricas.presupTotal + metricas.gastosNoCubiertos + metricas.totalExcedido
  const disponibleReal = metricas.ingresos - totalComprometido
  const pctPresupAsignado = metricas.ingresos > 0 ? (metricas.presupTotal / metricas.ingresos) * 100 : 0
  const pctSinPresupuesto = metricas.ingresos > 0 ? (metricas.gastosNoCubiertos / metricas.ingresos) * 100 : 0
  const pctExcedido = metricas.ingresos > 0 ? (metricas.totalExcedido / metricas.ingresos) * 100 : 0
  const pctExcedidoBar = metricas.totalExcedido > 0 ? Math.max(pctExcedido, 1) : 0
  const pctSinPresupuestoBar = Math.min(pctSinPresupuesto, Math.max(0, 100 - pctPresupAsignado))
  const pctExcedidoBarClamped = Math.min(pctExcedidoBar, Math.max(0, 100 - pctPresupAsignado - pctSinPresupuestoBar))

  const excedidos = presupuestosDisplay.filter(p => (p.excedido ?? 0) > 0)
  const vigilandoItems = presupuestosDisplay.filter(p => (p.excedido ?? 0) === 0 && p.pct > 80)
  const enRangoItems = presupuestosDisplay.filter(p => (p.excedido ?? 0) === 0 && p.pct <= 80)

  const budgetCardBody = (p: Presupuesto) => {
    const restante = Number(p.montoPresupuestado) - p.real
    const isExcedido = (p.excedido ?? 0) > 0
    const barColor = isExcedido ? 'bg-rose-500' : p.pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'
    const statusColor = isExcedido ? 'text-rose-600 dark:text-rose-400' : p.pct > 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
    const status = isExcedido ? 'Excedido' : p.pct > 80 ? 'Vigilando' : 'En rango'
    return (
      <>
        <div className="flex items-start justify-between gap-3 mb-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.descripcion}</span>
          </div>
          <span className={`text-xs font-semibold shrink-0 ${statusColor}`}>
            {isExcedido ? `+${formatMXN(p.excedido ?? 0)}` : status}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-[18px] mb-2">
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
      </>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
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
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${sem.bg}`}>
          <div className={`w-2.5 h-2.5 rounded-full ${sem.color}`} />
          <span className={`text-sm font-semibold ${sem.text}`}>{sem.label}</span>
        </div>
      </div>

      {/* Selector de quincena */}
      {quincenas.length > 0 && (() => {
        const selectedIdx = quincenas.findIndex(q => quincenaId === q.id.toString())
        const windowStart = Math.max(0, Math.min(selectedIdx < 0 ? 0 : selectedIdx - 1, quincenas.length - 8))
        const visibleChips = quincenas.slice(windowStart, windowStart + 8)
        return (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          {visibleChips.map(q => {
            const ini = q.fechaInicio.split('T')[0]
            const fin = q.fechaFin.split('T')[0]
            const isRunning = today >= ini && today <= fin
            const isSelected = quincenaId === q.id.toString()
            return (
              <button
                key={q.id}
                onClick={() => selectQuincena(q.id.toString())}
                className={`flex-none px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : isRunning
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400'
                }`}
              >
                {q.codigo}
                {isRunning && !isSelected && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mb-0.5" />}
              </button>
            )
          })}
        </div>
        )
      })()}

      <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Ingresos" value={formatMXN(metricas.ingresos)} icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50" />
            <KpiCard label="Gastos" value={formatMXN(metricas.gastos)} subtitle={metricas.presupTotal > 0 ? `${metricas.pctPresup.toFixed(0)}% del presupuesto` : undefined} icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />} color="text-rose-600 dark:text-rose-400" bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50" subtitleColor={metricas.pctPresup > 90 ? 'text-rose-500 dark:text-rose-400' : metricas.pctPresup > 70 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'} />
            <KpiCard label="Ahorros" value={formatMXN(metricas.ahorros)} icon={<PiggyBank size={20} className="text-blue-600 dark:text-blue-300" />} color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50" />
            <KpiCard label="Margen" value={formatMXN(metricas.margen)} icon={metricas.margen >= 0 ? <TrendingUp size={20} className="text-indigo-600 dark:text-indigo-300" /> : <TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />} color={metricas.margen >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'} bg={metricas.margen >= 0 ? 'bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50' : 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50'} subtitle={metricas.ahorros > 0 ? `neto ${formatMXN(metricas.balanceNeto)}` : undefined} />
          </div>

          {/* Tendencia quincenal */}
          {tendencia.length > 1 && (() => {
            const current = tendencia.find(t => t.esCurrent)
            return (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Tendencia quincenal</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={tendencia} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="codigo" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748b' }} width={44} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => [formatMXN(Number(value ?? 0))]} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    {current && (
                      <ReferenceLine x={current.codigo} stroke="#6366f1" strokeDasharray="4 2" label={{ value: 'actual', fontSize: 10, fill: '#6366f1', position: 'insideTopLeft' }} />
                    )}
                    <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3, fill: '#f43f5e' }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="presupuestado" name="Presupuestado" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: '#8b5cf6' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          })()}

          {/* Planificación del presupuesto */}
          {metricas.ingresos > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Planificación del presupuesto</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sinAsignar < 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : sinAsignar === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
                  {sinAsignar < 0 ? 'Over-budget' : sinAsignar === 0 ? 'Totalmente asignado' : 'Sin asignar'}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ingresos</p>
                  <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(metricas.ingresos)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Presupuestado</p>
                  <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(metricas.presupTotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    No comprometido
                    <span className="cursor-help text-slate-300 dark:text-slate-600" title="Dinero de tus ingresos que no tiene destino en ninguna partida del presupuesto">ⓘ</span>
                  </p>
                  <p className={`text-base font-bold tabular-nums ${sinAsignar < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatMXN(Math.abs(sinAsignar))}{sinAsignar < 0 ? ' de más' : ''}</p>
                  {metricas.gastosNoCubiertos > 0 && (
                    <p className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-md px-1.5 py-0.5 inline-block">
                      ⚠ incluye {formatMXN(metricas.gastosNoCubiertos)} sin presupuestar
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    Sobrante neto
                    <span className="cursor-help text-slate-300 dark:text-slate-600" title="Lo que queda después de restar lo presupuestado, los gastos sin presupuesto y los excedidos">ⓘ</span>
                  </p>
                  <p className={`text-base font-bold tabular-nums ${disponibleReal < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatMXN(Math.abs(disponibleReal))}{disponibleReal < 0 ? ' de más' : ''}</p>
                </div>
              </div>
              {/* Stacked bar con tooltips */}
              <div className="relative mt-1">
                {/* Barra visual (overflow-hidden para pill shape) */}
                <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                  <div
                    className="h-full transition-all bg-indigo-400 dark:bg-indigo-500"
                    style={{ width: `${Math.min(pctPresupAsignado, 100)}%` }}
                  />
                  {metricas.gastosNoCubiertos > 0 && (
                    <div
                      className="h-full bg-amber-400 dark:bg-amber-500 transition-all"
                      style={{ width: `${pctSinPresupuestoBar}%` }}
                    />
                  )}
                  {metricas.totalExcedido > 0 && (
                    <div
                      className="h-full bg-rose-500 dark:bg-rose-500 transition-all"
                      style={{ width: `${pctExcedidoBarClamped}%` }}
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
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-indigo-400" />
                      Presupuestado: <span className="font-semibold">{formatMXN(metricas.presupTotal)}</span> · {pctPresupAsignado.toFixed(0)}%
                    </div>
                  </div>
                  {metricas.gastosNoCubiertos > 0 && (
                    <div
                      className="relative group/unbudget h-full cursor-default"
                      style={{ width: `${pctSinPresupuestoBar}%` }}
                    >
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover/unbudget:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-amber-400" />
                        Sin presupuesto: <span className="font-semibold">{formatMXN(metricas.gastosNoCubiertos)}</span> · {pctSinPresupuesto.toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {metricas.totalExcedido > 0 && (
                    <div
                      className="relative group/excedido h-full cursor-default"
                      style={{ width: `${pctExcedidoBarClamped}%` }}
                    >
                      <div className="absolute bottom-full mb-2 right-0 bg-slate-900 dark:bg-slate-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover/excedido:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-rose-500" />
                        Excedido: <span className="font-semibold">{formatMXN(metricas.totalExcedido)}</span> sobre partidas presupuestadas
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-indigo-400" />
                  {pctPresupAsignado.toFixed(0)}% presupuestado
                </span>
                {metricas.gastosNoCubiertos > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                    {pctSinPresupuesto.toFixed(1)}% sin presupuesto
                  </span>
                )}
                {metricas.totalExcedido > 0 && (
                  <span className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
                    <TrendingUp size={11} className="shrink-0" />
                    {formatMXN(metricas.totalExcedido)} excedido en partidas
                  </span>
                )}
              </div>
              {/* Alert strip expandible */}
              {metricas.gastosNoCubiertos > 0 && (
                <div className="mt-2.5">
                  <button
                    onClick={() => setExpandedSinPresupuesto(e => !e)}
                    className="w-full flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                      <span><span className="font-semibold tabular-nums">{formatMXN(metricas.gastosNoCubiertos)}</span> sin presupuesto · {pctSinPresupuesto.toFixed(1)}% del ingreso</span>
                    </span>
                    <ChevronDown size={14} className={`text-amber-600 dark:text-amber-400 transition-transform duration-200 shrink-0 ${expandedSinPresupuesto ? 'rotate-180' : ''}`} />
                  </button>

                  {expandedSinPresupuesto && (
                    <div className="mt-1 border border-amber-200 dark:border-amber-800/40 rounded-lg overflow-visible bg-white dark:bg-slate-800/60">
                      {txSinPresupuesto.map((tx, idx) => {
                        const opciones = presupuestosDisplay
                        const isOpen = openPopoverId === tx.id
                        const isAssigning = assigningTxId === tx.id
                        const showCrearForm = crearLineaForTxId === tx.id
                        const categoriasDisponibles = Array.from(
                          new Map([tx.categoria, ...presupuestosDisplay.map(p => p.categoria)].map(c => [c.id, c])).values()
                        ).sort((a, b) => a.nombre.localeCompare(b.nombre))
                        return (
                          <div
                            key={tx.id}
                            className={`relative flex items-center justify-between gap-3 px-3 py-2.5 ${idx < txSinPresupuesto.length - 1 ? 'border-b border-amber-100 dark:border-amber-900/40' : ''}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{tx.descripcion}</p>
                                <p className="text-[11px] text-slate-400 dark:text-slate-500">{tx.categoria.nombre} · {formatDate(tx.fecha)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatMXN(Number(tx.monto))}</span>
                              <div className="relative">
                                <button
                                  onClick={() => setOpenPopoverId(isOpen ? null : tx.id)}
                                  disabled={isAssigning}
                                  className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/70 text-amber-700 dark:text-amber-400 flex items-center justify-center transition-colors disabled:opacity-50"
                                  aria-label="Asignar a línea de presupuesto"
                                >
                                  {isAssigning ? <Loader2 size={10} className="animate-spin" /> : <Plus size={12} />}
                                </button>
                                {isOpen && (
                                  <>
                                    <div className="fixed inset-0 z-20" onClick={() => { setOpenPopoverId(null); setCrearLineaForTxId(null) }} aria-hidden />
                                    <div className="absolute right-0 bottom-full mb-1.5 w-64 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-30 overflow-hidden">
                                      {!showCrearForm ? (
                                        <>
                                          <div className="px-3 pt-2 pb-1 border-b border-slate-100 dark:border-slate-700">
                                            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Asignar a:</p>
                                          </div>
                                          <div className="max-h-48 overflow-y-auto py-1">
                                            {opciones.length > 0 ? opciones.map(p => (
                                              <button
                                                key={p.id}
                                                onClick={() => handleAsignar(tx.id, p.id)}
                                                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-start justify-between gap-2 transition-colors"
                                              >
                                                <div className="min-w-0">
                                                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{p.descripcion}</p>
                                                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{p.categoria.nombre}</p>
                                                </div>
                                                <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0 pt-0.5">{formatMXN(Number(p.montoPresupuestado))}</span>
                                              </button>
                                            )) : (
                                              <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">Sin líneas en esta quincena</p>
                                            )}
                                          </div>
                                          <div className="border-t border-slate-100 dark:border-slate-700">
                                            <button
                                              onClick={() => {
                                                setCrearLineaForTxId(tx.id)
                                                setCrearLineaForm({ descripcion: tx.descripcion, categoriaId: tx.categoria.id.toString(), monto: tx.monto.toString() })
                                              }}
                                              className="w-full text-left px-3 py-2 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 flex items-center gap-1.5 transition-colors font-medium"
                                            >
                                              <Plus size={11} /> Crear nueva línea
                                            </button>
                                          </div>
                                        </>
                                      ) : (
                                        <div className="p-3 space-y-2">
                                          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nueva línea de presupuesto</p>
                                          <div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Descripción</p>
                                            <input
                                              type="text"
                                              value={crearLineaForm.descripcion}
                                              onChange={e => setCrearLineaForm(f => ({ ...f, descripcion: e.target.value }))}
                                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                            />
                                          </div>
                                          <div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Categoría</p>
                                            <select
                                              value={crearLineaForm.categoriaId}
                                              onChange={e => setCrearLineaForm(f => ({ ...f, categoriaId: e.target.value }))}
                                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                            >
                                              {categoriasDisponibles.map(c => (
                                                <option key={c.id} value={c.id}>{c.nombre}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Presupuesto $</p>
                                            <input
                                              type="number"
                                              value={crearLineaForm.monto}
                                              onChange={e => setCrearLineaForm(f => ({ ...f, monto: e.target.value }))}
                                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                              min="0"
                                            />
                                          </div>
                                          <div className="flex gap-2 pt-0.5">
                                            <button
                                              onClick={() => setCrearLineaForTxId(null)}
                                              className="flex-1 text-xs py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                            >
                                              Cancelar
                                            </button>
                                            <button
                                              onClick={() => handleCrearYAsignar(tx.id)}
                                              disabled={creandoLinea || !crearLineaForm.descripcion || !crearLineaForm.monto}
                                              className="flex-1 text-xs py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                                            >
                                              {creandoLinea && <Loader2 size={10} className="animate-spin" />}
                                              Crear y asignar
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div className="flex justify-end px-3 py-2 border-t border-amber-100 dark:border-amber-900/40">
                        <Link
                          href={`/transacciones?asignado=no&quincenaId=${quincenaId}`}
                          className="text-xs text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                        >
                          Ver todas en transacciones <ChevronRight size={11} />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {metricas.totalExcedido > 0 && (
                <div className="mt-2.5 flex items-center justify-between gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                    <TrendingUp size={13} className="shrink-0" />
                    <span><span className="font-semibold tabular-nums">{formatMXN(metricas.totalExcedido)}</span> excedido sobre partidas presupuestadas</span>
                  </span>
                  <Link href="/presupuesto" className="text-xs font-medium text-rose-700 dark:text-rose-400 hover:underline flex items-center gap-0.5 shrink-0">
                    Revisar <ChevronRight size={11} />
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Presupuesto por partida */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Gastos vs presupuesto</h3>
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
                {metricas.totalExcedido > 0 && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    <TrendingUp size={10} /> +{formatMXN(metricas.totalExcedido)} excedido
                  </span>
                )}
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
              <div className="space-y-3">
                {/* Tier 1: Excedido — full width, borde rojo */}
                {excedidos.map(p => (
                  <div key={p.id} className="rounded-xl border border-rose-200 dark:border-rose-800/50 border-l-4 border-l-rose-500 p-3 bg-rose-50/20 dark:bg-rose-950/10">
                    {budgetCardBody(p)}
                  </div>
                ))}

                {/* Tier 2: Vigilando >80% — grid 2col, acento ámbar */}
                {vigilandoItems.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {vigilandoItems.map(p => (
                      <div key={p.id} className="rounded-xl border border-amber-200/70 dark:border-amber-800/40 border-l-4 border-l-amber-500 p-3 bg-amber-50/20 dark:bg-amber-950/10">
                        {budgetCardBody(p)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tier 3: En rango — strips compactos colapsables */}
                {enRangoItems.length > 0 && (
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700/60 overflow-hidden bg-white dark:bg-slate-800/40">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/60">
                      <Check size={12} className="text-emerald-500 shrink-0" />
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        En rango · {enRangoItems.length} {enRangoItems.length === 1 ? 'partida' : 'partidas'}
                      </span>
                    </div>
                    {enRangoItems.map((p, idx) => {
                      const isExpanded = expandedBudgetIds.has(p.id)
                      return (
                        <div key={p.id} className={idx < enRangoItems.length - 1 ? 'border-b border-slate-100 dark:border-slate-700/40' : ''}>
                          <button
                            onClick={() => toggleBudget(p.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
                            <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{p.descripcion}</span>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 hidden sm:block">{p.categoria.nombre}</span>
                            <div className="w-20 shrink-0 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                              <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(p.pct, 100)}%` }} />
                            </div>
                            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0 w-9 text-right">{p.pct.toFixed(0)}%</span>
                            <ChevronDown size={12} className={`text-slate-300 dark:text-slate-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/20">
                              {budgetCardBody(p)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Gastos por categoría */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
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
                        className={`h-2 rounded-full ${CAT_DOT[cat.nombre] ?? 'bg-slate-400'}`}
                        style={{ width: `${cat.pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{cat.pct.toFixed(1)}% del total</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actividad reciente */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Actividad reciente</h3>
              <Link href="/transacciones" className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-0.5">
                Ver todos <ArrowRight size={12} />
              </Link>
            </div>
            {transacciones.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
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
                    <span className={`text-sm font-semibold tabular-nums ml-2 ${tx.tipo === 'Ingreso' ? 'text-emerald-600 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liquidez */}
          {snapshot && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Liquidez</h3>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(totalLiquidez)}</p>
                  {snapshot && snapshot.faltaPagar > 0 && (
                    <p className={`text-xs tabular-nums font-medium ${liquidezNeta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                      neta {formatMXN(liquidezNeta)} <span className="font-normal">(-{formatMXN(snapshot.faltaPagar)} por pagar)</span>
                    </p>
                  )}
                </div>
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

        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, icon, color, bg, subtitle, subtitleColor }: {
  label: string; value: string; icon: React.ReactNode; color: string; bg: string
  subtitle?: string; subtitleColor?: string
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className={`text-lg font-bold ${color} truncate tabular-nums`}>{value}</p>
        {subtitle && <p className={`text-xs truncate tabular-nums mt-0.5 ${subtitleColor ?? 'text-slate-400 dark:text-slate-500'}`}>{subtitle}</p>}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
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
