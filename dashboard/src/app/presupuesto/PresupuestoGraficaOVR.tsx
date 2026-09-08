'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Dot,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
} from 'recharts'
import { History } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import type { Presupuesto } from './page'

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

interface GastoSinPresupuesto {
  quincenaId: number
  categoriaId: number
  monto: number
}

type TipoCambioPresupuesto =
  | 'CREACION'
  | 'AJUSTE_MANUAL'
  | 'DESDE_SIN_ASIGNAR'
  | 'TRASPASO_ENTRADA'
  | 'TRASPASO_SALIDA'
  | 'MIGRACION_VIGENTE'

interface CambioPresupuesto {
  id: number
  quincenaId: number
  tipo: TipoCambioPresupuesto
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

interface Props {
  quincenas: Quincena[]
  presupuestos: Presupuesto[]
  desdeId: string
  hastaId: string
  categoriaId: string
}

const EPS = 0.005
const COLOR_ORIGINAL = '#f43f5e'
const COLOR_VIGENTE = '#fb7185'
const COLOR_REAL = '#be123c'
const COLOR_CAMBIO = '#f59e0b'

function quincenasEnRango(quincenas: Quincena[], desdeId: string, hastaId: string) {
  const ordenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const iDesde = ordenadas.findIndex(q => q.id.toString() === desdeId)
  const iHasta = ordenadas.findIndex(q => q.id.toString() === hastaId)
  if (iDesde === -1 || iHasta === -1) return ordenadas
  const [lo, hi] = iDesde <= iHasta ? [iDesde, iHasta] : [iHasta, iDesde]
  return ordenadas.slice(lo, hi + 1)
}

function vigenteHistorico(p: Presupuesto) {
  // Original conserva lo que se planeó. Una línea retirada/cancelada ya no
  // forma parte del Vigente, aunque su monto original siga siendo auditable.
  if (p.estadoLinea === 'Cancelada') return 0
  return Number(p.montoEfectivo)
}

function formatSignedMXN(value: number) {
  if (Math.abs(value) < EPS) return formatMXN(0)
  return `${value > 0 ? '+' : '−'}${formatMXN(Math.abs(value))}`
}

function cambiosTimeline(cambios: CambioPresupuesto[]) {
  const visibles: CambioPresupuesto[] = []
  const gruposVistos = new Set<string>()

  for (const cambio of cambios) {
    if (cambio.tipo === 'CREACION') continue

    if (
      cambio.grupoCambioId &&
      (cambio.tipo === 'TRASPASO_ENTRADA' || cambio.tipo === 'TRASPASO_SALIDA')
    ) {
      if (gruposVistos.has(cambio.grupoCambioId)) continue
      gruposVistos.add(cambio.grupoCambioId)
      const salida = cambios.find(c =>
        c.grupoCambioId === cambio.grupoCambioId && c.tipo === 'TRASPASO_SALIDA'
      )
      visibles.push(salida ?? cambio)
      continue
    }

    visibles.push(cambio)
  }

  return visibles.sort((a, b) =>
    a.fechaCreacion.localeCompare(b.fechaCreacion) || a.id - b.id
  )
}

function contarMovimientos(cambios: CambioPresupuesto[]) {
  const movimientos = new Set<string>()
  for (const cambio of cambios) {
    if (cambio.tipo === 'CREACION' || cambio.tipo === 'MIGRACION_VIGENTE') continue
    movimientos.add(cambio.grupoCambioId ? `grupo:${cambio.grupoCambioId}` : `evento:${cambio.id}`)
  }
  return movimientos.size
}

function etiquetaCambio(cambio: CambioPresupuesto) {
  switch (cambio.tipo) {
    case 'AJUSTE_MANUAL':
      return `Ajuste · ${cambio.presupuesto.descripcion}`
    case 'DESDE_SIN_ASIGNAR':
      return `Desde sin asignar · ${cambio.presupuesto.descripcion}`
    case 'TRASPASO_ENTRADA':
      return cambio.relacionado
        ? `${cambio.relacionado.descripcion} → ${cambio.presupuesto.descripcion}`
        : `Traspaso recibido · ${cambio.presupuesto.descripcion}`
    case 'TRASPASO_SALIDA':
      return cambio.relacionado
        ? `${cambio.presupuesto.descripcion} → ${cambio.relacionado.descripcion}`
        : `Traspaso enviado · ${cambio.presupuesto.descripcion}`
    case 'MIGRACION_VIGENTE':
      return `Ajuste previo al historial · ${cambio.presupuesto.descripcion}`
    case 'CREACION':
      return `Plan inicial · ${cambio.presupuesto.descripcion}`
  }
}

function montoCambio(cambio: CambioPresupuesto) {
  if (cambio.tipo === 'TRASPASO_ENTRADA' || cambio.tipo === 'TRASPASO_SALIDA') {
    return formatMXN(Math.abs(cambio.delta))
  }
  return formatSignedMXN(cambio.delta)
}

export function PresupuestoGraficaOVR({ quincenas, presupuestos, desdeId, hastaId, categoriaId }: Props) {
  const rango = useMemo(
    () => quincenasEnRango(quincenas, desdeId, hastaId),
    [quincenas, desdeId, hastaId],
  )
  const idsRango = useMemo(() => new Set(rango.map(q => q.id)), [rango])
  const idsParam = useMemo(() => rango.map(q => q.id).join(','), [rango])
  const categoriaNum = categoriaId ? Number(categoriaId) : null

  const rows = useMemo(() => presupuestos.filter(p => {
    if (p.categoria.tipo !== 'Gasto') return false
    if (!idsRango.has(p.quincenaId)) return false
    if (categoriaNum != null && p.categoriaId !== categoriaNum) return false
    return true
  }), [presupuestos, idsRango, categoriaNum])

  // Dispara una recarga del historial si el usuario ajusta/cancela una línea
  // sin cambiar el rango. No incluye `real`: registrar una transacción cambia
  // la línea Real, pero no la bitácora del presupuesto.
  const firmaPlan = useMemo(() => rows
    .map(p => `${p.id}:${p.montoEfectivo}:${p.estadoLinea}`)
    .sort()
    .join('|'), [rows])

  const [cambios, setCambios] = useState<CambioPresupuesto[]>([])
  const [gastosSinPresupuesto, setGastosSinPresupuesto] = useState<GastoSinPresupuesto[]>([])
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialError, setHistorialError] = useState(false)

