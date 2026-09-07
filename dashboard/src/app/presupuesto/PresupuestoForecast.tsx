'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarRange, PiggyBank, Target, WalletCards } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'

interface ForecastQuincena {
  quincenaId: number
  codigo: string
  fechaInicio: string
  fechaFin: string
  tipo: string
  ingresoEsperado: number | null
  fuenteIngreso: 'presupuesto' | 'referencia' | 'sin_dato'
  gastoFijo: number
  gastoVariablePlan: number
  gastoVariableEstimado: number
  variableHistoricoN: number
  variableHistoricoDesviacion: number
  creditosProgramadosExtra: number
  creditosDetalle: { nombre: string; monto: number }[]
  ahorroPlaneado: number
  gastoPlan: number
  gastoEstimado: number
  necesidadPlan: number
  necesidadEstimada: number
  margenPlan: number | null
  margenEstimado: number | null
  cubreEstimado: boolean | null
  diferenciaEstimadoVsPlan: number
}

interface ForecastData {
  hoy: string
  quincenas: ForecastQuincena[]
  deudasSinCalendario: {
    totalMensual: number
    conteo: number
    items: { acreedor: string; abonoMensual: number }[]
  }
}

function fuenteIngresoLabel(fuente: ForecastQuincena['fuenteIngreso']) {
  if (fuente === 'presupuesto') return 'ingreso presupuestado'
  if (fuente === 'referencia') return 'ingreso de referencia'
  return 'sin ingreso estimado'
}

