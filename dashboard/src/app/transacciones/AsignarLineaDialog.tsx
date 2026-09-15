'use client'
import { Info } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import type { FilaParaPlan } from '@/lib/transacciones-bulk'

// Asignacion masiva a linea de presupuesto, agrupada por (quincena, categoria).
//
// Esa es la unica particion en la que una sola linea destino es legal para
// todas las filas del grupo: la quincena porque el servidor la exige (ver
// @/lib/validar-enlace-presupuesto), y la categoria porque ofrecer lineas de
// otra categoria en una accion masiva seria elegir a ciegas por el usuario.
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
  categoriaId: number
  filas: FilaParaPlan[]
}

export interface LineaOpcion { value: string; label: string }

interface Props {
  grupos: Grupo[]
  /** clave de grupo -> presupuestoId ('' = ese grupo no se toca). */
  elegidas: Record<string, string>
  nombreQuincena: (id: number) => string
  nombreCategoria: (id: number) => string
  lineasPara: (quincenaId: number, categoriaId: number) => LineaOpcion[]
  cargando: (quincenaId: number) => boolean
  onElegir: (clave: string, presupuestoId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function AsignarLineaDialog({
  grupos, elegidas, nombreQuincena, nombreCategoria, lineasPara, cargando,
  onElegir, onConfirm, onCancel,
}: Props) {
  const totalFilas = grupos.reduce((n, g) => n + g.filas.length, 0)
  const elegidasCount = grupos.filter(g => !!elegidas[g.clave]).length
  const afectadas = grupos.filter(g => !!elegidas[g.clave]).reduce((n, g) => n + g.filas.length, 0)

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
              Tu selección abarca {grupos.length} combinaciones de quincena y categoría. Filtrar por
              quincena o por categoría antes de seleccionar hace esto mucho más corto.
            </span>
          </p>
        )}

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {grupos.map(g => {
            const opciones = lineasPara(g.quincenaId, g.categoriaId)
            const cargandoEste = cargando(g.quincenaId)
            const vacio = !cargandoEste && opciones.length === 0
            const etiqueta = `${nombreQuincena(g.quincenaId)} · ${nombreCategoria(g.categoriaId)}`
            return (
              <div key={g.clave} className="flex items-center gap-3">
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
                        ? `Sin líneas de ${nombreCategoria(g.categoriaId)} en ${nombreQuincena(g.quincenaId)}`
                        : 'No cambiar'}
                  </option>
                  {opciones.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
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
          <button type="button" onClick={onConfirm} disabled={elegidasCount === 0}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer font-medium disabled:opacity-50 disabled:cursor-default">
            Asignar {afectadas > 0 ? afectadas : ''}
          </button>
        </div>
      </div>
    </FormModal>
  )
}
