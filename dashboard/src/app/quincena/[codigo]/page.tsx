'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown, CheckCircle2, Clock, Droplets, SearchX } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { getMexicoDateString, formatQuincenaRange } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { KpiCard } from '@/components/ui/KpiCard'
import { sumLiquidez, normalizeMontos } from '@/lib/liquidez'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Snapshot {
  id: number; bbva: number; banamex: number; uala: number; ualaInversion: number
  efectivo: number; valesDespensa: number; valesGasolina: number; otros: number; otrosNota: string | null
  faltaPagar: number; teorico: number | null; validado: boolean; fechaCorte: string
}
interface Totales { Gasto: number; Ingreso: number; Ahorro: number; GastoPagado: number; GastoParaLimite: number }

export default function QuincenaResumenPage() {
  const { codigo } = useParams<{ codigo: string }>()

  const [loading, setLoading] = useState(true)
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [target, setTarget] = useState<Quincena | null>(null)
  const [totales, setTotales] = useState<Totales | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [ingresoReferencia, setIngresoReferencia] = useState<number | null>(null)
  const [limiteGastoReferencia, setLimiteGastoReferencia] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const data: Quincena[] = await fetch('/api/quincenas').then(r => r.json())
        setQuincenas(data)
        const found = data.find(q => q.codigo.toLowerCase() === codigo.toLowerCase()) ?? null
        setTarget(found)
        if (!found) return

        const [txRes, liqRes, cfgRes] = await Promise.all([
          fetch(`/api/transacciones?quincenaId=${found.id}&limit=1`),
          fetch(`/api/liquidez?quincenaId=${found.id}`),
          fetch('/api/configuracion'),
        ])
        const txJson = await txRes.json()
        const liqData = await liqRes.json()
        const cfg = await cfgRes.json()

        setTotales(txJson.totales ?? null)
        const raw = Array.isArray(liqData) && liqData.length > 0 ? liqData[0] : null
        setSnapshot(raw ? {
          ...raw,
          ...normalizeMontos(raw),
          faltaPagar: Number(raw.faltaPagar) || 0,
          teorico: raw.teorico != null ? Number(raw.teorico) : null,
        } : null)
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
  const pendientePorPagar = gastoTotal - gastoPagado
  const gastoParaLimite = totales?.GastoParaLimite ?? 0
  const pctLimite = limiteGastoReferencia != null && limiteGastoReferencia > 0 ? (gastoParaLimite / limiteGastoReferencia) * 100 : null
  const totalLiquidez = snapshot ? sumLiquidez(snapshot) : 0
  const liquidezNeta = snapshot ? totalLiquidez - snapshot.faltaPagar : 0

  const cuentaTiles: { label: string; value: number; title?: string }[] = snapshot ? [
    { label: 'BBVA', value: snapshot.bbva },
    { label: 'Banamex', value: snapshot.banamex },
    { label: 'Ualá', value: snapshot.uala },
    { label: 'Efectivo', value: snapshot.efectivo },
    ...(snapshot.otros > 0 ? [{ label: 'Otros', value: snapshot.otros, title: snapshot.otrosNota ?? undefined }] : []),
  ] : []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{target.codigo}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{formatQuincenaRange(target)}</p>
        <div className="mt-3">
          <QuincenaStatus quincenas={quincenas} selectedId={target.id.toString()} today={getMexicoDateString()} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Ingresos" value={formatMXN(totales?.Ingreso ?? 0)}
          subtitle={ingresoReferencia != null ? `meta ${formatMXN(ingresoReferencia)}` : undefined}
          icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
          color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50"
        />
        <KpiCard
          label="Gastos" value={formatMXN(gastoTotal)}
          subtitle={limiteGastoReferencia != null ? `límite ${formatMXN(limiteGastoReferencia)}` : undefined}
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
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(totalLiquidez)}</p>
                {snapshot.faltaPagar > 0 && (
                  <p className={`text-xs tabular-nums font-medium ${liquidezNeta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    neta {formatMXN(liquidezNeta)} <span className="font-normal">(-{formatMXN(snapshot.faltaPagar)} por pagar)</span>
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
