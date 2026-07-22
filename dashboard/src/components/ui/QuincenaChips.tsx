'use client'
import { useEffect, useRef } from 'react'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }

interface Props {
  quincenas: Quincena[]
  quincenaId: string
  today: string
  onSelect: (id: string) => void
}

export function QuincenaChips({ quincenas, quincenaId, today, onSelect }: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [quincenaId])

  if (quincenas.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
      {quincenas.map(q => {
        const ini = q.fechaInicio.split('T')[0]
        const fin = q.fechaFin.split('T')[0]
        const isRunning = today >= ini && today <= fin
        const isSelected = quincenaId === q.id.toString()
        return (
          <button
            key={q.id}
            ref={isSelected ? selectedRef : undefined}
            onClick={() => onSelect(q.id.toString())}
            className={`flex-none px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              isSelected
                ? 'bg-indigo-600 text-white shadow-sm'
                : isRunning
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
          >
            {q.codigo}
            {isRunning && !isSelected && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mb-0.5" />}
          </button>
        )
      })}
    </div>
  )
}
