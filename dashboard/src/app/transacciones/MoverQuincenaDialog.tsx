'use client'
import { AlertCircle, CreditCard, Unlink } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import { formatDate } from '@/lib/utils'
import type { PlanMoverQuincena, FilaParaPlan } from '@/lib/transacciones-bulk'

// Confirma un movimiento de quincena y, en el mismo paso, ofrece re-asignar la
// linea de presupuesto en la quincena destino.
//
// Existe porque mover de quincena SIEMPRE suelta el enlace: una linea pertenece
// a la quincena de su transaccion (ver @/lib/validar-enlace-presupuesto), asi
// que la que cubria el gasto en Q35 no puede seguir cubriendolo en Q36. En vez
// de soltarlo en silencio y que el usuario lo descubra en el cierre, se dice
// que se va a soltar y se ofrece con que reemplazarlo.
//
// La re-asignacion se pide POR CATEGORIA, no por fila: es la unica agrupacion
// en la que una sola linea es legal para todas las filas que abarca, y mantiene
// el dialogo en un puñado de controles en vez de en 25.
//
// Sirve igual para una fila suelta y para un lote; lo unico que cambia es el
// texto.

interface CategoriaMin { id: number; nombre: string }
interface QuincenaMin { id: number; codigo: string; fechaCierre?: string | null }

export interface LineaOpcion { value: string; label: string }

interface Props {
  plan: PlanMoverQuincena<FilaParaPlan>
  destino: QuincenaMin
  categorias: CategoriaMin[]
  /** categoriaId -> presupuestoId elegido ('' = dejar sin asignar). */
  reasignar: Record<number, string>
  /** Lineas de la quincena destino para esa categoria. */
  lineasPara: (categoriaId: number) => LineaOpcion[]
  cargandoLineas: boolean
  onReasignar: (categoriaId: number, presupuestoId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function MoverQuincenaDialog({
  plan, destino, categorias, reasignar, lineasPara, cargandoLineas,
  onReasignar, onConfirm, onCancel,
}: Props) {
  const n = plan.aEscribir.length
  const unaSola = n === 1 && plan.omitidas.length === 0
  const titulo = unaSola
    ? `Mover «${plan.aEscribir[0].descripcion}» a ${destino.codigo}`
    : `Mover ${n} transaccion${n > 1 ? 'es' : ''} a ${destino.codigo}`

  const nombreCategoria = (id: number) => categorias.find(c => c.id === id)?.nombre ?? 'Sin categoría'

  return (
    <FormModal open onOpenChange={open => { if (!open) onCancel() }} title={titulo}>
      <div className="space-y-4">
        {destino.fechaCierre && (
          <Aviso tono="amber" icon={<AlertCircle size={14} />}>
            {destino.codigo} se cerró el {formatDate(destino.fechaCierre)}. Moverla aquí cambia una
            quincena que ya se dio por cerrada.
          </Aviso>
        )}

        {plan.omitidas.length > 0 && (
          <Aviso tono="slate">
            {plan.omitidas.length} ya {plan.omitidas.length > 1 ? 'están' : 'está'} en {destino.codigo} y no se
            {plan.omitidas.length > 1 ? ' tocan' : ' toca'}.
          </Aviso>
        )}

        {plan.conCredito.length > 0 && (
          <Aviso tono="slate" icon={<CreditCard size={14} />}>
            {plan.conCredito.length} {plan.conCredito.length > 1 ? 'son compras' : 'es una compra'} a crédito:
            sus pagos programados tienen su propia quincena y no se mueven.
          </Aviso>
        )}

        {plan.pierdenEnlace.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Unlink size={13} />
              {plan.pierdenEnlace.length > 1
                ? `${plan.pierdenEnlace.length} perderán su línea de presupuesto`
                : 'Perderá su línea de presupuesto'}
            </p>
            <ul className="max-h-28 overflow-y-auto space-y-0.5">
              {plan.pierdenEnlace.map(f => (
                <li key={f.id} className="text-[11px] text-amber-700 dark:text-amber-400/90 truncate">
                  {f.descripcion} → {f.presupuesto?.descripcion ?? 'línea asignada'}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/70">
              Una línea pertenece a su propia quincena, así que la de origen no puede seguir cubriendo
              el movimiento en {destino.codigo}.
            </p>
          </div>
        )}

        {plan.categoriasAfectadas.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Reasignar en {destino.codigo}
            </p>
            {plan.categoriasAfectadas.map(catId => {
              const opciones = lineasPara(catId)
              const cuantas = plan.pierdenEnlace.filter(f => f.categoriaId === catId).length
              const vacio = !cargandoLineas && opciones.length === 0
              return (
                <div key={catId} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 dark:text-slate-400 w-32 shrink-0 truncate">
                    {nombreCategoria(catId)} <span className="text-slate-400">({cuantas})</span>
                  </span>
                  <select
                    aria-label={`Línea de ${nombreCategoria(catId)} en ${destino.codigo}`}
                    value={reasignar[catId] ?? ''}
                    disabled={cargandoLineas || vacio}
                    onChange={e => onReasignar(catId, e.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
                  >
                    <option value="">
                      {cargandoLineas
                        ? 'Cargando líneas...'
                        : vacio
                          ? `Sin líneas de ${nombreCategoria(catId)} en ${destino.codigo}`
                          : 'Dejar sin asignar'}
                    </option>
                    {opciones.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer font-medium">
            {unaSola ? `Mover a ${destino.codigo}` : `Mover ${n}`}
          </button>
        </div>
      </div>
    </FormModal>
  )
}

function Aviso({ tono, icon, children }: {
  tono: 'amber' | 'slate'
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const clases = tono === 'amber'
    ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300'
    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400'
  return (
    <p className={`flex items-start gap-1.5 text-xs rounded-xl border px-3 py-2 ${clases}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span>{children}</span>
    </p>
  )
}
