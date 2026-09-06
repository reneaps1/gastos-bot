'use client'
import { useState, useEffect, useCallback } from 'react'
import { PiggyBank, TrendingUp, TrendingDown, Pencil, Trash2, Plus, Target, Wallet } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getInitialQuincenaId, getMexicoDateString } from '@/lib/quincena-selection'
import { APARTADO_COLORS, APARTADO_ICONS, DEFAULT_COLOR_KEY, DEFAULT_ICON_NAME, resolveApartadoColor, resolveApartadoIcon } from '@/lib/apartado-icons'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string }
interface MetodoPago { id: number; nombre: string }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: string; direccion: string | null; monto: number
  quincenaId: number; metodoPagoId: number | null; apartadoId: number | null
  quincena: Quincena; user: { id: number; nombre: string } | null
  balanceAcumulado: number
}
interface PorQuincena { quincena: Quincena; aportado: number; retirado: number }
interface ApartadoInfo { id: number; nombre: string; metaMonto: number | null; icono: string | null; color: string | null }
interface PorApartado { apartado: ApartadoInfo | null; aportado: number; retirado: number; balance: number }
interface AhorroData {
  total: number
  porQuincena: PorQuincena[]
  porApartado: PorApartado[]
  transacciones: Transaccion[]
}

type ModalTipo = 'aportacion' | 'retiro'

