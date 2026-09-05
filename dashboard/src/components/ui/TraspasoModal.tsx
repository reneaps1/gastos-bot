'use client'
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'

interface DestinoOption { id: number; descripcion: string; montoEfectivo: number }

interface Origen { id: number; descripcion: string; quincenaId: number; disponible: number }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  origen: Origen | null
  onDone: () => void
}

// Traspasa saldo libre (disponible = montoEfectivo - real) de una linea de
// Gasto hacia otra de la misma quincena, sin esperar a que la destino este
// en deficit -- reutiliza el mismo endpoint de doble entrada que ya usa
// "Cubrir desde otra linea" en el cierre de quincena
// (POST /api/presupuestos/[id]/transferir), solo que aqui el origen ya se
// conoce de antemano y lo que se elige es el destino.
export function TraspasoModal({ open, onOpenChange, origen, onDone }: Props) {
  const { toast } = useToast()
  const [destinoId, setDestinoId] = useState('')
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  const [opciones, setOpciones] = useState<DestinoOption[]>([])
  const [cargando, setCargando] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !origen) return
    setDestinoId('')
    setMonto('')
    setNota('')
    setCargando(true)
    fetch(`/api/presupuestos?quincenaId=${origen.quincenaId}`)
      .then(r => r.json())
      .then((data: Array<{ id: number; descripcion: string; categoria: { tipo: string }; montoEfectivo: number; estadoLinea: string }>) => {
        setOpciones(
          data
            .filter(p => p.id !== origen.id && p.categoria.tipo === 'Gasto' && p.estadoLinea !== 'Cancelada')
            .map(p => ({ id: p.id, descripcion: p.descripcion, montoEfectivo: p.montoEfectivo }))
        )
      })
      .finally(() => setCargando(false))
  }, [open, origen])

  if (!origen) return null

  async function submit() {
    const montoNum = parseFloat(monto)
    if (!destinoId || !montoNum || montoNum <= 0) return
    if (montoNum > origen!.disponible) {
      toast(`Solo hay ${formatMXN(origen!.disponible)} disponible en "${origen!.descripcion}"`, 'error')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/presupuestos/${destinoId}/transferir`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: montoNum, origenId: origen!.id, nota: nota || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Error al traspasar')
      }
      toast('Traspaso realizado')
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al traspasar', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal open={open} onOpenChange={onOpenChange} title={`Traspasar desde "${origen.descripcion}"`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Disponible para traspasar: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatMXN(origen.disponible)}</span>
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Línea destino</label>
          <select value={destinoId} onChange={e => setDestinoId(e.target.value)} disabled={cargando}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">Seleccionar...</option>
            {opciones.map(o => (
              <option key={o.id} value={o.id}>{o.descripcion} ({formatMXN(o.montoEfectivo)})</option>
            ))}
          </select>
          {cargando && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Buscando líneas de esta quincena…</p>}
          {!cargando && opciones.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">No hay otra línea de Gasto disponible en esta quincena.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Monto a traspasar</label>
          <input type="number" min="0" max={origen.disponible} step="0.01" value={monto} onChange={e => setMonto(e.target.value)}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nota (opcional)</label>
          <input type="text" value={nota} onChange={e => setNota(e.target.value)}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !destinoId || !monto}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-default flex items-center gap-1.5 cursor-pointer">
            {busy && <Loader2 size={14} className="animate-spin" />} Traspasar
          </button>
        </div>
      </div>
    </FormModal>
  )
}
