'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, ArrowRight } from 'lucide-react'

import { getInitialQuincenaId } from '@/lib/quincena-selection'
import { formatMXN } from '@/lib/utils'

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

interface ReconciliacionResumen {
  quincena: { id: number; codigo: string }
  plan: { margenPlan: number }
  caja: null | {
    saldoProyectadoCierre: number
    diferenciaVsPlan: number | null
    cuadraConPlan: boolean | null
  }
}

export function ReconciliationBanner() {
  const pathname = usePathname()
  const [data, setData] = useState<ReconciliacionResumen | null>(null)

  useEffect(() => {
    if (pathname !== '/') return
    let cancelled = false

    async function load() {
      try {
        const qRes = await fetch('/api/quincenas')
        const quincenas: Quincena[] = await qRes.json()
        const quincenaId = getInitialQuincenaId(quincenas)
        if (!quincenaId) return
        const res = await fetch(`/api/liquidez/reconciliacion-plan-caja?quincenaId=${quincenaId}`)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [pathname])

  if (pathname !== '/' || !data?.caja || data.caja.diferenciaVsPlan == null) return null

  const diferencia = data.caja.diferenciaVsPlan
  if (Math.abs(diferencia) < 1) return null

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Plan y caja no cuadran por {formatMXN(Math.abs(diferencia))}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80 dark:text-amber-300/80">
            La caja proyectada al cierre es {formatMXN(data.caja.saldoProyectadoCierre)}. El margen del plan de {formatMXN(data.plan.margenPlan)} no es dinero adicional: hay una diferencia que Milo puede desglosar y corregir.
          </p>
        </div>
      </div>
      <Link
        href={`/configuracion/liquidez/reconciliar?quincenaId=${data.quincena.id}`}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
      >
        Revisar diferencia <ArrowRight size={13} />
      </Link>
    </div>
  )
}
