'use client'

import { TrendingUp } from 'lucide-react'
import { PresupuestoForecast } from './PresupuestoForecast'
import { usePresupuestoWorkspaceData } from './usePresupuestoWorkspaceData'

export function PresupuestoProyeccion() {
  const { today, presupuestos, loading, error } = usePresupuestoWorkspaceData()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><TrendingUp size={22} className="text-cyan-500" /> Proyección</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Cómo vienen las próximas quincenas y qué pasaría si cambias tus supuestos.</p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center text-sm text-slate-400">Cargando proyección…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-5 text-sm text-rose-700 dark:text-rose-300">No se pudieron cargar los datos para la proyección.</div>
      ) : (
        <PresupuestoForecast today={today} presupuestos={presupuestos} />
      )}
    </div>
  )
}