const EMPTY_FORM = {
  fecha: getMexicoDateString(),
  quincenaId: '',
  descripcion: '',
  monto: '',
  metodoPagoId: '',
  apartadoId: '',
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

  const [apartadoModalOpen, setApartadoModalOpen] = useState(false)
  const [editingApartado, setEditingApartado] = useState<ApartadoInfo | null>(null)
  const [apartadoForm, setApartadoForm] = useState({ nombre: '', metaMonto: '', icono: DEFAULT_ICON_NAME, color: DEFAULT_COLOR_KEY })
  const [apartadoFormErrors, setApartadoFormErrors] = useState<Record<string, string>>({})
  const [savingApartado, setSavingApartado] = useState(false)
  const [deleteApartadoId, setDeleteApartadoId] = useState<number | null>(null)
  const [deletingApartado, setDeletingApartado] = useState(false)

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
    setModalTipo(tx.direccion === 'Retiro' ? 'retiro' : 'aportacion')
    setForm({
      fecha: tx.fecha.split('T')[0],
      quincenaId: tx.quincenaId.toString(),
      descripcion: tx.descripcion,
      monto: tx.monto.toString(),
      metodoPagoId: tx.metodoPagoId?.toString() ?? '',
      apartadoId: tx.apartadoId?.toString() ?? '',
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
        tipo: 'Ahorro',
        direccion: modalTipo === 'retiro' ? 'Retiro' : 'Aporte',
        apartadoId: form.apartadoId || null,
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

  function openCreateApartado() {
    setEditingApartado(null)
    setApartadoForm({ nombre: '', metaMonto: '', icono: DEFAULT_ICON_NAME, color: DEFAULT_COLOR_KEY })
    setApartadoFormErrors({})
    setApartadoModalOpen(true)
  }

  function openEditApartado(a: ApartadoInfo) {
    setEditingApartado(a)
    setApartadoForm({
      nombre: a.nombre, metaMonto: a.metaMonto != null ? a.metaMonto.toString() : '',
      icono: a.icono ?? DEFAULT_ICON_NAME, color: a.color ?? DEFAULT_COLOR_KEY,
    })
    setApartadoFormErrors({})
    setApartadoModalOpen(true)
  }

  function validateApartado() {
    const errors: Record<string, string> = {}
    if (!apartadoForm.nombre.trim()) errors.nombre = 'Requerido'
    if (apartadoForm.metaMonto && Number(apartadoForm.metaMonto) <= 0) errors.metaMonto = 'Debe ser mayor a 0'
    return errors
  }

  async function handleSaveApartado() {
    const errors = validateApartado()
    if (Object.keys(errors).length) { setApartadoFormErrors(errors); return }
    setSavingApartado(true)
    try {
      const body = {
        nombre: apartadoForm.nombre.trim(), metaMonto: apartadoForm.metaMonto || null,
        icono: apartadoForm.icono, color: apartadoForm.color,
      }
      const res = editingApartado
        ? await fetch(`/api/apartados/${editingApartado.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/apartados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error)
      }
      toast(editingApartado ? 'Apartado actualizado' : 'Apartado creado')
      setApartadoModalOpen(false)
      fetchAhorro()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Error al guardar', 'error')
    } finally {
      setSavingApartado(false)
    }
  }

  async function handleDeleteApartado() {
    if (deleteApartadoId == null) return
    setDeletingApartado(true)
    try {
      const res = await fetch(`/api/apartados/${deleteApartadoId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error)
      }
      toast('Apartado eliminado')
      setDeleteApartadoId(null)
      fetchAhorro()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Error al eliminar', 'error')
    } finally {
      setDeletingApartado(false)
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

        <div>
          <Label htmlFor="a-apartado">Apartado</Label>
          <select id="a-apartado" value={form.apartadoId}
            onChange={e => setForm(f => ({ ...f, apartadoId: e.target.value }))}
            className={fieldClass()}>
            <option value="">General (sin apartado)</option>
            {(data?.porApartado ?? []).filter(p => p.apartado).map(p => (
              <option key={p.apartado!.id} value={p.apartado!.id}>{p.apartado!.nombre}</option>
            ))}
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

  const apartadosSection = (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Apartados</h3>
        <button onClick={openCreateApartado}
          className="flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-2.5 py-1.5 rounded-lg cursor-pointer font-medium transition-colors">
          <Plus size={13} />
          Nuevo apartado
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(data?.porApartado ?? []).map(p => {
          const meta = p.apartado?.metaMonto != null ? Number(p.apartado.metaMonto) : null
          const progreso = meta ? Math.min(100, Math.max(0, (p.balance / meta) * 100)) : null
          const Icon = p.apartado ? resolveApartadoIcon(p.apartado.icono) : Wallet
          const colorClasses = p.apartado ? resolveApartadoColor(p.apartado.color) : resolveApartadoColor(null)
          return (
            <div key={p.apartado?.id ?? 'general'}
              className="rounded-xl border border-slate-100 dark:border-slate-700 p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-8 h-8 rounded-lg ${colorClasses.badgeBg} flex items-center justify-center shrink-0`}>
                    <Icon size={16} className={colorClasses.iconText} />
                  </div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {p.apartado?.nombre ?? 'General'}
                  </p>
                </div>
                {p.apartado && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => openEditApartado(p.apartado!)} aria-label="Editar apartado"
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-md cursor-pointer transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setDeleteApartadoId(p.apartado!.id)} aria-label="Eliminar apartado"
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-md cursor-pointer transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              <p className={`text-xl font-bold tabular-nums ${colorClasses.text}`}>{formatMXN(p.balance)}</p>
              {meta != null && (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full ${colorClasses.swatch} rounded-full`} style={{ width: `${progreso}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1">
                    <Target size={11} /> Meta {formatMXN(meta)}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {(data?.porApartado ?? []).filter(p => p.apartado).length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          Crea un apartado para organizar tu ahorro en metas, como en un banco.
        </p>
      )}
    </div>
  )

  const apartadoFormModal = (
    <FormModal open={apartadoModalOpen} onOpenChange={setApartadoModalOpen}
      title={editingApartado ? 'Editar apartado' : 'Nuevo apartado'}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="ap-nombre">Nombre *</Label>
          <input id="ap-nombre" type="text" placeholder="Ej: Vacaciones, Fondo de emergencia..."
            value={apartadoForm.nombre} onChange={e => setApartadoForm(f => ({ ...f, nombre: e.target.value }))}
            className={fieldClass(apartadoFormErrors.nombre)} />
          {apartadoFormErrors.nombre && <p className="text-xs text-rose-500 mt-1">{apartadoFormErrors.nombre}</p>}
        </div>
        <div>
          <Label htmlFor="ap-meta">Meta (MXN)</Label>
          <input id="ap-meta" type="number" min="0" step="0.01" placeholder="Opcional"
            value={apartadoForm.metaMonto} onChange={e => setApartadoForm(f => ({ ...f, metaMonto: e.target.value }))}
            className={fieldClass(apartadoFormErrors.metaMonto)} />
          {apartadoFormErrors.metaMonto && <p className="text-xs text-rose-500 mt-1">{apartadoFormErrors.metaMonto}</p>}
        </div>
        <div>
          <Label htmlFor="ap-icono">Icono</Label>
          <div id="ap-icono" className="flex flex-wrap gap-2">
            {APARTADO_ICONS.map(({ name, Icon }) => (
              <button key={name} type="button" onClick={() => setApartadoForm(f => ({ ...f, icono: name }))}
                aria-label={name}
                className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all ${
                  apartadoForm.icono === name
                    ? `${resolveApartadoColor(apartadoForm.color).badgeBg} ${resolveApartadoColor(apartadoForm.color).iconText} ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-800`
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="ap-color">Color</Label>
          <div id="ap-color" className="flex flex-wrap gap-2">
            {APARTADO_COLORS.map(c => (
              <button key={c.key} type="button" onClick={() => setApartadoForm(f => ({ ...f, color: c.key }))}
                className={`w-8 h-8 rounded-full ${c.swatch} cursor-pointer transition-all ${
                  apartadoForm.color === c.key ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-800 scale-110' : 'hover:scale-105'
                }`}
                aria-label={c.key} />
            ))}
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={() => setApartadoModalOpen(false)} disabled={savingApartado}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={handleSaveApartado} disabled={savingApartado}
            className="px-5 py-2 text-sm text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[110px] bg-indigo-600 hover:bg-indigo-700">
            {savingApartado ? 'Guardando...' : editingApartado ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </div>
    </FormModal>
  )

  const apartadoDeleteDialog = (
    <ConfirmDialog
      open={deleteApartadoId != null}
      onOpenChange={open => !open && setDeleteApartadoId(null)}
      title="Eliminar apartado"
      description="Esta acción no se puede deshacer. Solo se puede eliminar un apartado sin movimientos asociados."
      confirmLabel="Eliminar"
      onConfirm={handleDeleteApartado}
      loading={deletingApartado}
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
        {apartadosSection}
        {formModal}
        {apartadoFormModal}
        {apartadoDeleteDialog}
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

      {apartadosSection}

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
                {t.direccion === 'Retiro'
                  ? <TrendingDown size={16} className="text-rose-500 shrink-0" />
                  : <TrendingUp size={16} className="text-emerald-500 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{t.descripcion}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(t.fecha)} · {t.quincena.codigo}{t.user ? ` · ${t.user.nombre}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className={`font-semibold tabular-nums ${t.direccion === 'Retiro' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {t.direccion === 'Retiro' ? '-' : '+'}{formatMXN(Number(t.monto))}
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
      {apartadoFormModal}
      {apartadoDeleteDialog}
    </div>
  )
}
