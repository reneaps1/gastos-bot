'use client'
import { useState } from 'react'
import { Columns3 } from 'lucide-react'

interface ColumnOption { key: string; label: string }

interface Props {
  columns: ColumnOption[]
  visible: Set<string>
  onToggle: (key: string) => void
}

export function ColumnsMenu({ columns, visible, onToggle }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-label="Elegir columnas visibles"
        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer transition-colors">
        <Columns3 size={14} /> Columnas
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1.5 w-56 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-30 overflow-hidden">
            <div className="px-3 pt-2 pb-1 border-b border-slate-100 dark:border-slate-700">
              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Mostrar columnas</p>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {columns.map(c => (
                <label key={c.key} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400" />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
