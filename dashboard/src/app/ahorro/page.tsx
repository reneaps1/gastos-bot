'use client'
import { useState, useEffect, useCallback } from 'react'
import { PiggyBank, TrendingUp, TrendingDown, Pencil, Trash2 } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getInitialQuincenaId, getMexicoDateString } from '@/lib/quincena-selection'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string }
interface MetodoPago { id: number; nombre: string }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: string; monto: number
  quincenaId: number; metodoPagoId: number | null
  quincena: Quincena; user: { id: number; nombre: string } | null
  balanceAcumulado: number
}
interface PorQuincena { quincena: Quincena; aportado: number; retirado: number }
interface AhorroData {
  total: number
  porQuincena: PorQuincena[]
  transacciones: Transaccion[]
}

type ModalTipo = 'aportacion' | 'retiro'

const EMPTY_FORM = {
  fecha: getMexicoDateString(),
  quincenaId: '',
  descripcion: '',
  monto: '',
  metodoPagoId: '',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'
  }`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function AhorroPage() {
  const { toast } = useToast()

  const [data, setData] = useState<AhorroData | null>(null)
  const [loading, setLoading] = useState(true)

  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [catAhorroId, setCatAhorroId] = useState('')
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [modalTipo, setModalTipo] = useState<ModalTipo>('aportacion')
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchAhorro = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ahorro')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAhorro() }, [fetchAhorro])

  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/metodos-pago').then(r => r.json()),
    ]).then(([q, c, m]: [Quincena[], Categoria[], MetodoPago[]]) => {
      setQuincenas(q)
      setMetodosPago(m)
      const cat = c.find(x => x.nombre === 'Ahorro')
      if (cat) setCatAhorroId(cat.id.toString())
    })
  }, [])

  function openCreate(tipo: ModalTipo) {
    setEditingTx(null)
    setModalTipo(tipo)
    setForm({ ...EMPTY_FORM, fecha: getMexicoDateString(), quincenaId: getInitialQuincenaId(quincenas) })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(tx: Transaccion) {
    setEditingTx(tx)
    setModalTipo(tx.tipo === 'Ingreso' ? 'retiro' : 'aportacion')
    setForm({
      fecha: tx.fecha.split('T')[0],
      quincenaId: tx.quincenaId.toString(),
      descripcion: tx.descripcion,
      monto: tx.monto.toString(),
      metodoPagoId: tx.metodoPagoId?.toString() ?? '',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.monto || Number(form.monto) <= 0) errors.monto = 'Monto válido requerido'
    if (!form.fecha) errors.fecha = 'Requerido'
    if (!form.quincenaId) errors.quincenaId = 'Requerido'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        fecha: form.fecha,
        quincenaId: form.quincenaId,
        descripcion: form.descripcion.trim() || (modalTipo === 'retiro' ? 'Retiro de ahorro' : 'Aportación a ahorro'),
        categoriaId: catAhorroId,
        tipo: modalTipo === 'retiro' ? 'Ingreso' : 'Gasto',
        monto: form.monto,
        metodoPagoId: form.metodoPagoId || null,
        estatus: 'Pagado',
        source: 'dashboard',
      }
      const res = editingTx
        ? await fetch(`/api/transacciones/${editingTx.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/transacciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error()
      toast(editingTx ? 'Movimiento actualizado' : modalTipo === 'retiro' ? 'Retiro registrado' : 'Aportación registrada')
      setModalOpen(false)
      fetchAhorro()
    } catch {
      toast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (deleteTargetId == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/transacciones/${deleteTargetId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Movimiento eliminado')
      setDeleteTargetId(null)
      fetchAhorro()
    } catch {
      toast('Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const modalTitle = editingTx
    ? (modalTipo === 'retiro' ? 'Editar retiro' : 'Editar aportación')
    : (modalTipo === 'retiro' ? 'Nuevo retiro de ahorro' : 'Nueva aportación a ahorro')

  const actionButtons = (
    <div className="flex items-center gap-2">
      <button onClick={() => openCreate('aportacion')}
        className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 px-3 py-2 rounded-lg cursor-pointer font-medium transition-colors">
        <TrendingUp size={15} />
        Registrar aportación
      </button>
      <button onClick={() => openCreate('retiro')}
        className="flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 px-3 py-2 rounded-lg cursor-pointer font-medium transition-colors">
        <TrendingDown size={15} />
        Registrar retiro
      </button>
    </div>
  )

  const formModal = (
    <FormModal open={modalOpen} onOpenChange={setModalOpen} title={modalTitle}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="a-monto">Monto (MXN) *</Label>
            <input id="a-monto" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
              className={fieldClass(formErrors.monto)} />
            {formErrors.monto && <p className="text-xs text-rose-500 mt-1">{formErrors.monto}</p>}
          </div>
          <div>
            <Label htmlFor="a-fecha">Fecha *</Label>
            <input id="a-fecha" type="date" value={form.fecha}
              onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
              className={fieldClass(formErrors.fecha)} />
            {formErrors.fecha && <p className="text-xs text-rose-500 mt-1">{formErrors.fecha}</p>}
          </div>
        </div>

        <div>
          <Label htmlFor="a-quincena">Quincena *</Label>
          <select id="a-quincena" value={form.quincenaId}
            onChange={e => setForm(f => ({ ...f, quincenaId: e.target.value }))}
            className={fieldClass(formErrors.quincenaId)}>
            <option value="">Seleccionar...</option>
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
          {formErrors.quincenaId && <p className="text-xs text-rose-500 mt-1">{formErrors.quincenaId}</p>}
        </div>

        <div>
          <Label htmlFor="a-desc">Descripción</Label>
          <input id="a-desc" type="text"
            placeholder={modalTipo === 'retiro' ? 'Retiro de ahorro' : 'Aportación a ahorro'}
            value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            className={fieldClass()} />
        </div>

        <div>
          <Label htmlFor="a-metodo">Método de pago</Label>
          <select id="a-metodo" value={form.metodoPagoId}
            onChange={e => setForm(f => ({ ...f, metodoPagoId: e.target.value }))}
            className={fieldClass()}>
            <option value="">Sin especificar</option>
            {metodosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={() => setModalOpen(false)} disabled={saving}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className={`px-5 py-2 text-sm text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[110px] ${
              modalTipo === 'retiro' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}>
            {saving ? 'Guardando...' : editingTx ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>
      </div>
    </FormModal>
  )

  const deleteDialog = (
    <ConfirmDialog
      open={deleteTargetId != null}
      onOpenChange={open => !open && setDeleteTargetId(null)}
      title="Eliminar movimiento"
      description="Esta acción no se puede deshacer. El movimiento se eliminará del historial de ahorro."
      confirmLabel="Eliminar"
      onConfirm={handleDelete}
      loading={deleting}
    />
  )

  if (loading) {
    return (
      <div className="py-16 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Cargando...
      </div>
    )
  }

  if (!data || data.transacciones.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ahorro</h2>
          {actionButtons}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <PiggyBank size={28} className="text-blue-400" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin movimientos de ahorro</p>
          <p className="text-sm mt-1">Registra una aportación para empezar</p>
        </div>
        {formModal}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ahorro</h2>
        {actionButtons}
      </div>

      {/* Hero total */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
          <PiggyBank size={28} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Ahorro disponible</p>
          <p className="text-3xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{formatMXN(data.total)}</p>
        </div>
      </div>

      {/* Desglose por quincena */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Por quincena</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-2.5 text-left text-slate-500 dark:text-slate-400 font-medium">Quincena</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Aportado</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Retirado</th>
                <th className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {data.porQuincena.map(pq => (
                <tr key={pq.quincena.id}>
                  <td className="px-4 py-2.5">
                    <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {pq.quincena.codigo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {pq.aportado > 0 ? `+${formatMXN(pq.aportado)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">
                    {pq.retirado > 0 ? `-${formatMXN(pq.retirado)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatMXN(pq.aportado - pq.retirado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historial cronológico */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Historial</h3>
        </div>
        <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {data.transacciones.map(t => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                {t.tipo === 'Ingreso'
                  ? <TrendingDown size={16} className="text-rose-500 shrink-0" />
                  : <TrendingUp size={16} className="text-emerald-500 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{t.descripcion}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(t.fecha)} · {t.quincena.codigo}{t.user ? ` · ${t.user.nombre}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className={`font-semibold tabular-nums ${t.tipo === 'Ingreso' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {t.tipo === 'Ingreso' ? '-' : '+'}{formatMXN(Number(t.monto))}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">saldo {formatMXN(t.balanceAcumulado)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(t)} aria-label="Editar"
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setDeleteTargetId(t.id)} aria-label="Eliminar"
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {formModal}
      {deleteDialog}
    </div>
  )
}