function estadoForecast(q: ForecastQuincena) {
  if (q.ingresoEsperado == null || q.margenEstimado == null) {
    return { label: 'Sin ingreso estimado', cls: 'text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-700/60' }
  }
  if (q.margenEstimado < 0) {
    return { label: `Faltan ${formatMXN(Math.abs(q.margenEstimado))}`, cls: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40' }
  }
  if (q.ingresoEsperado > 0 && q.margenEstimado / q.ingresoEsperado < 0.1) {
    return { label: `Margen ${formatMXN(q.margenEstimado)}`, cls: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40' }
  }
  return { label: `Margen ${formatMXN(q.margenEstimado)}`, cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40' }
}

export function PresupuestoForecast({ today }: { today: string }) {
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/presupuesto-forecast?hoy=${encodeURIComponent(today)}&horizonte=3`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error()))
      .then(json => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today])

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <CalendarRange size={15} className="text-violet-500" /> Forecast financiero
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Calculando próximas quincenas…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 p-5">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">No se pudo calcular el forecast</p>
        <p className="text-xs text-rose-600/80 dark:text-rose-400 mt-1">El resto de Análisis sigue disponible.</p>
      </div>
    )
  }

  const qs = data.quincenas
  const primera = qs[0]
  const totalNecesidad = qs.reduce((s, q) => s + q.necesidadEstimada, 0)
  const totalIngreso = qs.reduce((s, q) => s + (q.ingresoEsperado ?? 0), 0)
  const totalMargenConDato = qs.filter(q => q.margenEstimado != null).reduce((s, q) => s + (q.margenEstimado ?? 0), 0)
  const todasConIngreso = qs.length > 0 && qs.every(q => q.ingresoEsperado != null)

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <CalendarRange size={15} className="text-violet-500 dark:text-violet-400" /> Forecast financiero
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Próximas {qs.length || 3} Q completas · fijos conocidos + comportamiento variable + pagos de crédito + ahorro planeado.
          </p>
        </div>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">La Q en curso no se proyecta.</span>
      </div>

      {qs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No hay quincenas futuras configuradas para proyectar.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-violet-50 dark:bg-violet-950/40 dark:ring-1 dark:ring-violet-800/50 p-4">
              <p className="text-xs text-violet-600 dark:text-violet-400 mb-1 flex items-center gap-1.5"><Target size={13} /> Necesidad estimada</p>
              <p className="text-xl font-bold text-violet-700 dark:text-violet-300 tabular-nums">{formatMXN(totalNecesidad)}</p>
              <p className="text-[11px] text-violet-600/70 dark:text-violet-400/70 mt-1">{qs.length} Q · incluye ahorro planeado</p>
            </div>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 dark:ring-1 dark:ring-emerald-800/50 p-4">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1.5"><WalletCards size={13} /> Ingreso esperado</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{todasConIngreso ? formatMXN(totalIngreso) : 'Parcial'}</p>
              <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 mt-1">presupuesto o referencia por Q</p>
            </div>
            <div className={`rounded-xl p-4 ${todasConIngreso && totalMargenConDato < 0 ? 'bg-rose-50 dark:bg-rose-950/40 dark:ring-1 dark:ring-rose-800/50' : 'bg-sky-50 dark:bg-sky-950/40 dark:ring-1 dark:ring-sky-800/50'}`}>
              <p className={`text-xs mb-1 ${todasConIngreso && totalMargenConDato < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-sky-600 dark:text-sky-400'}`}>Margen proyectado</p>
              <p className={`text-xl font-bold tabular-nums ${todasConIngreso && totalMargenConDato < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-sky-700 dark:text-sky-300'}`}>
                {todasConIngreso ? formatMXN(totalMargenConDato) : '—'}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">ingreso − gasto − ahorro</p>
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 dark:ring-1 dark:ring-amber-800/50 p-4">
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1.5"><ActivityIcon /> Variable próxima Q</p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">{primera ? formatMXN(primera.gastoVariableEstimado) : '—'}</p>
              <p className="text-[11px] text-amber-600/70 dark:text-amber-400/70 mt-1">{primera?.variableHistoricoN ? `promedio de ${primera.variableHistoricoN} Q cerradas` : 'usa plan: historial insuficiente'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            {qs.map(q => {
              const estado = estadoForecast(q)
              return (
                <article key={q.quincenaId} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{q.codigo}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${estado.cls}`}>{estado.label}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{formatDate(q.fechaInicio)} – {formatDate(q.fechaFin)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Necesidad</p>
                      <p className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(q.necesidadEstimada)}</p>
                    </div>
                  </div>

                  <div className="p-4 space-y-2 text-xs">
                    <div className="flex justify-between gap-4 text-slate-600 dark:text-slate-300"><span>Ingreso esperado</span><span className="font-medium tabular-nums">{q.ingresoEsperado == null ? 'Sin dato' : formatMXN(q.ingresoEsperado)}</span></div>
                    <p className="-mt-1 text-[10px] text-slate-400 dark:text-slate-500 text-right">{fuenteIngresoLabel(q.fuenteIngreso)}</p>
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-2 flex justify-between gap-4"><span className="text-slate-500 dark:text-slate-400">Gasto fijo conocido</span><span className="tabular-nums text-slate-700 dark:text-slate-200">{formatMXN(q.gastoFijo)}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-slate-500 dark:text-slate-400">Variable estimado</span><span className="tabular-nums text-slate-700 dark:text-slate-200">{formatMXN(q.gastoVariableEstimado)}</span></div>
                    {q.gastoVariablePlan !== q.gastoVariableEstimado && (
                      <div className="flex justify-between gap-4 text-[10px] text-slate-400 dark:text-slate-500"><span>Variable en plan</span><span className="tabular-nums">{formatMXN(q.gastoVariablePlan)}</span></div>
                    )}
                    {q.creditosProgramadosExtra > 0 && (
                      <div className="flex justify-between gap-4 text-indigo-600 dark:text-indigo-400"><span>Créditos programados extra</span><span className="font-medium tabular-nums">{formatMXN(q.creditosProgramadosExtra)}</span></div>
                    )}
                    {q.ahorroPlaneado > 0 && (
                      <div className="flex justify-between gap-4 text-blue-600 dark:text-blue-400"><span className="flex items-center gap-1"><PiggyBank size={11} /> Ahorro planeado</span><span className="font-medium tabular-nums">{formatMXN(q.ahorroPlaneado)}</span></div>
                    )}
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-2 flex justify-between gap-4 font-semibold text-slate-800 dark:text-slate-100"><span>Total estimado</span><span className="tabular-nums">{formatMXN(q.necesidadEstimada)}</span></div>
                    {Math.abs(q.diferenciaEstimadoVsPlan) >= 0.01 && (
                      <div className={`flex justify-between gap-4 text-[11px] ${q.diferenciaEstimadoVsPlan > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        <span>Forecast vs. plan vigente</span><span className="tabular-nums">{q.diferenciaEstimadoVsPlan > 0 ? '+' : ''}{formatMXN(q.diferenciaEstimadoVsPlan)}</span>
                      </div>
                    )}
                    {q.creditosDetalle.length > 0 && (
                      <div className="pt-1 space-y-1">
                        {q.creditosDetalle.map((p, i) => <p key={`${p.nombre}-${i}`} className="text-[10px] text-slate-400 dark:text-slate-500">{p.nombre}: {formatMXN(p.monto)}</p>)}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      {data.deudasSinCalendario.totalMensual > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex gap-3">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <p className="font-semibold">{formatMXN(data.deudasSinCalendario.totalMensual)}/mes en {data.deudasSinCalendario.conteo} deuda{data.deudasSinCalendario.conteo === 1 ? '' : 's'} sin calendario por Q.</p>
            <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">
              No las sumo automáticamente al forecast: Milo conoce el abono mensual, pero no en qué quincena cae y podría duplicar una línea ya presupuestada. Calendariza el pago o crea su línea de presupuesto para incorporarlo con certeza.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
        <ArrowRight size={13} className="shrink-0 mt-0.5" />
        <p><span className="font-semibold text-slate-600 dark:text-slate-300">Cómo se calcula:</span> los gastos fijos usan lo que ya está presupuestado; la parte variable usa el promedio real de hasta 6 periodos cerrados del mismo tipo; los pagos de crédito con Q conocida se agregan solo cuando no están ya ligados a una línea; el ahorro planeado se trata como dinero comprometido, no como gasto.</p>
      </div>
    </section>
  )
}

function ActivityIcon() {
  return <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
}
