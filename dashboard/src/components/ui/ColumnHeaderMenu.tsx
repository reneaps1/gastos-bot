'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ChevronDown, Filter, Search, X } from 'lucide-react'

// Encabezado de tabla con menu estilo autofiltro de Excel: ordenar asc/desc y
// filtrar la columna. No sabe de datos: el orden y los filtros los aplica
// quien lo usa (en /transacciones, el servidor, para que alcancen a todas las
// paginas y no solo a la visible).
//
// El menu se pinta en un portal con position:fixed. La tabla vive dentro de un
// contenedor con overflow (para el encabezado fijo), y un popover absoluto
// dentro del <th> quedaria recortado por ese contenedor.

export type SortDir = 'asc' | 'desc'

export interface OpcionFiltro { value: string; label: string }

export type FiltroColumna =
  | { kind: 'lista'; opciones: OpcionFiltro[]; seleccion: string[]; onChange: (valores: string[]) => void }
  | { kind: 'rango-num'; min: string; max: string; onChange: (min: string, max: string) => void }
  | { kind: 'rango-fecha'; desde: string; hasta: string; onChange: (desde: string, hasta: string) => void }
  | { kind: 'texto'; valor: string; onChange: (valor: string) => void }

interface Props {
  label: string
  align?: 'left' | 'center' | 'right'
  /** Clases extra del <th> (p. ej. `hidden lg:table-cell`). */
  className?: string
  sortDir: SortDir | null
  onSort: (dir: SortDir | null) => void
  /** Etiquetas de [asc, desc]. Default A→Z / Z→A. */
  sortLabels?: [string, string]
  filtro?: FiltroColumna
}

function filtroActivo(f?: FiltroColumna): boolean {
  if (!f) return false
  switch (f.kind) {
    case 'lista': return f.seleccion.length > 0
    case 'rango-num': return f.min !== '' || f.max !== ''
    case 'rango-fecha': return f.desde !== '' || f.hasta !== ''
    case 'texto': return f.valor !== ''
  }
}

const ANCHO_MENU = 256

export function ColumnHeaderMenu({ label, align = 'left', className = '', sortDir, onSort, sortLabels = ['A → Z', 'Z → A'], filtro }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activo = filtroActivo(filtro)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.min(Math.max(8, align === 'right' ? r.right - ANCHO_MENU : r.left), window.innerWidth - ANCHO_MENU - 8)
    setPos({ top: r.bottom + 6, left })
  }, [open, align])

  // Se cierra con Esc, con clic afuera y si la pagina o la tabla se desplazan
  // (el menu es fixed y quedaria flotando lejos de su columna).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    function onScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const ariaSort = sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'

  return (
    <th aria-sort={ariaSort} className={`px-4 py-3 ${alignClass} ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`group inline-flex items-center gap-1 font-medium cursor-pointer transition-colors rounded px-1 -mx-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          sortDir || activo ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
        }`}
      >
        {label}
        {sortDir === 'asc' && <ArrowUp size={12} aria-hidden />}
        {sortDir === 'desc' && <ArrowDown size={12} aria-hidden />}
        {activo && <Filter size={11} className="fill-current" aria-label="Filtrada" />}
        {!sortDir && !activo && <ChevronDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" aria-hidden />}
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`Ordenar y filtrar ${label}`}
          style={{ top: pos.top, left: pos.left, width: ANCHO_MENU }}
          className="fixed z-50 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl text-sm font-normal text-left overflow-hidden"
        >
          <div className="py-1 border-b border-slate-100 dark:border-slate-700">
            <OpcionOrden icon={<ArrowUp size={14} />} label={`Ordenar ${sortLabels[0]}`} activa={sortDir === 'asc'}
              onClick={() => { onSort('asc'); setOpen(false) }} />
            <OpcionOrden icon={<ArrowDown size={14} />} label={`Ordenar ${sortLabels[1]}`} activa={sortDir === 'desc'}
              onClick={() => { onSort('desc'); setOpen(false) }} />
            {sortDir && (
              <OpcionOrden icon={<X size={14} />} label="Quitar orden" activa={false}
                onClick={() => { onSort(null); setOpen(false) }} />
            )}
          </div>
          {filtro && <PanelFiltro filtro={filtro} onDone={() => setOpen(false)} />}
        </div>,
        document.body,
      )}
    </th>
  )
}

function OpcionOrden({ icon, label, activa, onClick }: { icon: React.ReactNode; label: string; activa: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
        activa ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-700 dark:text-slate-300'
      }`}>
      {icon} {label}
    </button>
  )
}

const inputClass = 'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400'

