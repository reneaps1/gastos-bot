'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Pencil, ExternalLink, PauseCircle, Trash2, AlertTriangle, Repeat, Layers } from 'lucide-react'
import { formatMXN, formatDateStr } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { KpiCard } from '@/components/ui/KpiCard'
import { colorForCategoria } from '@/lib/category-colors'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
export interface RecurrenteRow {
  id: number; descripcion: string; montoPresupuestado: number | string
  categoriaId: number; categoria: Categoria
  recurrente: boolean; frecuencia: string | null; recurrenciaGrupoId: string | null
  numOcurrencias: number | null; diaCobro: number | null
  quincena: Quincena
}

interface Props<T extends RecurrenteRow> {
  rows: T[]
  today: string
  loading: boolean
  onChanged: () => void
  // Opcional: cuando se pasa, se muestra un botón "Editar" que abre el mismo
  // modal ya usado en Tabla/Tarjetas/Análisis (mismo patrón, misma prop
  // `openEdit` de presupuesto/page.tsx). La página standalone no la pasa --
  // ahí no existe esa infraestructura de edición, y no vale la pena
  // duplicarla para una ruta secundaria.
  onEdit?: (row: T) => void
}

interface GrupoRecurrente<T extends RecurrenteRow> {
  grupoId: string; descripcion: string; categoria: Categoria
  frecuencia: string; diaCobro: number | null; numOcurrencias: number | null
  montoPresupuestado: number; items: T[]
  activa: boolean; desde: Quincena; hasta: Quincena
  restantes: number | null
}

const FREQ_LABEL: Record<string, string> = { CADA_QUINCENA: 'Cada quincena', MENSUAL: 'Mensual' }

// Fila de referencia de un grupo: la que cubre hoy, o si ninguna, la última
// ya iniciada. Se usa tanto para "Ver en su quincena" como para anclar el
// corte de "Pausar futuras" (mismo criterio 'future' que ya usa PUT/DELETE)
// y ahora tambien para "Editar".
function filaAncla<T extends RecurrenteRow>(items: T[], today: string): T | null {
  const actual = items.find(p => p.quincena.fechaInicio <= today && today <= p.quincena.fechaFin)
  if (actual) return actual
  const pasadas = items.filter(p => p.quincena.fechaInicio <= today)
  return pasadas.length > 0 ? pasadas[pasadas.length - 1] : null
}

function buildGrupos<T extends RecurrenteRow>(rows: T[], today: string): GrupoRecurrente<T>[] {
  const map = new Map<string, T[]>()
  for (const p of rows) {
    if (!p.recurrente || !p.recurrenciaGrupoId) continue
    const arr = map.get(p.recurrenciaGrupoId) ?? []
    arr.push(p)
    map.set(p.recurrenciaGrupoId, arr)
  }
  const grupos: GrupoRecurrente<T>[] = []
  for (const [grupoId, itemsRaw] of map) {
    const items = [...itemsRaw].sort((a, b) => a.quincena.fechaInicio.localeCompare(b.quincena.fechaInicio))
    const masReciente = items[items.length - 1]
    const restantes = masReciente.numOcurrencias != null ? Math.max(0, masReciente.numOcurrencias - items.length) : null
    grupos.push({
      grupoId, descripcion: masReciente.descripcion, categoria: masReciente.categoria,
      frecuencia: masReciente.frecuencia ?? 'CADA_QUINCENA', diaCobro: masReciente.diaCobro,
      numOcurrencias: masReciente.numOcurrencias, montoPresupuestado: Number(masReciente.montoPresupuestado),
      items, activa: items.some(p => p.quincena.fechaFin >= today),
      desde: items[0].quincena, hasta: items[items.length - 1].quincena, restantes,
    })
  }
  return grupos.sort((a, b) => (Number(b.activa) - Number(a.activa)) || b.hasta.fechaInicio.localeCompare(a.hasta.fechaInicio))
}

