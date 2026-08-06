'use client'
import { X } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onClear: () => void
  placeholder: string
  children: React.ReactNode
}

export function FilterChip({ value, onChange, onClear, placeholder, children }: Props) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`text-sm rounded-full pl-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors appearance-none ${value ? 'pr-7 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800' : 'pr-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-1.5 text-indigo-400 hover:text-indigo-700 dark:text-indigo-500 dark:hover:text-indigo-300 cursor-pointer"
          aria-label={`Quitar filtro ${placeholder}`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
