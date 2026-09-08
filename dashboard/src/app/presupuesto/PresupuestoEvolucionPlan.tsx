'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowRightLeft, History, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import type { Presupuesto } from './page'

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

interface CambioPresupuesto {
  id: number
  quincenaId: number
  tipo:
    | 'CREACION'
    | 'AJUSTE_MANUAL'
    | 'DESDE_SIN_ASIGNAR'
    | 'TRASPASO_ENTRADA'
    | 'TRASPASO_SALIDA'
    | 'MIGRACION_VIGENTE'
  montoAnterior: number
  montoNuevo: number
  delta: number
  grupoCambioId: string | null
  motivo: string | null
  actor: string | null
  fechaCreacion: string
  presupuesto: {
    id: number
    descripcion: string
    categoriaId: number
    categoria: string
  }
  relacionado: {
    id: number
    descripcion: string
    categoriaId: number
    categoria: string
  } | null
}

interface ResumenQ {
  quincena: Quincena
  original: number
  vigente: number
  real: number
  ajusteNeto: number
  sumaAbsolutaAjustes: number
  reasignado: number
  movimientoPlan: number
  estabilidad: number | null
  lineasCambiadas: number
  lineasTotal: number
}

interface Props {
  quincenas: Quincena[]
  presupuestos: Presupuesto[]
  desdeId: string
  hastaId: string
  categoriaId: string
}

const EPS = 0.005

function quincenasEnRango(quincenas: Quincena[], desdeId: string, hastaId: string) {
  const ordenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const iDesde = ordenadas.findIndex(q => q.id.toString() === desdeId)
  const iHasta = ordenadas.findIndex(q => q.id.toString() === hastaId)
  if (iDesde === -1 || iHasta === -1) return ordenadas
  const [lo, hi] = iDesde <= iHasta ? [iDesde, iHasta] : [iHasta, iDesde]
  return ordenadas.slice(lo, hi + 1)
}

function vigenteParaHistoria(p: Presupuesto) {
  // Una línea cancelada sí formó parte del plan Original, pero deja de formar
  // parte del plan Vigente. Para evolución del plan no se puede simplemente
  // excluir la fila completa, porque eso borraría retroactivamente lo planeado.
  if (p.estadoLinea === 'Cancelada') return 0
  return Number(p.montoEfectivo)
}

function construirResumen(q: Quincena, rows: Presupuesto[]): ResumenQ | null {
  const gasto = rows.filter(p => p.quincenaId === q.id && p.categoria.tipo === 'Gasto')
  if (gasto.length === 0) return null

  let original = 0
  let vigente = 0
  let real = 0
  let sumaAbsolutaAjustes = 0
  let lineasCambiadas = 0

  for (const p of gasto) {
    const o = Number(p.montoPresupuestado)
    const v = vigenteParaHistoria(p)
    original += o
    vigente += v
    real += Number(p.real)
    const delta = v - o
    sumaAbsolutaAjustes += Math.abs(delta)
    if (Math.abs(delta) >= EPS) lineasCambiadas += 1
  }

  const ajusteNeto = vigente - original
  // Si A baja $200 y B sube $200, Σ|delta|=400 pero solo $200 fueron
  // reasignados. Esta fórmula separa ese monto del cambio neto del plan.
  const reasignado = Math.max(0, (sumaAbsolutaAjustes - Math.abs(ajusteNeto)) / 2)
  const movimientoPlan = Math.abs(ajusteNeto) + reasignado
  const estabilidad = original > 0
    ? Math.max(0, 100 - (movimientoPlan / original) * 100)
    : null

  return {
    quincena: q,
    original,
    vigente,
    real,
    ajusteNeto,
    sumaAbsolutaAjustes,
    reasignado,
    movimientoPlan,
    estabilidad,
    lineasCambiadas,
    lineasTotal: gasto.length,
  }
}