export function LineasRecurrentesTable<T extends RecurrenteRow>({ rows, today, loading, onChanged, onEdit }: Props<T>) {
  const { toast } = useToast()
  const grupos = buildGrupos(rows, today)
  const categoriasUnicas = Array.from(new Set(grupos.map(g => g.categoria.nombre)))

  const [accion, setAccion] = useState<{ grupo: GrupoRecurrente<T>; tipo: 'pausar' | 'eliminar' } | null>(null)
  const [ejecutando, setEjecutando] = useState(false)

  async function ejecutarAccion() {
    if (!accion) return
    setEjecutando(true)
    try {
      const { grupo, tipo } = accion
      const ancla = filaAncla(grupo.items, today) ?? grupo.items[0]
      const url = tipo === 'pausar'
        ? `/api/presupuestos/${ancla.id}?grupoId=${grupo.grupoId}&scope=future`
        : `/api/presupuestos/${grupo.items[0].id}?grupoId=${grupo.grupoId}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast(tipo === 'pausar'
        ? (data.count > 0 ? `${data.count} ocurrencias futuras eliminadas` : 'No había ocurrencias futuras que pausar')
        : `${data.count} partidas eliminadas`)
      setAccion(null)
      onChanged()
    } catch {
      toast('Error al eliminar', 'error')
    } finally {
      setEjecutando(false)
    }
  }

  const activas = grupos.filter(g => g.activa)
  const comprometido = activas.reduce((s, g) => s + g.montoPresupuestado, 0)

  return (
    <div className="space-y-4">
      {grupos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Líneas recurrentes activas" value={String(activas.length)}
            subtitle={`${grupos.length - activas.length} finalizadas`}
            icon={<Repeat size={20} className="text-indigo-600 dark:text-indigo-300" />}
            color="text-indigo-600 dark:text-indigo-400" bg="bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50" />
          <KpiCard label="Comprometido recurrente" value={formatMXN(comprometido)}
            subtitle="suma por ocurrencia, series activas"
            icon={<Layers size={20} className="text-violet-600 dark:text-violet-300" />}
            color="text-violet-600 dark:text-violet-400" bg="bg-violet-50 dark:bg-violet-950/50 dark:ring-1 dark:ring-violet-800/50" />
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Cargando...</div>
        ) : grupos.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-slate-500 px-6">
            <Repeat size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin líneas recurrentes todavía</p>
            <p className="text-sm mt-1">Para crear una, abre Tarjetas o Tabla en Presupuesto, edita o crea una partida y activa &quot;Repetir esta partida&quot;.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Descripción</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Categoría</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Frecuencia</th>
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Monto</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Ocurrencias</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Rango</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {grupos.map(g => {
                  const ancla = filaAncla(g.items, today)
                  const relevante = ancla?.quincena ?? g.items[0].quincena
                  const hayFuturas = g.items.some(p => p.quincena.fechaInicio > relevante.fechaInicio)
                  const porAgotarse = g.activa && g.restantes != null && g.restantes <= 1
                  const color = colorForCategoria(g.categoria.nombre, categoriasUnicas.indexOf(g.categoria.nombre))
                  return (
                    <tr key={g.grupoId} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                        {g.descripcion}
                        {porAgotarse && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded-full">
                            <AlertTriangle size={9} /> {g.restantes === 0 ? 'última ocurrencia' : 'por agotarse'}
                          </span>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 md:hidden mt-0.5">
                          {g.categoria.nombre} · {FREQ_LABEL[g.frecuencia] ?? g.frecuencia}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 md:hidden">
                          {formatDateStr(g.desde.fechaInicio, { day: '2-digit', month: 'short', year: '2-digit' })}
                          {' – '}
                          {formatDateStr(g.hasta.fechaFin, { day: '2-digit', month: 'short', year: '2-digit' })}
                        </p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          {g.categoria.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 hidden md:table-cell">
                        {FREQ_LABEL[g.frecuencia] ?? g.frecuencia}
                        {g.frecuencia === 'MENSUAL' && g.diaCobro && <span className="text-slate-400 dark:text-slate-500"> · día {g.diaCobro}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatMXN(g.montoPresupuestado)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${g.activa ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                          {g.activa ? 'Activa' : 'Finalizada'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400 tabular-nums hidden md:table-cell">
                        {g.items.length}{g.numOcurrencias != null ? ` / ${g.numOcurrencias}` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap hidden md:table-cell">
                        {formatDateStr(g.desde.fechaInicio, { day: '2-digit', month: 'short', year: '2-digit' })}
                        {' – '}
                        {formatDateStr(g.hasta.fechaFin, { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {onEdit && (
                            <button onClick={() => onEdit(ancla ?? g.items[0])}
                              className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar" title="Editar">
                              <Pencil size={14} />
                            </button>
                          )}
                          <Link href={`/quincena/${relevante.codigo}`}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors" aria-label="Ver en su quincena" title="Ver en su quincena">
                            <ExternalLink size={14} />
                          </Link>
                          {g.activa && hayFuturas && (
                            <button onClick={() => setAccion({ grupo: g, tipo: 'pausar' })}
                              className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Pausar futuras" title="Pausar futuras">
                              <PauseCircle size={14} />
                            </button>
                          )}
                          <button onClick={() => setAccion({ grupo: g, tipo: 'eliminar' })}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar serie completa" title="Eliminar serie completa">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={accion != null}
        onOpenChange={open => !open && setAccion(null)}
        title={accion?.tipo === 'pausar' ? 'Pausar ocurrencias futuras' : 'Eliminar serie completa'}
        description={accion?.tipo === 'pausar'
          ? `Se eliminarán las ocurrencias futuras de "${accion.grupo.descripcion}". Esta quincena y las anteriores no se modifican.`
          : `Se eliminarán TODAS las ocurrencias de "${accion?.grupo.descripcion}" (${accion?.grupo.items.length} en total), incluyendo las pasadas. El historial de transacciones no se ve afectado.`}
        confirmLabel={accion?.tipo === 'pausar' ? 'Pausar futuras' : 'Eliminar todo'}
        onConfirm={ejecutarAccion}
        loading={ejecutando}
      />
    </div>
  )
}
