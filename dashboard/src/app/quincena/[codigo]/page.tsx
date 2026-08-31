'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown, CheckCircle2, Clock, Droplets, SearchX, FileText } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { getMexicoDateString, formatQuincenaRange } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { KpiCard } from '@/components/ui/KpiCard'
import { normalizeMontos, calcularEfectivoDisponible } from '@/lib/liquidez'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'
import { resolveReferencia, normalizeReferencia } from '@/lib/referencia'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string; ingresoReferencia: number | null; limiteGastoReferencia: number | null }
interface Presupuesto { montoEfectivo: number; real: number; pendiente: number; categoria: { tipo: string }; estadoLinea: string }
interface Snapshot {
  id: number; bbva: number; banamex: number; uala: number; ualaInversion: number
  efectivo: number; valesDespensa: number; valesGasolina: number; otros: number; otrosNota: string | null
  faltaPagar: number; pagosQuincena: number; teorico: number | null; validado: boolean; fechaCorte: string
}
interface Totales { Gasto: number; Ingreso: number; Ahorro: number; GastoPagado: number; GastoParaLimite: number }

export default function QuincenaResumenPage() {
  const { codigo } = useParams<{ codigo: string }>()

  const [loading, setLoading] = useState(true)
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [target, setTarget] = useState<Quincena | null>(null)
  const [totales, setTotales] = useState<Totales | null>(null)
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [ingresoReferencia, setIngresoReferencia] = useState<number | null>(null)
  const [limiteGastoReferencia, setLimiteGastoReferencia] = useState<number | null>(null)
  const [pagosQuincenaVivo, setPagosQuincenaVivo] = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const rawQuincenas: Quincena[] = await fetch('/api/quincenas').then(r => r.json())
        const data = rawQuincenas.map(normalizeReferencia)
        setQuincenas(data)
        const found = data.find(q => q.codigo.toLowerCase() === codigo.toLowerCase()) ?? null
        setTarget(found)
        if (!found) return

        const [txRes, presupRes, liqRes, cfgRes, pagosRes] = await Promise.all([
          fetch(`/api/transacciones?quincenaId=${found.id}&limit=1`),
          fetch(`/api/presupuestos?quincenaId=${found.id}`),
          fetch(`/api/liquidez?quincenaId=${found.id}`),
          fetch('/api/configuracion'),
          fetch(`/api/liquidez/pagos-quincena?quincenaId=${found.id}`),
        ])
        const txJson = await txRes.json()
        const presupData: Presupuesto[] = await presupRes.json()
        const liqData = await liqRes.json()
        const cfg = await cfgRes.json()
        const pagosJson = await pagosRes.json()

        setTotales(txJson.totales ?? null)
        setPresupuestos(presupData)
        const raw = Array.isArray(liqData) && liqData.length > 0 ? liqData[0] : null
        setSnapshot(raw ? {
          ...raw,
          ...normalizeMontos(raw),
          faltaPagar: Number(raw.faltaPagar) || 0,
          pagosQuincena: Number(raw.pagosQuincena) || 0,
          teorico: raw.teorico != null ? Number(raw.teorico) : null,
        } : null)
        setPagosQuincenaVivo(typeof pagosJson?.pagosQuincena === 'number' ? pagosJson.pagosQuincena : 0)
        setIngresoReferencia(cfg.ingresoReferencia != null ? Number(cfg.ingresoReferencia) : null)
        setLimiteGastoReferencia(cfg.limiteGastoReferencia != null ? Number(cfg.limiteGastoReferencia) : null)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [codigo])

  if (loading) {
    return (
      <div className="py-24 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Cargando...
      </div>
    )
  }

  if (!target) {
    return (
      <div className="text-center py-24 text-slate-400 dark:text-slate-500">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <SearchX size={28} className="text-slate-400" />
        </div>
        <p className="font-medium text-slate-600 dark:text-slate-400">Quincena &quot;{codigo}&quot; no encontrada</p>
        <p className="text-sm mt-1">Revisa el código del link.</p>
        <Link href="/" className="inline-flex items-center gap-1.5 mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          <ArrowLeft size={14} /> Volver al inicio
        </Link>
      </div>
    )
  }

  const gastoPagado = totales?.GastoPagado ?? 0
  const gastoTotal = totales?.Gasto ?? 0
  const pendientePorPagar = calcularFaltaPorPagar(presupuestos)
  const gastoParaLimite = totales?.GastoParaLimite ?? 0
  // Override propio de esta quincena (configurable en Presupuesto → Análisis)
  // si existe, si no el global de Configuración → Períodos de pago.
  const refTarget = resolveReferencia(target, { ingresoReferencia, limiteGastoReferencia })
  const pctLimite = refTarget.limiteGastoReferencia != null && refTarget.limiteGastoReferencia > 0 ? (gastoParaLimite / refTarget.limiteGastoReferencia) * 100 : null
  const efectivo = calcularEfectivoDisponible(snapshot, presupuestos)
  // "Neta" usa pagosQuincenaVivo (cash real de esta quincena), no
  // efectivo.faltaPagar (ejecucion de presupuesto) -- ver lib/pagos-quincena.ts.
  const liquidezNeta = efectivo.totalLiquido - pagosQuincenaVivo

  const cuentaTiles: { label: string; value: number; title?: string }[] = snapshot ? [
    { label: 'BBVA', value: snapshot.bbva },
    { label: 'Banamex', value: snapshot.banamex },
    { label: 'Ualá', value: snapshot.uala },
    { label: 'Efectivo', value: snapshot.efectivo },
    ...(snapshot.otros > 0 ? [{ label: 'Otros', value: snapshot.otros, title: snapshot.otrosNota ?? undefined }] : []),
  ] : []

  return (
    <div className="space-y-6">
      <Link href="/presupuesto" className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
        <ArrowLeft size={14} /> Volver a Presupuesto
      </Link>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{target.codigo}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{formatQuincenaRange(target)}</p>
          <div className="mt-3">
            <QuincenaStatus quincenas={quincenas} selectedId={target.id.toString()} today={getMexicoDateString()} />
          </div>
        </div>
        <Link
          href={`/quincena/${target.codigo}/reporte`}
          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg transition-colors"
        >
          <FileText size={14} /> Reporte
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Ingresos" value={formatMXN(totales?.Ingreso ?? 0)}
          subtitle={refTarget.ingresoReferencia != null ? `meta ${formatMXN(refTarget.ingresoReferencia)}` : undefined}
          icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
          color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50"
        />
        <KpiCard
          label="Gastos" value={formatMXN(gastoTotal)}
          subtitle={refTarget.limiteGastoReferencia != null ? `límite ${formatMXN(refTarget.limiteGastoReferencia)}` : undefined}
          icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />}
          color="text-rose-600 dark:text-rose-400" bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50"
          subtitleColor={pctLimite != null && pctLimite > 90 ? 'text-rose-500 dark:text-rose-400' : pctLimite != null && pctLimite > 70 ? 'text-amber-500 dark:text-amber-400' : undefined}
        />
        <KpiCard
          label="Pagado" value={formatMXN(gastoPagado)}
          icon={<CheckCircle2 size={20} className="text-blue-600 dark:text-blue-300" />}
          color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
        />
        <KpiCard
          label="Pendiente" value={formatMXN(pendientePorPagar)}
          icon={<Clock size={20} className="text-amber-600 dark:text-amber-300" />}
          color="text-amber-600 dark:text-amber-400" bg="bg-amber-50 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50"
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Droplets size={16} className="text-blue-500" /> Liquidez
          </h3>
          <Link href={`/configuracion/liquidez?quincenaId=${target.id}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            {snapshot ? 'Editar corte' : 'Capturar corte'}
          </Link>
        </div>

        {snapshot ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Corte del {formatDate(snapshot.fechaCorte)}
                {snapshot.validado && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">· Validado</span>}
              </p>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(efectivo.totalLiquido)}</p>
                {pagosQuincenaVivo > 0 && (
                  <p className={`text-xs tabular-nums font-medium ${liquidezNeta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    neta {formatMXN(liquidezNeta)} <span className="font-normal">(-{formatMXN(pagosQuincenaVivo)} por pagar esta Q)</span>
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {cuentaTiles.map(c => (
                <div key={c.label} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 text-center" title={c.title}>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(c.value)}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
            Sin corte de liquidez capturado para esta quincena.
          </div>
        )}
      </div>
    </div>
  )
}
