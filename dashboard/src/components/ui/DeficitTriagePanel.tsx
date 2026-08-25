'use client'
import { useState, useEffect, useCallback } from 'react'
import { Scissors, ArrowRightCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
interface PresupuestoItem {
  id: number; descripcion: string; montoPresupuestado: number | string; categoriaId: number
  quincenaId: number; categoria: Categoria; real: number; pendiente: number; pct: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  quincenaId: number
  quincenaCodigo: string
  quincenas: Quincena[]
  snapshotId: number | null
  onChanged: () => void
}

// Panel de triage para cuando la liquidez no alcanza a cubrir lo presupuestado
// de la quincena (Delta negativo en /configuracion/liquidez). Sigue el orden de
// preferencia estándar de reforecast de presupuesto: recortar lo discrecional
// sin gastar -> postergar a la siguiente quincena -> aceptar el gasto tal cual
// si es ineludible. Reutiliza los mismos endpoints que ya usan el modal de
// edición de Presupuesto (mover de quincena) y el ajuste de descuadre de
// Liquidez (registrar transacción), para no duplicar lógica de negocio.
export function DeficitTriagePanel({ open, onOpenChange, quincenaId, quincenaCodigo, quincenas, snapshotId, onChanged }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PresupuestoItem[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetchItems = useCallback(async () => {
    if (!quincenaId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${quincenaId}`)
      const data: PresupuestoItem[] = await res.json()
      setItems(data.filter(p => p.categoria.tipo === 'Gasto'))
    } finally {
      setLoading(false)
    }
  }, [quincenaId])

  useEffect(() => { if (open) { setEditingId(null); fetchItems() } }, [open, fetchItems])

  const totalFalta = calcularFaltaPorPagar(items)

  // Candidatos: partidas de Gasto que no se han terminado de ejecutar (pct <
  // 100). Las que ya llegaron o pasaron su presupuesto no tienen margen para
  // recortar ni sentido para postergar.
  const candidatos = [...items].filter(p => p.pct < 100).sort((a, b) => a.pct - b.pct)

  const nextQuincena = (() => {
    const current = quincenas.find(q => q.id === quincenaId)
    if (!current) return null
    return [...quincenas]
      .filter(q => q.fechaInicio > current.fechaInicio)
      .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))[0] ?? null
  })()

  // Mantiene el "falta por pagar" guardado en el corte de liquidez alineado
  // con el presupuesto en tiempo real, igual que hace el botón "Recalcular"
  // del modal de edición de snapshot, pero automático tras cada acción de
  // triage — si falla, el usuario siempre puede recalcular a mano.
  async function syncSnapshotFalta(newTotal: number) {
    if (!snapshotId) return
    try {
      await fetch(`/api/liquidez/${snapshotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faltaPagar: newTotal.toString() }),
      })
    } catch { /* silencioso: el usuario puede recalcular manualmente si falla */ }
  }

  async function afterChange(nextItems: PresupuestoItem[]) {
    setItems(nextItems)
    await syncSnapshotFalta(calcularFaltaPorPagar(nextItems))
    onChanged()
  }

  function startEdit(p: PresupuestoItem) {
    setEditingId(p.id)
    setEditValue(Number(p.montoPresupuestado).toString())
  }

  async function saveRecorte(p: PresupuestoItem) {
    const nuevoMonto = parseFloat(editValue)
    if (isNaN(nuevoMonto) || nuevoMonto < p.real) {
      toast(`El nuevo monto no puede ser menor a lo ya real (${formatMXN(p.real)})`, 'error')
      return
    }
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/presupuestos/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ montoPresupuestado: nuevoMonto }),
      })
      if (!res.ok) throw new Error()
      const pct = nuevoMonto > 0 ? (p.real / nuevoMonto) * 100 : 0
      const nextItems = items.map(it => it.id === p.id ? { ...it, montoPresupuestado: nuevoMonto, pct } : it)
      toast('Presupuesto recortado')
      setEditingId(null)
      await afterChange(nextItems)
    } catch {
      toast('Error al recortar', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function moverANext(p: PresupuestoItem) {
    if (!nextQuincena) return
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/presupuestos/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quincenaId: nextQuincena.id.toString() }),
      })
      if (!res.ok) throw new Error()
      toast(`Movido a ${nextQuincena.codigo}`)
      await afterChange(items.filter(it => it.id !== p.id))
    } catch {
      toast('Error al mover de quincena', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function registrarComoGasto(p: PresupuestoItem) {
    const restante = Number((Number(p.montoPresupuestado) - p.real).toFixed(2))
    if (restante <= 0) return
    setBusyId(p.id)
    try {
      const res = await fetch('/api/transacciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: getMexicoDateString(), quincenaId: p.quincenaId,
          descripcion: p.descripcion, categoriaId: p.categoriaId,
          tipo: 'Gasto', monto: restante, estatus: 'Pagado',
          source: 'triage-deficit', presupuestoId: p.id,
        }),
      })
      if (!res.ok) throw new Error()
      toast('Registrado como gasto pagado')
      const nextItems = items.map(it => it.id === p.id ? { ...it, real: Number(it.montoPresupuestado), pct: 100 } : it)
      await afterChange(nextItems)
    } catch {
      toast('Error al registrar el gasto', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <FormModal open={open} onOpenChange={onOpenChange} title={`Resolver déficit — ${quincenaCodigo}`}>
      <div className="space-y-4">
        <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-xl p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">Falta por cubrir (Gasto)</p>
            <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 tabular-nums">{formatMXN(totalFalta)}</p>
          </div>
          <p className="text-[11px] text-rose-500 dark:text-rose-400 max-w-[230px] text-right leading-snug">
            Baja al recortar o mover partidas. Si registras un gasto como pagado, baja aquí pero ya salió de tu bolsillo — asegúrate de tener liquidez real para cubrirlo.
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Cargando partidas...</div>
        ) : candidatos.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            No hay partidas de Gasto con margen para recortar o mover.
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {candidatos.map(p => {
              const monto = Number(p.montoPresupuestado)
              const restante = Math.max(monto - p.real, 0)
              const isBusy = busyId === p.id
              const isEditing = editingId === p.id
              return (
                <div key={p.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{p.descripcion}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {p.categoria.nombre} · {formatMXN(p.real)} de {formatMXN(monto)} ({p.pct.toFixed(0)}%)
                        {p.pendiente > 0 && <span className="ml-1 text-amber-500 dark:text-amber-400">· {formatMXN(p.pendiente)} pendiente de pago</span>}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">{formatMXN(restante)}</span>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={p.real} step="0.01" value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        className="w-28 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <button onClick={() => saveRecorte(p)} disabled={isBusy}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer disabled:opacity-50">
                        {isBusy && <Loader2 size={11} className="animate-spin" />} Guardar
                      </button>
                      <button onClick={() => setEditingId(null)} disabled={isBusy}
                        className="text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => startEdit(p)} disabled={isBusy}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                        <Scissors size={11} /> Recortar
                      </button>
                      <button onClick={() => moverANext(p)} disabled={isBusy || !nextQuincena}
                        title={!nextQuincena ? 'No hay quincena siguiente configurada' : undefined}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightCircle size={11} />}
                        Mover a {nextQuincena?.codigo ?? '—'}
                      </button>
                      <button onClick={() => registrarComoGasto(p)} disabled={isBusy}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                        Ya se paga — registrar
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="button" onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </FormModal>
  )
}
