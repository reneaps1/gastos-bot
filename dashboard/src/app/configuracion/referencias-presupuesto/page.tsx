'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { formatMXN } from '@/lib/utils'
import { formatQuincenaRange, getDefaultQuincenaId } from '@/lib/quincena-selection'
import { normalizeReferencia, type ReferenciaValores } from '@/lib/referencia'

interface Quincena extends ReferenciaValores {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

function fieldClass() {
  return 'w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 border-slate-200 dark:border-slate-700'
}

export default function ReferenciasPresupuestoPage() {
  const { toast } = useToast()
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [global, setGlobal] = useState<ReferenciaValores>({ ingresoReferencia: null, limiteGastoReferencia: null })
  const [quincenaId, setQuincenaId] = useState('')
  const [ingreso, setIngreso] = useState('')
  const [limite, setLimite] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, cRes] = await Promise.all([fetch('/api/quincenas'), fetch('/api/configuracion')])
      if (!qRes.ok || !cRes.ok) throw new Error()
      const [qData, cData] = await Promise.all([qRes.json(), cRes.json()])
      const qs = (Array.isArray(qData) ? qData : []).map((q: Quincena) => normalizeReferencia(q))
      setQuincenas(qs)
      const cfg = normalizeReferencia(cData ?? {})
      setGlobal({ ingresoReferencia: cfg.ingresoReferencia, limiteGastoReferencia: cfg.limiteGastoReferencia })
      setQuincenaId(prev => prev && qs.some((q: Quincena) => q.id.toString() === prev) ? prev : getDefaultQuincenaId(qs))
    } catch {
      toast('No se pudieron cargar las referencias', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const seleccionada = useMemo(() => quincenas.find(q => q.id.toString() === quincenaId) ?? null, [quincenas, quincenaId])

  useEffect(() => {
    setIngreso(seleccionada?.ingresoReferencia != null ? String(seleccionada.ingresoReferencia) : '')
    setLimite(seleccionada?.limiteGastoReferencia != null ? String(seleccionada.limiteGastoReferencia) : '')
  }, [seleccionada])

  async function guardar(limpiar = false) {
    if (!seleccionada) return
    const ingresoValue = limpiar || ingreso.trim() === '' ? null : Number(ingreso)
    const limiteValue = limpiar || limite.trim() === '' ? null : Number(limite)
    if ((!limpiar && ingreso.trim() !== '' && (!Number.isFinite(ingresoValue) || Number(ingresoValue) < 0)) ||
        (!limpiar && limite.trim() !== '' && (!Number.isFinite(limiteValue) || Number(limiteValue) < 0))) {
      toast('Los montos deben ser números mayores o iguales a 0', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/quincenas/${seleccionada.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingresoReferencia: ingresoValue, limiteGastoReferencia: limiteValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      const updated = normalizeReferencia(data)
      setQuincenas(prev => prev.map(q => q.id === updated.id ? { ...q, ...updated } : q))
      toast(limpiar ? `${seleccionada.codigo} usará la referencia global` : `Referencia de ${seleccionada.codigo} actualizada`)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/configuracion/quincenas" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 mb-2"><ArrowLeft size={13} /> Períodos de pago</Link>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><SlidersHorizontal size={22} className="text-indigo-500" /> Referencias por período</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configura excepciones de ingreso o límite para una Q concreta. Esto es configuración; no cambia tus movimientos ni tu presupuesto.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Ingreso global</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">{global.ingresoReferencia == null ? 'Sin definir' : formatMXN(global.ingresoReferencia)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Límite global de gasto</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">{global.limiteGastoReferencia == null ? 'Sin definir' : formatMXN(global.limiteGastoReferencia)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4">
        <div>
          <label htmlFor="ref-q" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Período</label>
          <select id="ref-q" value={quincenaId} onChange={e => setQuincenaId(e.target.value)} disabled={loading} className={fieldClass()}>
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo} · {formatQuincenaRange(q)}</option>)}
          </select>
        </div>

        {seleccionada && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Ingreso de referencia para {seleccionada.codigo}
              <input type="number" min="0" step="0.01" value={ingreso} onChange={e => setIngreso(e.target.value)}
                placeholder={global.ingresoReferencia == null ? 'Usar global' : `Global: ${global.ingresoReferencia}`}
                className={`${fieldClass()} mt-1`} />
              <span className="block mt-1 text-[10px] text-slate-400 dark:text-slate-500">Vacío = usa el valor global.</span>
            </label>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Límite de gasto para {seleccionada.codigo}
              <input type="number" min="0" step="0.01" value={limite} onChange={e => setLimite(e.target.value)}
                placeholder={global.limiteGastoReferencia == null ? 'Usar global' : `Global: ${global.limiteGastoReferencia}`}
                className={`${fieldClass()} mt-1`} />
              <span className="block mt-1 text-[10px] text-slate-400 dark:text-slate-500">Vacío = usa el valor global.</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={() => guardar(true)} disabled={saving || !seleccionada}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
            <RotateCcw size={13} /> Usar global
          </button>
          <button type="button" onClick={() => guardar(false)} disabled={saving || !seleccionada}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium">
            {saving ? 'Guardando…' : 'Guardar referencia'}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">Los valores globales se administran en Configuración → Períodos de pago. Aquí solo defines excepciones por Q.</p>
    </div>
  )
}