function formatDelta(value: number) {
  if (Math.abs(value) < EPS) return formatMXN(0)
  return `${value > 0 ? '+' : '−'}${formatMXN(Math.abs(value))}`
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function cuentaMovimientos(cambios: CambioPresupuesto[]) {
  const ids = new Set<string>()
  for (const c of cambios) {
    if (c.tipo === 'CREACION' || c.tipo === 'MIGRACION_VIGENTE') continue
    ids.add(c.grupoCambioId ? `grupo:${c.grupoCambioId}` : `evento:${c.id}`)
  }
  return ids.size
}

function etiquetaCambio(cambio: CambioPresupuesto) {
  switch (cambio.tipo) {
    case 'AJUSTE_MANUAL': return `Ajuste · ${cambio.presupuesto.descripcion}`
    case 'DESDE_SIN_ASIGNAR': return `Desde sin asignar · ${cambio.presupuesto.descripcion}`
    case 'TRASPASO_ENTRADA': return cambio.relacionado
      ? `${cambio.relacionado.descripcion} → ${cambio.presupuesto.descripcion}`
      : `Traspaso recibido · ${cambio.presupuesto.descripcion}`
    case 'TRASPASO_SALIDA': return cambio.relacionado
      ? `${cambio.presupuesto.descripcion} → ${cambio.relacionado.descripcion}`
      : `Traspaso enviado · ${cambio.presupuesto.descripcion}`
    case 'MIGRACION_VIGENTE': return `Ajuste previo al historial · ${cambio.presupuesto.descripcion}`
    case 'CREACION': return `Plan inicial · ${cambio.presupuesto.descripcion}`
  }
}

function cambiosTimeline(cambios: CambioPresupuesto[]) {
  const visibles: CambioPresupuesto[] = []
  const gruposVistos = new Set<string>()

  for (const c of cambios) {
    if (c.tipo === 'CREACION' || c.tipo === 'MIGRACION_VIGENTE') continue
    if (c.grupoCambioId && (c.tipo === 'TRASPASO_ENTRADA' || c.tipo === 'TRASPASO_SALIDA')) {
      if (gruposVistos.has(c.grupoCambioId)) continue
      gruposVistos.add(c.grupoCambioId)
      // Preferimos la salida para que la etiqueta lea origen → destino.
      const salida = cambios.find(x => x.grupoCambioId === c.grupoCambioId && x.tipo === 'TRASPASO_SALIDA')
      visibles.push(salida ?? c)
      continue
    }
    visibles.push(c)
  }

  return visibles.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion) || a.id - b.id)
}

