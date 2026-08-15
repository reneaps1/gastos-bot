'use client'
import { useState, useEffect, useCallback } from 'react'
import { PiggyBank, TrendingUp, TrendingDown } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: string; monto: number
  quincena: Quincena; user: { id: number; nombre: string } | null
  balanceAcumulado: number
}
interface PorQuincena { quincena: Quincena; aportado: number; retirado: number }
interface AhorroData {
  total: number
  porQuincena: PorQuincena[]
  transacciones: Transaccion[]
}

export default function AhorroPage() {
  const [data, setData] = useState<AhorroData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAhorro = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ahorro')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAhorro() }, [fetchAhorro])

  if (loading) {
    return (
      <div className="py-16 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Cargando...
      </div>
    )
  }

  if (!data || data.transacciones.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ahorro</h2>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <PiggyBank size={28} className="text-blue-400" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin movimientos de ahorro</p>
          <p className="text-sm mt-1">Los gastos con categoría &quot;Ahorro&quot; se acumulan aquí</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ahorro</h2>

      {/* Hero total */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
          <PiggyBank size={28} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Ahorro disponible</p>
          <p className="text-3xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{formatMXN(data.total)}</p>
        </div>
      </div>

      {/* Desglose por quincena */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Por quincena</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-2.5 text-left text-slate-500 dark:text-slate-400 font-medium">Quincena</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Aportado</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Retirado</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {data.porQuincena.map(pq => (
                <tr key={pq.quincena.id}>
                  <td className="px-4 py-2.5">
                    <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {pq.quincena.codigo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {pq.aportado > 0 ? `+${formatMXN(pq.aportado)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">
                    {pq.retirado > 0 ? `-${formatMXN(pq.retirado)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatMXN(pq.aportado - pq.retirado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historial cronológico */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Historial</h3>
        </div>
        <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {data.transacciones.map(t => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                {t.tipo === 'Ingreso'
                  ? <TrendingDown size={16} className="text-rose-500 shrink-0" />
                  : <TrendingUp size={16} className="text-emerald-500 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{t.descripcion}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(t.fecha)} · {t.quincena.codigo}{t.user ? ` · ${t.user.nombre}` : ''}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-semibold tabular-nums ${t.tipo === 'Ingreso' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {t.tipo === 'Ingreso' ? '-' : '+'}{formatMXN(Number(t.monto))}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">saldo {formatMXN(t.balanceAcumulado)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
