'use client'
import { useEffect, useRef } from 'react'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }

export const ALL_QUINCENAS = 'all'

interface Props {
  quincenas: Quincena[]
  quincenaId: string
  today: string
  onSelect: (id: string) => void
  /** Show a leading "Todas" chip that searches across every quincena at once. */
  showAll?: boolean
  /** Ids adicionales combinados con `quincenaId` (Ctrl/Cmd+clic). Solo se
   *  resaltan si se pasa `onToggleExtra` -- sin eso, un click normal en
   *  cualquier chip siempre reemplaza la seleccion via `onSelect`. */
  extraSelectedIds?: Set<string>
  /** Si se provee, Ctrl/Cmd+clic en un chip (que no sea `quincenaId`) llama
   *  esto en vez de `onSelect`, para combinar varias quincenas a la vez. */
  onToggleExtra?: (id: string) => void
}

export function QuincenaChips({ quincenas, quincenaId, today, onSelect, showAll, extraSelectedIds, onToggleExtra }: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [quincenaId])

  if (quincenas.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
      {showAll && (
        <button
          ref={quincenaId === ALL_QUINCENAS ? selectedRef : undefined}
          onClick={() => onSelect(ALL_QUINCENAS)}
          className={`flex-none px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
            quincenaId === ALL_QUINCENAS
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400'
          }`}
        >
          Todas
        </button>
      )}
      {quincenas.map(q => {
        const ini = q.fechaInicio.split('T')[0]
        const fin = q.fechaFin.split('T')[0]
        const isRunning = today >= ini && today <= fin
        const isSelected = quincenaId === q.id.toString()
        const isExtra = !isSelected && extraSelectedIds?.has(q.id.toString())
        return (
          <button
            key={q.id}
            ref={isSelected ? selectedRef : undefined}
            onClick={e => {
              if ((e.ctrlKey || e.metaKey) && onToggleExtra) onToggleExtra(q.id.toString())
              else onSelect(q.id.toString())
            }}
            title={onToggleExtra ? 'Ctrl/Cmd+clic para combinar con la quincena seleccionada' : undefined}
            className={`flex-none px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              isSelected
                ? 'bg-indigo-600 text-white shadow-sm'
                : isExtra
                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-300 dark:ring-indigo-700'
                : isRunning
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
          >
            {q.codigo}
            {isRunning && !isSelected && !isExtra && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mb-0.5" />}
          </button>
        )
      })}
    </div>
  )
}
