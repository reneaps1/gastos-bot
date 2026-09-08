'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarRange,
  FlaskConical,
  PiggyBank,
  RefreshCw,
  Target,
  WalletCards,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { formatMXN, formatDate } from '@/lib/utils'
import type { Presupuesto } from './page'

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

interface ScenarioDraft {
  quincenaId: number
  ingreso: string
  fijo: string
  variable: string
  creditos: string
  ahorro: string
  extraordinario: string
  lineaId: string
  lineaMonto: string
}

interface ScenarioResult {
  ingreso: number | null
  fijo: number
  variable: number
  creditos: number
  ahorro: number
  extraordinario: number
  ajusteLinea: number
  gasto: number
  necesidad: number
  margen: number | null
  diferenciaVsForecast: number
  diferenciaVsPlan: number
}

interface Props {
  today: string
  presupuestos: Presupuesto[]
}

function fuenteIngresoLabel(fuente: ForecastQuincena['fuenteIngreso']) {
  if (fuente === 'presupuesto') return 'ingreso presupuestado'
  if (fuente === 'referencia') return 'ingreso de referencia'
  return 'sin ingreso estimado'
}

function estadoMargen(ingresoEsperado: number | null, margen: number | null) {
  if (ingresoEsperado == null || margen == null) {
    return { label: 'Sin ingreso estimado', cls: 'text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-700/60' }
  }
  if (margen < 0) {
    return { label: `Faltan ${formatMXN(Math.abs(margen))}`, cls: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40' }
  }
  if (ingresoEsperado > 0 && margen / ingresoEsperado < 0.1) {
    return { label: `Margen ${formatMXN(margen)}`, cls: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40' }
  }
  return { label: `Margen ${formatMXN(margen)}`, cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40' }
}

function estadoForecast(q: ForecastQuincena) {
  return estadoMargen(q.ingresoEsperado, q.margenEstimado)
}

function numeroSeguro(value: string, fallback: number) {
  if (value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : fallback
}

function escenarioInicial(q: ForecastQuincena): ScenarioDraft {
  return {
    quincenaId: q.quincenaId,
    ingreso: q.ingresoEsperado == null ? '' : String(q.ingresoEsperado),
    fijo: String(q.gastoFijo),
    variable: String(q.gastoVariableEstimado),
    creditos: String(q.creditosProgramadosExtra),
    ahorro: String(q.ahorroPlaneado),
    extraordinario: '0',
    lineaId: '',
    lineaMonto: '',
  }
}

function ScenarioField({ label, value, onChange, hint }: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
      {hint && <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  )
}

export function PresupuestoForecast({ today, presupuestos }: Props) {
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [scenario, setScenario] = useState<ScenarioDraft | null>(null)

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

  const qs = data?.quincenas ?? []
  const primera = qs[0]
  const scenarioQ = scenario ? qs.find(q => q.quincenaId === scenario.quincenaId) ?? null : null

  const lineasScenario = useMemo(() => {
    if (!scenarioQ) return []
    return presupuestos.filter(p =>
      p.quincenaId === scenarioQ.quincenaId &&
      p.categoria.tipo === 'Gasto' &&
      p.estadoLinea !== 'Cancelada'
    )
  }, [presupuestos, scenarioQ])

  const lineaSeleccionada = scenario?.lineaId
    ? lineasScenario.find(p => p.id.toString() === scenario.lineaId) ?? null
    : null

  const scenarioResult: ScenarioResult | null = scenario && scenarioQ
    ? (() => {
        const ingreso = scenario.ingreso.trim() === ''
          ? scenarioQ.ingresoEsperado
          : numeroSeguro(scenario.ingreso, scenarioQ.ingresoEsperado ?? 0)
        let fijo = numeroSeguro(scenario.fijo, scenarioQ.gastoFijo)
        let variable = numeroSeguro(scenario.variable, scenarioQ.gastoVariableEstimado)
        const creditos = numeroSeguro(scenario.creditos, scenarioQ.creditosProgramadosExtra)
        const ahorro = numeroSeguro(scenario.ahorro, scenarioQ.ahorroPlaneado)
        const extraordinario = numeroSeguro(scenario.extraordinario, 0)

        let ajusteLinea = 0
        if (lineaSeleccionada && scenario.lineaMonto.trim() !== '') {
          const nuevoMonto = numeroSeguro(scenario.lineaMonto, Number(lineaSeleccionada.montoEfectivo))
          ajusteLinea = nuevoMonto - Number(lineaSeleccionada.montoEfectivo)
          if (lineaSeleccionada.clasificacion === 'Fijo') fijo = Math.max(0, fijo + ajusteLinea)
          else variable = Math.max(0, variable + ajusteLinea)
        }

        const gasto = fijo + variable + creditos + extraordinario
        const necesidad = gasto + ahorro
        const margen = ingreso == null ? null : ingreso - necesidad
        return {
          ingreso,
          fijo,
          variable,
          creditos,
          ahorro,
          extraordinario,
          ajusteLinea,
          gasto,
          necesidad,
          margen,
          diferenciaVsForecast: necesidad - scenarioQ.necesidadEstimada,
          diferenciaVsPlan: necesidad - scenarioQ.necesidadPlan,
        }
      })()
    : null

  function iniciarEscenario(q = primera) {
    if (!q) return
    setScenario(escenarioInicial(q))
  }

  function cambiarEscenarioQ(id: string) {
    const q = qs.find(item => item.quincenaId.toString() === id)
    if (q) setScenario(escenarioInicial(q))
  }

  function actualizarScenario<K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) {
    setScenario(prev => prev ? { ...prev, [key]: value } : prev)
  }

  function seleccionarLinea(lineaId: string) {
    const linea = lineasScenario.find(p => p.id.toString() === lineaId)
    setScenario(prev => prev ? {
      ...prev,
      lineaId,
      lineaMonto: linea ? String(Number(linea.montoEfectivo)) : '',
    } : prev)
  }

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

  const totalNecesidad = qs.reduce((s, q) => s + q.necesidadEstimada, 0)
  const totalIngreso = qs.reduce((s, q) => s + (q.ingresoEsperado ?? 0), 0)
  const totalMargenConDato = qs.filter(q => q.margenEstimado != null).reduce((s, q) => s + (q.margenEstimado ?? 0), 0)
  const todasConIngreso = qs.length > 0 && qs.every(q => q.ingresoEsperado != null)
  const scenarioEstado = scenarioResult ? estadoMargen(scenarioResult.ingreso, scenarioResult.margen) : null
  const comparacionScenario = scenarioQ && scenarioResult ? [
    { name: 'Plan vigente', valor: scenarioQ.necesidadPlan, color: '#94a3b8' },
    { name: 'Forecast', valor: scenarioQ.necesidadEstimada, color: '#8b5cf6' },
    { name: 'Escenario', valor: scenarioResult.necesidad, color: '#f59e0b' },
  ] : []

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">La Q en curso no se proyecta.</span>
          {qs.length > 0 && (
            <button
              type="button"
              onClick={() => scenario ? setScenario(null) : iniciarEscenario()}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${scenario ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-300 hover:text-amber-600 dark:hover:text-amber-400'}`}
            >
              <FlaskConical size={13} /> {scenario ? 'Cerrar escenario' : 'Simular escenario'}
            </button>
          )}
        </div>
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

          {scenario && scenarioQ && scenarioResult && scenarioEstado && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 overflow-hidden">
              <div className="p-4 md:p-5 border-b border-amber-200 dark:border-amber-800/60 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><FlaskConical size={15} className="text-amber-600 dark:text-amber-400" /> Simulación 2.0</p>
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-500 text-white px-2 py-0.5">No se guarda</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Cambia supuestos de una Q futura y mira el impacto sin alterar presupuesto ni transacciones.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScenario(escenarioInicial(scenarioQ))}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  <RefreshCw size={12} /> Restablecer Q
                </button>
              </div>

              <div className="p-4 md:p-5 grid grid-cols-1 xl:grid-cols-5 gap-5">
                <div className="xl:col-span-3 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="block">
                      <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Quincena</span>
                      <select
                        value={scenario.quincenaId}
                        onChange={e => cambiarEscenarioQ(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                      >
                        {qs.map(q => <option key={q.quincenaId} value={q.quincenaId}>{q.codigo}</option>)}
                      </select>
                    </label>
                    <ScenarioField label="Ingreso esperado" value={scenario.ingreso} onChange={v => actualizarScenario('ingreso', v)} hint="Vacío conserva 'sin dato' si no hay ingreso base." />
                    <ScenarioField label="Ahorro" value={scenario.ahorro} onChange={v => actualizarScenario('ahorro', v)} />
                    <ScenarioField label="Gasto fijo" value={scenario.fijo} onChange={v => actualizarScenario('fijo', v)} />
                    <ScenarioField label="Gasto variable" value={scenario.variable} onChange={v => actualizarScenario('variable', v)} hint={`Forecast base: ${formatMXN(scenarioQ.gastoVariableEstimado)}`} />
                    <ScenarioField label="Créditos extra" value={scenario.creditos} onChange={v => actualizarScenario('creditos', v)} />
                    <ScenarioField label="Compromiso extraordinario" value={scenario.extraordinario} onChange={v => actualizarScenario('extraordinario', v)} hint="Gasto hipotético que aún no existe en Milo." />
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Ajustar una línea concreta</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Opcional. El cambio se suma al fijo o variable según la clasificación de la línea.</p>
                      </div>
                      {scenarioResult.ajusteLinea !== 0 && (
                        <span className={`text-xs font-semibold ${scenarioResult.ajusteLinea > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {scenarioResult.ajusteLinea > 0 ? '+' : ''}{formatMXN(scenarioResult.ajusteLinea)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Línea</span>
                        <select
                          value={scenario.lineaId}
                          onChange={e => seleccionarLinea(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <option value="">Sin ajuste por línea</option>
                          {lineasScenario.map(p => (
                            <option key={p.id} value={p.id}>{p.categoria.nombre} · {p.descripcion} ({formatMXN(Number(p.montoEfectivo))})</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Nuevo monto de la línea</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!lineaSeleccionada}
                          value={scenario.lineaMonto}
                          onChange={e => actualizarScenario('lineaMonto', e.target.value)}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-violet-400"
                        />
                        {lineaSeleccionada && (
                          <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">Base vigente: {formatMXN(Number(lineaSeleccionada.montoEfectivo))} · {lineaSeleccionada.clasificacion ?? 'Variable'}</span>
                        )}
                      </label>
                    </div>
                  </div>
                </div>

                <div className="xl:col-span-2 space-y-3">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Resultado del escenario</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{scenarioQ.codigo}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${scenarioEstado.cls}`}>{scenarioEstado.label}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between gap-4 text-slate-500 dark:text-slate-400"><span>Ingreso</span><span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{scenarioResult.ingreso == null ? 'Sin dato' : formatMXN(scenarioResult.ingreso)}</span></div>
                      <div className="flex justify-between gap-4 text-slate-500 dark:text-slate-400"><span>Fijo</span><span className="tabular-nums">{formatMXN(scenarioResult.fijo)}</span></div>
                      <div className="flex justify-between gap-4 text-slate-500 dark:text-slate-400"><span>Variable</span><span className="tabular-nums">{formatMXN(scenarioResult.variable)}</span></div>
                      {scenarioResult.creditos > 0 && <div className="flex justify-between gap-4 text-indigo-600 dark:text-indigo-400"><span>Créditos</span><span className="tabular-nums">{formatMXN(scenarioResult.creditos)}</span></div>}
                      {scenarioResult.extraordinario > 0 && <div className="flex justify-between gap-4 text-amber-600 dark:text-amber-400"><span>Extraordinario</span><span className="tabular-nums">{formatMXN(scenarioResult.extraordinario)}</span></div>}
                      {scenarioResult.ahorro > 0 && <div className="flex justify-between gap-4 text-blue-600 dark:text-blue-400"><span>Ahorro protegido</span><span className="tabular-nums">{formatMXN(scenarioResult.ahorro)}</span></div>}
                      <div className="border-t border-slate-100 dark:border-slate-700 pt-2 flex justify-between gap-4 font-semibold text-slate-800 dark:text-slate-100"><span>Necesidad total</span><span className="tabular-nums">{formatMXN(scenarioResult.necesidad)}</span></div>
                      <div className={`flex justify-between gap-4 font-bold ${scenarioResult.margen == null ? 'text-slate-500 dark:text-slate-400' : scenarioResult.margen < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}><span>Margen</span><span className="tabular-nums">{scenarioResult.margen == null ? '—' : formatMXN(scenarioResult.margen)}</span></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-2.5">
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">vs. forecast</p>
                        <p className={`text-sm font-bold tabular-nums ${scenarioResult.diferenciaVsForecast > 0 ? 'text-rose-600 dark:text-rose-400' : scenarioResult.diferenciaVsForecast < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>{scenarioResult.diferenciaVsForecast > 0 ? '+' : ''}{formatMXN(scenarioResult.diferenciaVsForecast)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-2.5">
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">vs. plan vigente</p>
                        <p className={`text-sm font-bold tabular-nums ${scenarioResult.diferenciaVsPlan > 0 ? 'text-rose-600 dark:text-rose-400' : scenarioResult.diferenciaVsPlan < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>{scenarioResult.diferenciaVsPlan > 0 ? '+' : ''}{formatMXN(scenarioResult.diferenciaVsPlan)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-2"><BarChart3 size={13} className="text-violet-500" /> Plan → Forecast → Escenario</p>
                    <ResponsiveContainer width="100%" height={165}>
                      <BarChart data={comparacionScenario} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={42} />
                        <Bar dataKey="valor" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                          {comparacionScenario.map(item => <Cell key={item.name} fill={item.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            {qs.map(q => {
              const escenarioActivo = scenarioQ?.quincenaId === q.quincenaId && scenarioResult
              const estado = escenarioActivo ? estadoMargen(scenarioResult.ingreso, scenarioResult.margen) : estadoForecast(q)
              const necesidadVisible = escenarioActivo ? scenarioResult.necesidad : q.necesidadEstimada
              return (
                <article key={q.quincenaId} className={`rounded-2xl border bg-white dark:bg-slate-800 overflow-hidden ${escenarioActivo ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800/50' : 'border-slate-200 dark:border-slate-700'}`}>
                  <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{q.codigo}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${estado.cls}`}>{estado.label}</span>
                        {escenarioActivo && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">escenario</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{formatDate(q.fechaInicio)} – {formatDate(q.fechaFin)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{escenarioActivo ? 'Necesidad escenario' : 'Necesidad'}</p>
                      <p className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(necesidadVisible)}</p>
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
                    {escenarioActivo && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3 py-2 mt-2">
                        <div className="flex justify-between gap-4 text-amber-800 dark:text-amber-200 font-semibold"><span>Escenario</span><span className="tabular-nums">{formatMXN(scenarioResult.necesidad)}</span></div>
                        <div className="flex justify-between gap-4 text-[10px] text-amber-700 dark:text-amber-300 mt-1"><span>Impacto vs forecast</span><span className="tabular-nums">{scenarioResult.diferenciaVsForecast > 0 ? '+' : ''}{formatMXN(scenarioResult.diferenciaVsForecast)}</span></div>
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
