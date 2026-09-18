'use client'
import { Info, AlertTriangle } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import type { FilaParaPlan } from '@/lib/transacciones-bulk'

// Asignacion masiva a linea de presupuesto, agrupada por (quincena, tipo).
//
// Esa es la particion en la que una sola linea destino es legal para todas las
// filas del grupo: la quincena porque el servidor la exige (ver
// @/lib/validar-enlace-presupuesto), y el tipo porque los agregados filtran por
// `categoria.tipo` -- un Gasto colgado de una linea de Ingreso no lo cuenta
// nadie, el monto no cambia de columna sino que desaparece.
//
// ANTES la particion incluia la CATEGORIA, "porque ofrecer lineas de otra
// categoria en una accion masiva seria elegir a ciegas por el usuario". Eso
// dejo de ser cierto: la categoria de cada linea se ve en el selector, como
// encabezado de su <optgroup>. Lo que si hay que preguntar es que pasa con la
// categoria de las filas que queden cruzadas, y esa pregunta se hace aqui
// abajo, explicita y SIN DEFAULT.
//
// Los grupos que se dejan sin elegir simplemente no se escriben. Lo que no se
// hace es la alternativa tentadora -- "elige una linea, se aplica a las que se
// pueda y las demas se saltan" -- porque no escribir filas en silencio es la
// misma clase de error invisible que validar-enlace-presupuesto existe para
// evitar.

const MUCHOS_GRUPOS = 6

interface Grupo {
  clave: string
  quincenaId: number
  tipo: string
  filas: FilaParaPlan[]
}

export interface LineaOpcion {
  value: string
  label: string
  /** Nombre de la categoria de la linea: encabezado de su <optgroup>. */
  group: string
  categoriaId: number
}

/** Que hacer con las filas cuya categoria no coincide con la de la linea
 *  elegida. Sin default a proposito: cambiar la categoria de N transacciones
 *  en silencio es exactamente el dano invisible que este dialogo debe evitar. */
export type DecisionCategoria = '' | 'alinear' | 'conservar'

interface Props {
  grupos: Grupo[]
  /** clave de grupo -> presupuestoId ('' = ese grupo no se toca). */
  elegidas: Record<string, string>
  /** clave de grupo -> que hacer con las filas cruzadas. */
  decisiones: Record<string, DecisionCategoria>
  nombreQuincena: (id: number) => string
  nombreCategoria: (id: number) => string
  lineasPara: (quincenaId: number, tipo: string) => LineaOpcion[]
  cargando: (quincenaId: number) => boolean
  onElegir: (clave: string, presupuestoId: string) => void
  onDecidir: (clave: string, decision: DecisionCategoria) => void
  onConfirm: () => void
  onCancel: () => void
}

/** Tramos contiguos por `group`, para los <optgroup>. No reordena: se apoya en
 *  que lineasPara ya devuelve las opciones ordenadas por categoria. */
function agruparContiguas(opciones: LineaOpcion[]): Array<{ group: string; items: LineaOpcion[] }> {
  const tramos: Array<{ group: string; items: LineaOpcion[] }> = []
  for (const o of opciones) {
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.group === o.group) ultimo.items.push(o)
    else tramos.push({ group: o.group, items: [o] })
  }
  return tramos
}

export function AsignarLineaDialog({
  grupos, elegidas, decisiones, nombreQuincena, nombreCategoria, lineasPara, cargando,
  onElegir, onDecidir, onConfirm, onCancel,
}: Props) {
  const totalFilas = grupos.reduce((n, g) => n + g.filas.length, 0)

  // Por grupo: la linea elegida y cuantas filas quedarian cruzadas con ella.
  const estado = grupos.map(g => {
    const opciones = lineasPara(g.quincenaId, g.tipo)
    const elegida = opciones.find(o => o.value === (elegidas[g.clave] ?? ''))
    const cruzadas = elegida ? g.filas.filter(f => f.categoriaId !== elegida.categoriaId) : []
    return { g, opciones, elegida, cruzadas }
  })

  const elegidasCount = estado.filter(e => !!e.elegida).length
  const afectadas = estado.filter(e => !!e.elegida).reduce((n, e) => n + e.g.filas.length, 0)
  // Un grupo con filas cruzadas y sin decision bloquea el boton: la pregunta no
  // tiene respuesta por omision.
  const faltaDecidir = estado.some(e => e.cruzadas.length > 0 && !decisiones[e.g.clave])

  return (
    <FormModal
      open
      onOpenChange={open => { if (!open) onCancel() }}
      title="Asignar a línea de presupuesto"
      maxWidthClass="max-w-xl"
      subtitle={<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
        {totalFilas} transacci{totalFilas > 1 ? 'ones' : 'ón'} en {grupos.length} grupo{grupos.length > 1 ? 's' : ''}
      </p>}
    >
      <div className="space-y-4">
        {grupos.length > MUCHOS_GRUPOS && (
          <p className="flex items-start gap-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 px-3 py-2">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Tu selección abarca {grupos.length} combinaciones de quincena y tipo. Filtrar por
              quincena antes de seleccionar hace esto más corto.
            </span>
          </p>
        )}

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {estado.map(({ g, opciones, cruzadas }) => {
            const cargandoEste = cargando(g.quincenaId)
            const vacio = !cargandoEste && opciones.length === 0
            const etiqueta = `${nombreQuincena(g.quincenaId)} · ${g.tipo}`
            return (
              <div key={g.clave} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 dark:text-slate-400 w-44 shrink-0 truncate" title={etiqueta}>
                    {etiqueta} <span className="text-slate-400">({g.filas.length})</span>
                  </span>
                  <select
                    aria-label={`Línea para ${etiqueta}`}
                    value={elegidas[g.clave] ?? ''}
                    disabled={cargandoEste || vacio}
                    onChange={e => onElegir(g.clave, e.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
                  >
                    <option value="">
                      {cargandoEste
                        ? 'Cargando líneas...'
                        : vacio
                          ? `Sin líneas de ${g.tipo} en ${nombreQuincena(g.quincenaId)}`
                          : 'No cambiar'}
                    </option>
                    {agruparContiguas(opciones).map((tramo, i) => (
                      <optgroup key={`${tramo.group}-${i}`} label={tramo.group}>
                        {tramo.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {cruzadas.length > 0 && (
                  <div className="ml-[11.75rem] flex flex-col gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/15 px-3 py-2">
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                      <AlertTriangle size={13} className="mt-px shrink-0" />
                      <span>
                        {cruzadas.length} de estas {cruzadas.length > 1 ? 'están' : 'está'} en otra categoría
                        {cruzadas.length <= 3 && ` (${[...new Set(cruzadas.map(f => nombreCategoria(f.categoriaId)))].join(', ')})`}.
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {(['alinear', 'conservar'] as const).map(opcion => (
                        <label key={opcion} className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name={`decision-${g.clave}`}
                            checked={decisiones[g.clave] === opcion}
                            onChange={() => onDecidir(g.clave, opcion)}
                            className="cursor-pointer"
                          />
                          {opcion === 'alinear' ? 'Mover también su categoría' : 'Dejarlas en su categoría'}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Los grupos que dejes en «No cambiar» no se tocan.
        </p>

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} disabled={elegidasCount === 0 || faltaDecidir}
            title={faltaDecidir ? 'Falta decidir qué pasa con las de otra categoría' : undefined}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer font-medium disabled:opacity-50 disabled:cursor-default">
            Asignar {afectadas > 0 ? afectadas : ''}
          </button>
        </div>
      </div>
    </FormModal>
  )
}
