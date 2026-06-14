'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatMXN } from '@/lib/utils'

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

const EMOJI: Record<string, string> = {
  Hogar: '🏠', Salud: '💊', Familia: '👨‍👩‍👧', Transporte: '🚗',
  Suscripciones: '📱', Deudas: '💳', Personal: '🎯', Ingresos: '💵', Ahorro: '🏦',
}

function getSemaforo(margen: number, ingresos: number) {
  if (ingresos === 0) return { color: 'bg-slate-300', label: 'Sin datos', text: 'text-slate-600' }
  const ratio = margen / ingresos
  if (ratio >= 0.15) return { color: 'bg-emerald-500', label: 'Saludable', text: 'text-emerald-700' }
  if (ratio >= 0) return { color: 'bg-amber-500', label: 'Ajustado', text: 'text-amber-700' }
  return { color: 'bg-rose-500', label: 'En rojo', text: 'text-rose-700' }
}

export default function DashboardPage() {
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaId, setQuincenaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [transacciones, setTransacciones] = useState<Transaccion[]>([])
  const [gastosPendientes, setGastosPendientes] = useState<Transaccion[]>([])
  const [gastosPorCategoria, setGastosPorCategoria] = useState<{ nombre: string; monto: number; pct: number }[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
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
      const [txRes, pendRes] = await Promise.all([
        fetch(`/api/transacciones?quincenaId=${quincenaId}&limit=200`),
        fetch(`/api/transacciones?quincenaId=${quincenaId}&tipo=Gasto&estatus=Pendiente&limit=200`),
      ])
      const txJson = await txRes.json()
      const pendJson = await pendRes.json()
      const txs: Transaccion[] = txJson.data ?? []
      const pends: Transaccion[] = pendJson.data ?? []

      const ingresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + Number(t.monto), 0)
      const gastos = txs.filter(t => t.tipo === 'Gasto').reduce((s, t) => s + Number(t.monto), 0)
      const ahorros = txs.filter(t => t.tipo === 'Ahorro').reduce((s, t) => s + Number(t.monto), 0)
      const gastosPagados = txs.filter(t => t.tipo === 'Gasto' && t.estatus === 'Pagado').reduce((s, t) => s + Number(t.monto), 0)

      const presupRes = await fetch(`/api/presupuestos?quincenaId=${quincenaId}`)
      const presupData = await presupRes.json()
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
      setMetricas({
        ingresos, gastos, ahorros, margen: ingresos - gastos,
        presupTotal, pendientePorPagar: gastos - gastosPagados,
        totalGastosPendientes: pends.reduce((s, t) => s + Number(t.monto), 0),
        pctPresup: presupTotal > 0 ? (gastos / presupTotal) * 100 : 0,
      })

      const liqRes = await fetch(`/api/liquidez?quincenaId=${quincenaId}`)
      const liqData: Snapshot[] = await liqRes.json()
      setSnapshot(liqData.length > 0 ? liqData[0] : null)
    } finally {
      setLoading(false)
    }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  const sem = getSemaforo(metricas.margen, metricas.ingresos)
  const qActual = quincenas.find(q => q.id.toString() === quincenaId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {qActual ? qActual.codigo : 'Sin quincena activa'}
          </h2>
          {qActual && (
            <p className="text-sm text-slate-500 mt-1">
              {new Date(qActual.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
              {' — '}
              {new Date(qActual.fechaFin).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${sem.color}`} />
            <span className={`text-sm font-semibold ${sem.text}`}>{sem.label}</span>
          </div>
          <select
            value={quincenaId}
            onChange={e => setQuincenaId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {quincenas.map(q => (
              <option key={q.id} value={q.id}>{q.codigo}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center text-slate-400 text-sm gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Cargando...
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Ingresos" value={formatMXN(metricas.ingresos)} icon="💵" color="text-emerald-600" bg="bg-emerald-50" />
            <KpiCard label="Gastos" value={formatMXN(metricas.gastos)} icon="💸" color="text-rose-600" bg="bg-rose-50" />
            <KpiCard label="Ahorros" value={formatMXN(metricas.ahorros)} icon="🏦" color="text-blue-600" bg="bg-blue-50" />
            <KpiCard label="Margen" value={formatMXN(metricas.margen)} icon={metricas.margen >= 0 ? '📈' : '📉'} color={metricas.margen >= 0 ? 'text-indigo-600' : 'text-orange-600'} bg={metricas.margen >= 0 ? 'bg-indigo-50' : 'bg-orange-50'} />
            <KpiCard label="Pendiente" value={formatMXN(metricas.pendientePorPagar)} icon="⏳" color="text-amber-600" bg="bg-amber-50" />
            <KpiCard label="Presupuesto" value={`${metricas.pctPresup.toFixed(0)}%`} icon="📊" color={metricas.pctPresup > 90 ? 'text-rose-600' : metricas.pctPresup > 70 ? 'text-amber-600' : 'text-emerald-600'} bg={metricas.pctPresup > 90 ? 'bg-rose-50' : metricas.pctPresup > 70 ? 'bg-amber-50' : 'bg-emerald-50'} />
          </div>

          {/* Gastos por categoría + Pendientes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
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
                          <span>{EMOJI[cat.nombre] ?? '📦'}</span>
                          {cat.nombre}
                        </span>
                        <span className="text-sm font-semibold text-slate-800">{formatMXN(cat.monto)}</span>
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

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-700">Gastos pendientes</h3>
                {metricas.totalGastosPendientes > 0 && (
                  <span className="text-sm font-bold text-amber-600">{formatMXN(metricas.totalGastosPendientes)}</span>
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
                      <div className="flex items-center gap-2">
                        <span className="text-base">{EMOJI[tx.categoria.nombre] ?? '📦'}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-700">{tx.descripcion}</p>
                          <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? '—'}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-rose-600">-{formatMXN(Number(tx.monto))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Últimos movimientos */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-700 mb-4">Últimos movimientos</h3>
            {transacciones.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <p className="text-sm">Sin transacciones en esta quincena</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {transacciones.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{EMOJI[tx.categoria.nombre] ?? '📦'}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{tx.descripcion}</p>
                        <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? 'Rene'}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-semibold ${tx.tipo === 'Ingreso' ? 'text-emerald-600' : tx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'}`}>
                      {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liquidez */}
          {snapshot && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-4">Liquidez — {snapshot.quincena.codigo}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'BBVA', value: snapshot.bbva },
                  { label: 'Banamex', value: snapshot.banamex },
                  { label: 'Ualá', value: snapshot.uala },
                  { label: 'Efectivo', value: snapshot.efectivo },
                ].map(c => (
                  <div key={c.label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500">{c.label}</p>
                    <p className="text-sm font-bold text-slate-800">{formatMXN(c.value)}</p>
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
                      isActual ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300'
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
  label: string; value: string; icon: string; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center text-xl shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className={`text-lg font-bold ${color} truncate`}>{value}</p>
      </div>
    </div>
  )
}
