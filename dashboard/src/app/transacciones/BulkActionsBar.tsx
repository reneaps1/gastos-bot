'use client'
import { CalendarRange, Tag, User, Wallet, CheckCheck, Unlink, Trash2, X } from 'lucide-react'

// Barra de acciones masivas de /transacciones. No sabe escribir nada: cada
// boton llama a una prop y la pagina decide si escribe directo o abre un
// dialogo de confirmacion.
//
// Va oculta abajo de `md` a proposito: la seleccion solo existe en la tabla de
// escritorio, asi que en un telefono esta barra seria una seleccion fantasma
// sin forma de limpiarla.

export interface AccionOpcion { value: string; label: string }

/** Centinela para "sin asignar" en los selects de accion: el value vacio ya lo
 *  ocupa la opcion-placeholder que mantiene el select en su etiqueta. */
export const SIN_ASIGNAR = '__sin_asignar__'

interface Props {
  count: number
  progress: { hechas: number; total: number } | null
  quincenas: AccionOpcion[]
  categorias: AccionOpcion[]
  users: AccionOpcion[]
  onMoverQuincena: (value: string) => void
  onCambiarCategoria: (value: string) => void
  onCambiarUsuario: (value: string) => void
  onAsignarLinea: () => void
  onQuitarAsignacion: () => void
  onEstatus: (estatus: 'Pagado' | 'Pendiente') => void
  onEliminar: () => void
  onClear: () => void
}

function AccionSelect({ icon, label, options, onPick, disabled }: {
  icon: React.ReactNode
  label: string
  options: AccionOpcion[]
  onPick: (value: string) => void
  disabled?: boolean
}) {
  return (
    <span className={`relative inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
      disabled
        ? 'text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        : 'text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 cursor-pointer'
    }`}>
      {icon} {label}
      <select
        aria-label={label}
        value=""
        disabled={disabled}
        onChange={e => {
          const v = e.target.value
          // Se limpia para que volver a elegir la misma opcion dispare onChange
          // otra vez (el value controlado en '' no basta si no hay re-render).
          e.currentTarget.value = ''
          if (v) onPick(v)
        }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
      >
        <option value="">{label}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  )
}

function AccionBoton({ icon, label, onClick, disabled, tono = 'indigo' }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tono?: 'indigo' | 'emerald' | 'amber' | 'rose'
}) {
  const tonos = {
    indigo: 'text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/40',
    emerald: 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-900/30',
    amber: 'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/40 hover:bg-amber-50 dark:hover:bg-amber-900/30',
    rose: 'text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-900/30',
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default ${tonos[tono]}`}>
      {icon} {label}
    </button>
  )
}

export function BulkActionsBar({
  count, progress, quincenas, categorias, users,
  onMoverQuincena, onCambiarCategoria, onCambiarUsuario,
  onAsignarLinea, onQuitarAsignacion, onEstatus, onEliminar, onClear,
}: Props) {
  const corriendo = progress !== null

  return (
    <div className="hidden md:flex bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 items-center justify-between flex-wrap gap-3">
      <span className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
        {corriendo
          ? `Aplicando ${progress.hechas} de ${progress.total}...`
          : `${count} seleccionada${count > 1 ? 's' : ''}`}
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        <AccionSelect icon={<CalendarRange size={13} />} label="Mover a quincena"
          options={quincenas} onPick={onMoverQuincena} disabled={corriendo} />
        <AccionBoton icon={<Wallet size={13} />} label="Asignar a línea"
          onClick={onAsignarLinea} disabled={corriendo} />
        <AccionBoton icon={<Unlink size={13} />} label="Quitar asignación"
          onClick={onQuitarAsignacion} disabled={corriendo} />
        <AccionSelect icon={<Tag size={13} />} label="Categoría"
          options={categorias} onPick={onCambiarCategoria} disabled={corriendo} />
        <AccionSelect icon={<User size={13} />} label="Usuario"
          options={users} onPick={onCambiarUsuario} disabled={corriendo} />
        <AccionBoton icon={<CheckCheck size={13} />} label="Pagado" tono="emerald"
          onClick={() => onEstatus('Pagado')} disabled={corriendo} />
        <AccionBoton icon={<CheckCheck size={13} />} label="Pendiente" tono="amber"
          onClick={() => onEstatus('Pendiente')} disabled={corriendo} />
        <AccionBoton icon={<Trash2 size={13} />} label="Eliminar" tono="rose"
          onClick={onEliminar} disabled={corriendo} />
        <button type="button" onClick={onClear} disabled={corriendo} aria-label="Quitar selección"
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 cursor-pointer disabled:opacity-50">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
