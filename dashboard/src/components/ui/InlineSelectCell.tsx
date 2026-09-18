'use client'
import { ChevronDown } from 'lucide-react'

// Dropdown dentro de una celda de tabla.
//
// Es un <select> NATIVO transparente encima del chip que la celda ya pintaba,
// no un popover propio como ColumnsMenu. La razon es estructural: la tabla de
// /transacciones vive dentro de `<div className="hidden overflow-x-auto md:block">`,
// y un panel `absolute` dentro de un <td> queda recortado por ese contenedor de
// scroll (overflow-x:auto fuerza overflow-y a auto tambien). El navegador dibuja
// el popup de un <select> fuera del DOM, asi que recortarlo es imposible. De
// pilon salen gratis el teclado, el lector de pantalla y, en iOS, el picker
// nativo.
//
// El chip de siempre se pasa como children para que la tabla se siga viendo
// igual en reposo: solo aparece un chevron al pasar el mouse por la fila.

export interface InlineOption {
  value: string
  label: string
  disabled?: boolean
  /** Si se define, la opcion se dibuja dentro de un <optgroup> con este nombre.
   *  Las opciones CONTIGUAS con el mismo grupo caen en el mismo optgroup, asi
   *  que el orden del array es el que manda -- no se reordena nada aqui. */
  group?: string
}

/** Parte las opciones en tramos contiguos por `group`. Sin `group` en ninguna,
 *  devuelve un solo tramo sin nombre y el <select> queda plano, igual que
 *  antes de que existiera esto. */
function agruparContiguas(options: InlineOption[]): Array<{ group?: string; items: InlineOption[] }> {
  const tramos: Array<{ group?: string; items: InlineOption[] }> = []
  for (const o of options) {
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.group === o.group) ultimo.items.push(o)
    else tramos.push({ group: o.group, items: [o] })
  }
  return tramos
}

interface Props {
  /** '' representa "sin valor" y se empareja con `emptyLabel`. */
  value: string
  options: InlineOption[]
  onChange: (value: string) => void
  /** Lo que se ve en reposo: el mismo chip que la celda pintaba antes. */
  children: React.ReactNode
  /** Si se pasa, se antepone una opcion con value '' y este texto. */
  emptyLabel?: string
  busy?: boolean
  disabled?: boolean
  /** Opciones todavia en vuelo: se muestra una sola opcion inerte. */
  loading?: boolean
  title?: string
  ariaLabel: string
}

export function InlineSelectCell({
  value, options, onChange, children, emptyLabel,
  busy, disabled, loading, title, ariaLabel,
}: Props) {
  const inerte = disabled || busy || loading

  return (
    // El stopPropagation vive aca arriba y no en el <select>: el <tr> tiene
    // onClick que abre el panel de detalle (ver /transacciones), y un <select>
    // deshabilitado no atrapa el clic, asi que sin este envoltorio editar una
    // celda abriria el panel encima.
    <span
      className="relative inline-flex items-center gap-1 align-middle"
      onClick={e => e.stopPropagation()}
      title={title}
    >
      {children}
      {busy ? (
        <svg className="animate-spin h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ) : (
        <ChevronDown
          size={12}
          aria-hidden
          className={`shrink-0 text-slate-400 dark:text-slate-500 transition-opacity ${
            inerte ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      )}
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={inerte}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
      >
        {loading ? (
          <option value={value}>Cargando...</option>
        ) : (
          <>
            {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
            {agruparContiguas(options).map((tramo, i) => (
              tramo.group === undefined ? (
                tramo.items.map(o => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
                ))
              ) : (
                <optgroup key={`${tramo.group}-${i}`} label={tramo.group}>
                  {tramo.items.map(o => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
                  ))}
                </optgroup>
              )
            ))}
          </>
        )}
      </select>
    </span>
  )
}