  useEffect(() => {
    if (!idsParam) {
      setCambios([])
      setGastosSinPresupuesto([])
      return
    }

    let cancelado = false
    setHistorialLoading(true)
    setHistorialError(false)

    const historialRequest = fetch(`/api/presupuesto-analisis/historial?quincenaIds=${encodeURIComponent(idsParam)}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => Array.isArray(data?.cambios) ? data.cambios as CambioPresupuesto[] : [])

    const fueraPlanRequest = fetch('/api/presupuesto-analisis')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => Array.isArray(data?.gastosSinPresupuesto)
        ? data.gastosSinPresupuesto as GastoSinPresupuesto[]
        : [])

    Promise.all([historialRequest, fueraPlanRequest])
      .then(([historial, fueraPlan]) => {
        if (cancelado) return
        setCambios(historial)
        setGastosSinPresupuesto(fueraPlan)
      })
      .catch(() => {
        if (cancelado) return
        setCambios([])
        setGastosSinPresupuesto([])
        setHistorialError(true)
      })
      .finally(() => {
        if (!cancelado) setHistorialLoading(false)
      })

    return () => { cancelado = true }
  }, [idsParam, firmaPlan])

  const esCategoriaGasto = categoriaNum == null || presupuestos.some(p =>
    p.categoriaId === categoriaNum && p.categoria.tipo === 'Gasto'
  )

  const chartData = useMemo(() => rango.map(q => {
    const qRows = rows.filter(p => p.quincenaId === q.id)
    const fueraPlan = gastosSinPresupuesto
      .filter(g =>
        g.quincenaId === q.id &&
        (categoriaNum == null || g.categoriaId === categoriaNum)
      )
      .reduce((sum, g) => sum + Number(g.monto || 0), 0)

    if (qRows.length === 0 && fueraPlan <= 0) return null

    let original = 0
    let vigente = 0
    let realAsignado = 0
    let sumaAbsolutaAjustes = 0

    for (const p of qRows) {
      const o = Number(p.montoPresupuestado)
      const v = vigenteHistorico(p)
      original += o
      vigente += v
      realAsignado += Number(p.real)
      sumaAbsolutaAjustes += Math.abs(v - o)
    }

    const real = realAsignado + fueraPlan
    const ajusteNeto = vigente - original
    const reasignado = Math.max(0, (sumaAbsolutaAjustes - Math.abs(ajusteNeto)) / 2)
    const cambiosQ = cambios.filter(c =>
      c.quincenaId === q.id &&
      (categoriaNum == null || c.presupuesto.categoriaId === categoriaNum)
    )
    const eventos = cambiosTimeline(cambiosQ)
    const movimientos = contarMovimientos(cambiosQ)
    const tieneMigracion = cambiosQ.some(c => c.tipo === 'MIGRACION_VIGENTE')
    const tieneCambios = movimientos > 0 || tieneMigracion || Math.abs(ajusteNeto) >= EPS

    return {
      quincenaId: q.id,
      codigo: q.codigo,
      original,
      vigente,
      real,
      fueraPlan,
      ajusteNeto,
      reasignado,
      movimientos,
      tieneMigracion,
      tieneCambios,
      desviacionVigente: real - vigente,
      eventos,
    }
  }).filter((row): row is NonNullable<typeof row> => row != null), [
    rango,
    rows,
    gastosSinPresupuesto,
    categoriaNum,
    cambios,
  ])

  if (!esCategoriaGasto || chartData.length === 0) return null

  const cambiosPlan = chartData.filter(q => q.tieneCambios)

  const renderVigenteDot = (dotProps: DotItemDotProps) => {
    const { cx, cy, payload } = dotProps
    if (
      typeof cx !== 'number' ||
      typeof cy !== 'number' ||
      !payload?.tieneCambios
    ) return null

    return (
      <Dot
        cx={cx}
        cy={cy}
        r={5}
        fill={COLOR_VIGENTE}
        stroke={COLOR_CAMBIO}
        strokeWidth={2}
      />
    )
  }

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2">
            <History size={15} className="text-indigo-500" />
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Original → Vigente → Real</h3>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-3xl">
            La línea Vigente marca con borde ámbar las Q donde cambió el presupuesto. También detecta reasignaciones cuyo efecto neto es $0.
          </p>
        </div>
        {historialLoading && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Actualizando historial…</span>
        )}
      </div>

      {historialError && (
        <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          No se pudo cargar la bitácora de cambios. La gráfica sigue mostrando Original, Vigente y Real, pero los marcadores históricos pueden estar incompletos.
        </div>
      )}

      {cambiosPlan.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 px-3 py-2">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">Q con cambios</span>
          {cambiosPlan.map(q => (
            <span
              key={q.quincenaId}
              title={`Original ${formatMXN(q.original)} · Vigente ${formatMXN(q.vigente)} · Real ${formatMXN(q.real)} · Reasignado ${formatMXN(q.reasignado)}`}
              className="text-[11px] font-medium px-2 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            >
              {q.codigo}
              {q.movimientos > 0 && <span className="text-slate-400 dark:text-slate-500"> · {q.movimientos} mov.</span>}
              <span className={Math.abs(q.ajusteNeto) < EPS
                ? 'text-indigo-600 dark:text-indigo-400'
                : q.ajusteNeto > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-sky-600 dark:text-sky-400'}>
                {' · '}{Math.abs(q.ajusteNeto) < EPS ? 'neto $0' : formatSignedMXN(q.ajusteNeto)}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5" style={{ backgroundColor: COLOR_ORIGINAL }} />Original</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 border-t-2 border-dashed" style={{ borderColor: COLOR_VIGENTE }} />Vigente</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5" style={{ backgroundColor: COLOR_REAL }} />Real total</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: COLOR_CAMBIO, backgroundColor: COLOR_VIGENTE }} />Plan modificado</span>
      </div>

      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="codigo" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`}
            tick={{ fontSize: 11, fill: '#64748b' }}
            width={44}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const row = payload[0]?.payload as (typeof chartData)[number] | undefined
            if (!row) return null
            const eventos = row.eventos.slice(0, 4)
            return (
              <div className="min-w-[270px] max-w-[340px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 text-xs">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{String(label ?? row.codigo)}</span>
                  {row.tieneCambios && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">plan modificado</span>
                  )}
                </div>

                <div className="space-y-1 text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between gap-5"><span>Plan original</span><span className="tabular-nums">{formatMXN(row.original)}</span></div>
                  <div className={`flex justify-between gap-5 ${Math.abs(row.ajusteNeto) >= EPS ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    <span>Ajuste neto</span><span className="tabular-nums">{formatSignedMXN(row.ajusteNeto)}</span>
                  </div>
                  <div className="flex justify-between gap-5"><span>Plan vigente</span><span className="tabular-nums">{formatMXN(row.vigente)}</span></div>
                  {row.reasignado > EPS && (
                    <div className="flex justify-between gap-5 text-indigo-600 dark:text-indigo-400"><span>Reasignado</span><span className="tabular-nums">{formatMXN(row.reasignado)}</span></div>
                  )}
                  <div className="flex justify-between gap-5 font-semibold text-slate-800 dark:text-slate-100"><span>Gasto real</span><span className="tabular-nums">{formatMXN(row.real)}</span></div>
                  <div className={`flex justify-between gap-5 ${row.desviacionVigente > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    <span>Real vs vigente</span><span className="tabular-nums">{formatSignedMXN(row.desviacionVigente)}</span>
                  </div>
                  {row.fueraPlan > EPS && (
                    <div className="flex justify-between gap-5 text-amber-600 dark:text-amber-400"><span>Fuera de plan</span><span className="tabular-nums">{formatMXN(row.fueraPlan)}</span></div>
                  )}
                  {row.movimientos > 0 && (
                    <div className="flex justify-between gap-5"><span>Movimientos del plan</span><span className="tabular-nums">{row.movimientos}</span></div>
                  )}
                </div>

                {eventos.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Cambios registrados</p>
                    <div className="space-y-1.5">
                      {eventos.map(evento => (
                        <div key={evento.id} className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-slate-600 dark:text-slate-300 truncate">{etiquetaCambio(evento)}</p>
                            {evento.motivo && evento.tipo !== 'MIGRACION_VIGENTE' && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{evento.motivo}</p>
                            )}
                          </div>
                          <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200 shrink-0">{montoCambio(evento)}</span>
                        </div>
                      ))}
                      {row.eventos.length > eventos.length && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">+{row.eventos.length - eventos.length} cambios más</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          }} />

          <Line
            type="monotone"
            dataKey="original"
            name="Plan original"
            stroke={COLOR_ORIGINAL}
            strokeWidth={2}
            dot={{ r: 3, fill: COLOR_ORIGINAL }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="vigente"
            name="Plan vigente"
            stroke={COLOR_VIGENTE}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={renderVigenteDot}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="real"
            name="Gasto real total"
            stroke={COLOR_REAL}
            strokeWidth={2.5}
            dot={{ r: 3, fill: COLOR_REAL }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  )
}
