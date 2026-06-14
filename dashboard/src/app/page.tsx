'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatMXN } from '@/lib/utils'
import { TrendingUp, TrendingDown, Wallet, PiggyBank, Clock, BarChart3, ArrowRight, Zap, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
interface User { id: number; nombre: string }
interface Transaccion {
  id: number; descripcion: string; tipo: string; monto: number; estatus: string
  categoria: Categoria; user: User | null
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

const CAT_DOT: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

function getSemaforo(margen: number, ingresos: number) {
  if (ingresos === 0) return { color: 'bg-slate-300', label: 'Sin datos', text: 'text-slate-600', bg: 'bg-slate-50' }
  const ratio = margen / ingresos
  if (ratio >= 0.15) return { color: 'bg-emerald-500', label: 'Saludable', text: 'text-emerald-700', bg: 'bg-emerald-50' }
  if (ratio >= 0) return { color: 'bg-amber-500', label: 'Ajustado', text: 'text-amber-700', bg: 'bg-amber-50' }
  return { color: 'bg-rose-500', label: 'En rojo', text: 'text-rose-700', bg: 'bg-rose-50' }
}

export default function DashboardPage() {
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaId, setQuincenaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [transacciones, setTransacciones] = useState<Transaccion[]>([])
  const [gastosPendientes, setGastosPendientes] = useState<Transaccion[]>([])
  const [gastosPorCategoria, setGastosPorCategoria] = useState<{ nombre: string; monto: number; pct: number }[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [entradasPendientes, setEntradasPendientes] = useState<EntradaRapida[]>([])
  const [metricas, setMetricas] = useState({
    ingresos: 0, gastos: 0, ahorros: 0, margen: 0,
    presupTotal: 0, pendientePorPagar: 0, totalGastosPendientes: 0, pctPresup: 0,
  })

  useEffect(() => {
    fetch('/api/quincenas').then(r => r.json()).then((data: Quincena[]) => {
      setQuincenas(data)
      const today = new Date().toISOString().split('T')[0]
      const current = data.find(q => q.fechaInicio <= today && q.fechaFin >= today)
      if (current) setQuincenaId(current.id.toString())
    })
  }, [])

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
      const presupData = await presupRes.json()
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

      setTransacciones(txs.slice(0, 8))
      setGastosPendientes(pends)
      setGastosPorCategoria(gastosCatArr)
      setSnapshot(liqData.length > 0 ? liqData[0] : null)
      setEntradasPendientes(entradasData)
      setMetricas({
        ingresos, gastos, ahorros, margen: ingresos - gastos,
        presupTotal, pendientePorPagar: gastos - gastosPagados,
        totalGastosPendientes: pends.reduce((s, t) => s + Number(t.monto), 0),
        pctPresup: presupTotal > 0 ? (gastos / presupTotal) * 100 : 0,
      })
    } finally { setLoading(false) }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  const sem = getSemaforo(metricas.margen, metricas.ingresos)
  const qActual = quincenas.find(q => q.id.toString() === quincenaId)
  const totalLiquidez = snapshot ? snapshot.bbva + snapshot.banamex + snapshot.uala + snapshot.ualaInversion + snapshot.efectivo : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {qActual ? qActual.codigo : 'Sin quincena activa'}
          </h1>
          {qActual && (
            <p className="text-sm text-slate-500 mt-0.5">
              {new Date(qActual.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
              {' — '}
              {new Date(qActual.fechaFin).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
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
            onChange={e => setQuincenaId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            {quincenas.map(q => (
              <option key={q.id} value={q.id}>{q.codigo}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Ingresos" value={formatMXN(metricas.ingresos)} icon={<TrendingUp size={20} className="text-emerald-600" />} color="text-emerald-600" bg="bg-emerald-50" />
            <KpiCard label="Gastos" value={formatMXN(metricas.gastos)} icon={<TrendingDown size={20} className="text-rose-600" />} color="text-rose-600" bg="bg-rose-50" />
            <KpiCard label="Ahorros" value={formatMXN(metricas.ahorros)} icon={<PiggyBank size={20} className="text-blue-600" />} color="text-blue-600" bg="bg-blue-50" />
            <KpiCard label="Margen" value={formatMXN(metricas.margen)} icon={metricas.margen >= 0 ? <TrendingUp size={20} className="text-indigo-600" /> : <TrendingDown size={20} className="text-orange-600" />} color={metricas.margen >= 0 ? 'text-indigo-600' : 'text-orange-600'} bg={metricas.margen >= 0 ? 'bg-indigo-50' : 'bg-orange-50'} />
            <KpiCard label="Pendiente" value={formatMXN(metricas.pendientePorPagar)} icon={<Clock size={20} className="text-amber-600" />} color="text-amber-600" bg="bg-amber-50" />
            <KpiCard label="Presupuesto" value={`${metricas.pctPresup.toFixed(0)}%`} icon={<BarChart3 size={20} className={metricas.pctPresup > 90 ? 'text-rose-600' : metricas.pctPresup > 70 ? 'text-amber-600' : 'text-emerald-600'} />} color={metricas.pctPresup > 90 ? 'text-rose-600' : metricas.pctPresup > 70 ? 'text-amber-600' : 'text-emerald-600'} bg={metricas.pctPresup > 90 ? 'bg-rose-50' : metricas.pctPresup > 70 ? 'bg-amber-50' : 'bg-emerald-50'} />
          </div>

          {/* Recurrence + Gastos por categoría */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Conceptos recurrentes pendientes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Zap size={16} className="text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-slate-700">Recurrentes</h3>
                </div>
                <Link href="/configuracion/entradas-rapidas" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  Ver todas <ChevronRight size={12} />
                </Link>
              </div>
              {entradasPendientes.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  <p className="text-sm">Sin pendientes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {entradasPendientes.slice(0, 5).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CAT_DOT[e.categoria?.nombre ?? ''] ?? 'bg-slate-400'}`} />
                        <span className="text-sm text-slate-700 truncate">{e.descripcion}</span>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ml-2 ${e.tipo === 'INGRESO' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {e.tipo === 'INGRESO' ? '+' : '-'}{formatMXN(Number(e.monto))}
                      </span>
                    </div>
                  ))}
                  {entradasPendientes.length > 5 && (
                    <p className="text-xs text-slate-400 text-center pt-1">+{entradasPendientes.length - 5} más</p>
                  )}
                </div>
              )}
            </div>

            {/* Gastos por categoría */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
              <h3 className="font-semibold text-slate-700 mb-4">Gastos por categoría</h3>
              {gastosPorCategoria.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm">Sin gastos en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {gastosPorCategoria.map(cat => (
                    <div key={cat.nombre}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-700 flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${CAT_DOT[cat.nombre] ?? 'bg-slate-400'}`} />
                          {cat.nombre}
                        </span>
                        <span className="text-sm font-semibold text-slate-800 tabular-nums">{formatMXN(cat.monto)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${cat.pct > 50 ? 'bg-rose-500' : cat.pct > 25 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                          style={{ width: `${cat.pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{cat.pct.toFixed(1)}% del total</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Gastos pendientes + Últimos movimientos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Clock size={16} className="text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-slate-700">Gastos pendientes</h3>
                </div>
                {metricas.totalGastosPendientes > 0 && (
                  <span className="text-sm font-bold text-amber-600 tabular-nums">{formatMXN(metricas.totalGastosPendientes)}</span>
                )}
              </div>
              {gastosPendientes.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm">Todo pagado en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {gastosPendientes.slice(0, 6).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{tx.descripcion}</p>
                          <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? '—'}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-rose-600 tabular-nums ml-2">-{formatMXN(Number(tx.monto))}</span>
                    </div>
                  ))}
                </div>
              )}
              {gastosPendientes.length > 0 && (
                <Link href="/transacciones?estatus=Pendiente&tipo=Gasto" className="flex items-center justify-center gap-1 mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  Ver todos <ArrowRight size={12} />
                </Link>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-700">Últimos movimientos</h3>
                <Link href="/transacciones" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  Ver todos <ChevronRight size={12} />
                </Link>
              </div>
              {transacciones.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <p className="text-sm">Sin transacciones en esta quincena</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {transacciones.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{tx.descripcion}</p>
                          <p className="text-xs text-slate-400">{tx.categoria.nombre}</p>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-700">Liquidez</h3>
                <span className="text-lg font-bold text-slate-800 tabular-nums">{formatMXN(totalLiquidez)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'BBVA', value: snapshot.bbva },
                  { label: 'Banamex', value: snapshot.banamex },
                  { label: 'Ualá', value: snapshot.uala },
                  { label: 'Efectivo', value: snapshot.efectivo },
                ].map(c => (
                  <div key={c.label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500">{c.label}</p>
                    <p className="text-sm font-bold text-slate-800 tabular-nums">{formatMXN(c.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quincenas */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-700 mb-4">Quincenas</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
              {quincenas.slice(0, 14).map(q => {
                const isActual = quincenaId === q.id.toString()
                return (
                  <button
                    key={q.id}
                    onClick={() => setQuincenaId(q.id.toString())}
                    className={`rounded-xl p-3 text-center border transition-all cursor-pointer ${
                      isActual ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    <p className={`font-bold text-sm ${isActual ? 'text-white' : 'text-slate-800'}`}>{q.codigo}</p>
                    <p className={`text-xs mt-1 ${isActual ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {new Date(q.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
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
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
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
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100" />
            <div className="flex-1">
              <div className="h-3 bg-slate-100 rounded w-16 mb-2" />
              <div className="h-5 bg-slate-100 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="h-5 bg-slate-100 rounded w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between"><div className="h-4 bg-slate-100 rounded w-24" /><div className="h-4 bg-slate-100 rounded w-16" /></div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2 space-y-3">
          <div className="h-5 bg-slate-100 rounded w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1"><div className="flex justify-between"><div className="h-4 bg-slate-100 rounded w-28" /><div className="h-4 bg-slate-100 rounded w-16" /></div><div className="h-2 bg-slate-100 rounded-full" /></div>
          ))}
        </div>
      </div>
    </div>
  )
}