export function PresupuestoEvolucionPlan({ quincenas, presupuestos, desdeId, hastaId, categoriaId }: Props) {
  const rango = useMemo(() => quincenasEnRango(quincenas, desdeId, hastaId), [quincenas, desdeId, hastaId])
  const categoriaNum = categoriaId ? Number(categoriaId) : null

  const rows = useMemo(() => presupuestos.filter(p => {
    if (p.categoria.tipo !== 'Gasto') return false
    if (categoriaNum != null && p.categoriaId !== categoriaNum) return false
    return rango.some(q => q.id === p.quincenaId)
  }), [presupuestos, rango, categoriaNum])

  const resumenes = useMemo(() => rango
    .map(q => construirResumen(q, rows))
    .filter((r): r is ResumenQ => r != null), [rango, rows])

  const idsParam = useMemo(() => rango.map(q => q.id).join(','), [rango])
  const [cambios, setCambios] = useState<CambioPresupuesto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [seleccionadaId, setSeleccionadaId] = useState<number | null>(null)

  useEffect(() => {
    if (!idsParam) {
      setCambios([])
      return
    }
    let cancelado = false
    setLoading(true)
    setError(false)
    fetch(`/api/presupuesto-analisis/historial?quincenaIds=${encodeURIComponent(idsParam)}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (!cancelado) setCambios(Array.isArray(data?.cambios) ? data.cambios : [])
      })
      .catch(() => {
        if (!cancelado) {
          setCambios([])
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => { cancelado = true }
  }, [idsParam])

  useEffect(() => {
    if (resumenes.length === 0) {
      setSeleccionadaId(null)
      return
    }
    if (seleccionadaId != null && resumenes.some(r => r.quincena.id === seleccionadaId)) return
    const preferida = resumenes.find(r => r.quincena.id.toString() === hastaId) ?? resumenes[resumenes.length - 1]
    setSeleccionadaId(preferida.quincena.id)
  }, [resumenes, hastaId, seleccionadaId])

  if (categoriaNum != null && !presupuestos.some(p => p.categoriaId === categoriaNum && p.categoria.tipo === 'Gasto')) return null
  if (resumenes.length === 0) return null

  const seleccionada = resumenes.find(r => r.quincena.id === seleccionadaId) ?? resumenes[resumenes.length - 1]
  const cambiosQTodos = cambios.filter(c => c.quincenaId === seleccionada.quincena.id)
  const cambiosQ = categoriaNum == null
    ? cambiosQTodos
    : cambiosQTodos.filter(c => c.presupuesto.categoriaId === categoriaNum || c.relacionado?.categoriaId === categoriaNum)
  const timeline = cambiosTimeline(cambiosQ)
  const migrados = cambiosQ.filter(c => c.tipo === 'MIGRACION_VIGENTE')
  const movimientos = cuentaMovimientos(cambiosQ)

  const ajustePct = seleccionada.original > 0 ? (seleccionada.ajusteNeto / seleccionada.original) * 100 : null
  const realVsOriginal = seleccionada.real - seleccionada.original
  const realVsVigente = seleccionada.real - seleccionada.vigente

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <History size={16} className="text-indigo-500" />
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Evolución del plan</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Qué planeaste al inicio, cuánto cambiaste durante la Q y dónde terminó el presupuesto vigente.
          </p>
        </div>
        <span className="text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-full">
          {seleccionada.quincena.codigo}
        </span>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-3">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Plan original</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(seleccionada.original)}</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">punto de partida</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-3">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Plan vigente</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(seleccionada.vigente)}</p>
            <p className={`text-[10px] mt-0.5 font-medium ${seleccionada.ajusteNeto > EPS ? 'text-rose-500 dark:text-rose-400' : seleccionada.ajusteNeto < -EPS ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {formatDelta(seleccionada.ajusteNeto)}{ajustePct != null && Math.abs(seleccionada.ajusteNeto) >= EPS ? ` (${ajustePct > 0 ? '+' : ''}${ajustePct.toFixed(1)}%)` : ''} vs original
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-3">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Real</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(seleccionada.real)}</p>
            <p className={`text-[10px] mt-0.5 font-medium ${realVsVigente > EPS ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatDelta(realVsVigente)} vs vigente
            </p>
          </div>
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 p-3">
            <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">Estabilidad del plan</p>
            <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
              {seleccionada.estabilidad == null ? '—' : `${seleccionada.estabilidad.toFixed(1)}%`}
            </p>
            <p className="text-[10px] text-indigo-500/80 dark:text-indigo-400/80 mt-0.5">
              {seleccionada.lineasCambiadas} de {seleccionada.lineasTotal} líneas terminaron distintas
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Movimiento del plan <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{formatMXN(seleccionada.movimientoPlan)}</strong>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Reasignado entre partidas <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{formatMXN(seleccionada.reasignado)}</strong>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Movimientos registrados <strong className="text-slate-700 dark:text-slate-200">{movimientos}</strong>
            </span>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
            Estabilidad: 100% significa que el Vigente terminó igual al Original. Baja según el monto neto agregado/retirado y lo reasignado entre partidas; un traspaso de $200 cuenta como $200 movidos, no $400.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Comparar quincenas del rango</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {resumenes.map(r => {
              const activo = r.quincena.id === seleccionada.quincena.id
              return (
                <button key={r.quincena.id} onClick={() => setSeleccionadaId(r.quincena.id)}
                  className={`min-w-[132px] text-left rounded-xl border px-3 py-2 transition-colors cursor-pointer ${activo
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${activo ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>{r.quincena.codigo}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{r.estabilidad == null ? '—' : `${r.estabilidad.toFixed(0)}%`}</span>
                  </div>
                  <p className={`text-xs font-semibold tabular-nums mt-1 ${r.ajusteNeto > EPS ? 'text-rose-500 dark:text-rose-400' : r.ajusteNeto < -EPS ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                    {formatDelta(r.ajusteNeto)}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">ajuste neto</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_1.35fr] gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-3">Lectura de Milo</p>
            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {Math.abs(seleccionada.ajusteNeto) < EPS && seleccionada.reasignado < EPS ? (
                <p>El plan vigente terminó igual al original; no fue necesario mover presupuesto entre partidas.</p>
              ) : (
                <p>
                  El presupuesto terminó <strong>{seleccionada.ajusteNeto >= 0 ? 'por arriba' : 'por debajo'}</strong> del plan original por{' '}
                  <strong className="tabular-nums">{formatMXN(Math.abs(seleccionada.ajusteNeto))}</strong>.
                  {seleccionada.reasignado > EPS && <> Además, se reasignaron <strong className="tabular-nums">{formatMXN(seleccionada.reasignado)}</strong> entre partidas.</>}
                </p>
              )}
              <p>
                Frente al Original, el gasto real terminó{' '}
                <strong className={realVsOriginal > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {realVsOriginal > EPS ? 'arriba' : realVsOriginal < -EPS ? 'abajo' : 'igual'}
                </strong>
                {Math.abs(realVsOriginal) >= EPS && <> por <strong className="tabular-nums">{formatMXN(Math.abs(realVsOriginal))}</strong></>}.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Historia de {seleccionada.quincena.codigo}</p>
              {loading && <Loader2 size={13} className="animate-spin text-slate-400" />}
            </div>

            {error ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">No se pudo cargar el historial de cambios.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Plan original</p>
                      <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{formatMXN(seleccionada.original)}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Presupuesto con el que inició la Q.</p>
                  </div>
                </div>

                {migrados.length > 0 && (
                  <div className="ml-1 pl-4 border-l border-amber-200 dark:border-amber-900/50 py-1">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      {migrados.length} {migrados.length === 1 ? 'línea ya tenía' : 'líneas ya tenían'} un Vigente distinto al activar el historial. Se conserva el cambio, pero no se inventa una fecha histórica exacta.
                    </p>
                  </div>
                )}

                {timeline.length === 0 && !loading ? (
                  <div className="ml-1 pl-4 border-l border-slate-200 dark:border-slate-700 py-2">
                    <p className="text-xs text-slate-400 dark:text-slate-500">Sin ajustes nuevos registrados en esta Q.</p>
                  </div>
                ) : (
                  <div className="ml-1 pl-4 border-l border-slate-200 dark:border-slate-700 space-y-3 max-h-72 overflow-y-auto pr-1">
                    {timeline.map(c => {
                      const esTransfer = c.tipo === 'TRASPASO_ENTRADA' || c.tipo === 'TRASPASO_SALIDA'
                      const deltaMostrar = esTransfer ? Math.abs(c.delta) : c.delta
                      return (
                        <div key={c.grupoCambioId ? `grupo-${c.grupoCambioId}` : c.id} className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {esTransfer
                              ? <ArrowRightLeft size={13} className="text-indigo-500" />
                              : c.delta >= 0
                                ? <TrendingUp size={13} className="text-rose-500" />
                                : <TrendingDown size={13} className="text-emerald-600" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{etiquetaCambio(c)}</p>
                              <span className={`text-xs font-semibold tabular-nums shrink-0 ${esTransfer ? 'text-indigo-600 dark:text-indigo-400' : c.delta >= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {esTransfer ? formatMXN(deltaMostrar) : formatDelta(deltaMostrar)}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {formatTimestamp(c.fechaCreacion)}{c.actor ? ` · ${c.actor}` : ''}{c.motivo ? ` · ${c.motivo}` : ''}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-start gap-3 pt-1">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Plan vigente</p>
                      <span className="text-xs font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{formatMXN(seleccionada.vigente)}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      Original <ArrowRight size={9} /> Vigente · {seleccionada.lineasCambiadas} líneas cambiadas
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
