'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, History, SlidersHorizontal } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { formatQuincenaRange } from '@/lib/quincena-selection'
import { PresupuestoAnalisis as PresupuestoAnalisisCore } from './PresupuestoAnalisisCore'
import { PresupuestoEvolucionPlan } from './PresupuestoEvolucionPlan'
import { PresupuestoGraficaOVR } from './PresupuestoGraficaOVR'
import { usePresupuestoWorkspaceData } from './usePresupuestoWorkspaceData'

export function PresupuestoHistorial() {
  const { toast } = useToast()
  const { today, quincenas, categorias, presupuestos, config, loading, error, updateQuincena } = usePresupuestoWorkspaceData()
  const [modo, setModo] = useState<'una' | 'rango'>('una')
  const [unaQId, setUnaQId] = useState('')
  const [desdeId, setDesdeId] = useState('')
  const [hastaId, setHastaId] = useState('')
  const [categoriaId, setCategoriaId] = useState('')

  const periodos = useMemo(() => [...quincenas]
    .filter(q => q.fechaInicio <= today)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio)), [quincenas, today])

  useEffect(() => {
    if (periodos.length === 0) return
    const cerradas = periodos.filter(q => q.fechaFin < today)
    const ultima = cerradas.at(-1) ?? periodos.at(-1)!
    if (!unaQId || !periodos.some(q => q.id.toString() === unaQId)) setUnaQId(ultima.id.toString())

    if (!desdeId || !hastaId) {
      const finIdx = periodos.findIndex(q => q.id === ultima.id)
      const inicioIdx = Math.max(0, finIdx - 4)
      setDesdeId(periodos[inicioIdx].id.toString())
      setHastaId(periodos[finIdx].id.toString())
    }
  }, [periodos, today, unaQId, desdeId, hastaId])

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center text-sm text-slate-400">Cargando historial…</div>
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-5 text-sm text-rose-700 dark:text-rose-300">No se pudo cargar el historial de Presupuesto.</div>
  }

  if (periodos.length === 0) return null

  const efectivoDesde = modo === 'una' ? unaQId : desdeId
  const efectivoHasta = modo === 'una' ? unaQId : hastaId
  if (!efectivoDesde || !efectivoHasta) return null

  const unaIdx = periodos.findIndex(q => q.id.toString() === unaQId)
  const unaQ = periodos[unaIdx] ?? null
  const qDesde = periodos.find(q => q.id.toString() === efectivoDesde)
  const qHasta = periodos.find(q => q.id.toString() === efectivoHasta)
  const tituloRango = modo === 'una'
    ? unaQ?.codigo ?? 'Una Q'
    : qDesde && qHasta ? `${qDesde.codigo}–${qHasta.codigo}` : 'Rango'

  function moverQ(delta: number) {
    const next = periodos[unaIdx + delta]
    if (next) setUnaQId(next.id.toString())
  }

  function abrirEdicion() {
    toast('Para editar una partida, ve a Ahora → Tabla')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><History size={22} className="text-indigo-500" /> Historial</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Qué planeaste, cómo cambió el presupuesto y qué terminó ocurriendo.</p>
        </div>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">{tituloRango}</span>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
            <button type="button" onClick={() => setModo('una')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${modo === 'una' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
              Una Q
            </button>
            <button type="button" onClick={() => setModo('rango')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${modo === 'rango' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
              Rango
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400"><SlidersHorizontal size={13} /> Todo lo de abajo usa esta selección</div>
        </div>

        {modo === 'una' ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => moverQ(-1)} disabled={unaIdx <= 0}
              aria-label="Quincena anterior"
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 disabled:opacity-30 cursor-pointer">
              <ChevronLeft size={18} />
            </button>
            <select value={unaQId} onChange={e => setUnaQId(e.target.value)}
              aria-label="Quincena a analizar"
              className="min-w-0 flex-1 border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {periodos.map(q => <option key={q.id} value={q.id}>{q.codigo} · {formatQuincenaRange(q)}{q.fechaFin >= today ? ' · en curso' : ''}</option>)}
            </select>
            <button type="button" onClick={() => moverQ(1)} disabled={unaIdx < 0 || unaIdx >= periodos.length - 1}
              aria-label="Quincena siguiente"
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 disabled:opacity-30 cursor-pointer">
              <ChevronRight size={18} />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Desde
              <select value={desdeId} onChange={e => setDesdeId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {periodos.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Hasta
              <select value={hastaId} onChange={e => setHastaId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {periodos.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Categoría
          <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)}
            className="mt-1 w-full sm:max-w-xs border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">Todos los gastos</option>
            {categorias.filter(c => c.tipo === 'Gasto').map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>

      <PresupuestoEvolucionPlan quincenas={quincenas} presupuestos={presupuestos} desdeId={efectivoDesde} hastaId={efectivoHasta} categoriaId={categoriaId} />
      <PresupuestoGraficaOVR quincenas={quincenas} presupuestos={presupuestos} desdeId={efectivoDesde} hastaId={efectivoHasta} categoriaId={categoriaId} />

      <div id="presupuesto-historial-core">
        <PresupuestoAnalisisCore
          quincenas={quincenas}
          categorias={categorias}
          today={today}
          presupuestos={presupuestos}
          loading={false}
          configGlobal={config}
          desdeId={efectivoDesde}
          setDesdeId={modo === 'una' ? setUnaQId : setDesdeId}
          hastaId={efectivoHasta}
          setHastaId={modo === 'una' ? setUnaQId : setHastaId}
          categoriaId={categoriaId}
          setCategoriaId={setCategoriaId}
          onQuincenaUpdated={updateQuincena}
          openEdit={abrirEdicion}
        />
        <style>{`
          /* La selección vive arriba de Historial; evita duplicar el slider interno. */
          #presupuesto-historial-core > div > div:nth-child(2) { display: none; }
          /* Referencias son configuración, no análisis. Se movieron fuera de esta vista. */
          #presupuesto-historial-core > div > div:last-child { display: none; }
        `}</style>
      </div>
    </div>
  )
}