// El panel guarda un borrador y solo escribe al pulsar Aplicar (o Enter), como
// el autofiltro de Excel: marcar 5 casillas no debe disparar 5 consultas.
function PanelFiltro({ filtro, onDone }: { filtro: FiltroColumna; onDone: () => void }) {
  // Sin filtro activo todo aparece marcado, igual que en Excel.
  const [lista, setLista] = useState<Set<string>>(() => {
    if (filtro.kind !== 'lista') return new Set()
    return new Set(filtro.seleccion.length > 0 ? filtro.seleccion : filtro.opciones.map(o => o.value))
  })
  const [busca, setBusca] = useState('')
  const [a, setA] = useState(() => filtro.kind === 'rango-num' ? filtro.min : filtro.kind === 'rango-fecha' ? filtro.desde : filtro.kind === 'texto' ? filtro.valor : '')
  const [b, setB] = useState(() => filtro.kind === 'rango-num' ? filtro.max : filtro.kind === 'rango-fecha' ? filtro.hasta : '')

  const visibles = useMemo(() => {
    if (filtro.kind !== 'lista') return []
    const q = busca.trim().toLowerCase()
    return q ? filtro.opciones.filter(o => o.label.toLowerCase().includes(q)) : filtro.opciones
  }, [filtro, busca])

  function aplicar() {
    switch (filtro.kind) {
      case 'lista': {
        // Todas marcadas == sin filtro: no tiene caso mandar un IN con todo.
        const sel = filtro.opciones.map(o => o.value).filter(v => lista.has(v))
        filtro.onChange(sel.length === filtro.opciones.length ? [] : sel)
        break
      }
      case 'rango-num': filtro.onChange(a.trim(), b.trim()); break
      case 'rango-fecha': filtro.onChange(a, b); break
      case 'texto': filtro.onChange(a); break
    }
    onDone()
  }

  function limpiar() {
    switch (filtro.kind) {
      case 'lista': filtro.onChange([]); break
      case 'rango-num': filtro.onChange('', ''); break
      case 'rango-fecha': filtro.onChange('', ''); break
      case 'texto': filtro.onChange(''); break
    }
    onDone()
  }

  function toggle(v: string) {
    setLista(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  const todasVisiblesMarcadas = visibles.length > 0 && visibles.every(o => lista.has(o.value))

  return (
    <form className="p-3 space-y-2" onSubmit={e => { e.preventDefault(); aplicar() }}>
      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtrar</p>

      {filtro.kind === 'lista' && (
        <>
          {filtro.opciones.length > 6 && (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
                className={`${inputClass} pl-7`} />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto -mx-1">
            <label className="flex items-center gap-2 px-1 py-1.5 cursor-pointer text-slate-700 dark:text-slate-300 font-medium">
              <input type="checkbox" checked={todasVisiblesMarcadas}
                onChange={() => setLista(prev => {
                  const next = new Set(prev)
                  for (const o of visibles) {
                    if (todasVisiblesMarcadas) next.delete(o.value)
                    else next.add(o.value)
                  }
                  return next
                })}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500" />
              (Seleccionar todo)
            </label>
            {visibles.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-1 py-1.5 cursor-pointer text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 rounded">
                <input type="checkbox" checked={lista.has(o.value)} onChange={() => toggle(o.value)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500" />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {visibles.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Sin coincidencias</p>}
          </div>
        </>
      )}

      {filtro.kind === 'rango-num' && (
        <div className="flex items-center gap-2">
          <input autoFocus type="number" inputMode="decimal" min="0" step="0.01" placeholder="Mínimo" aria-label="Monto mínimo"
            value={a} onChange={e => setA(e.target.value)} className={inputClass} />
          <span className="text-slate-400">–</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Máximo" aria-label="Monto máximo"
            value={b} onChange={e => setB(e.target.value)} className={inputClass} />
        </div>
      )}

      {filtro.kind === 'rango-fecha' && (
        <div className="space-y-2">
          <label className="block text-xs text-slate-500 dark:text-slate-400">Desde
            <input autoFocus type="date" value={a} onChange={e => setA(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-400">Hasta
            <input type="date" value={b} onChange={e => setB(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
        </div>
      )}

      {filtro.kind === 'texto' && (
        <input autoFocus value={a} onChange={e => setA(e.target.value)} placeholder="Contiene..." aria-label="Contiene"
          className={inputClass} />
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={limpiar}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
          Limpiar
        </button>
        <button type="submit" disabled={filtro.kind === 'lista' && lista.size === 0}
          className="text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-default">
          Aplicar
        </button>
      </div>
    </form>
  )
}
