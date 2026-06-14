'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Archive, HandCoins } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'

interface Deuda {
  id: number
  acreedor: string
  deudaOriginal: number
  abonoMensual: number | null
  notas: string | null
  fechaInicio: string | null
  activo: boolean
  totalAbonado: number
  saldo: number
  pct: number
  mesesRestantes: number | null
}

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string }
interface MetodoPago { id: number; nombre: string }

const EMPTY_DEUDA = {
  acreedor: '',
  deudaOriginal: '',
  abonoMensual: '',
  fechaInicio: '',
  notas: '',
}

const EMPTY_ABONO = {
  monto: '',
  fecha: new Date().toISOString().split('T')[0],
  descripcion: '',
  quincenaId: '',
  metodoPagoId: '',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    err ? 'border-rose-400' : 'border-slate-200'
  }`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 mb-1">{children}</label>
}

function pctColor(pct: number) {
  return pct > 75 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-rose-500'
}
function pctText(pct: number) {
  return pct > 75 ? 'text-emerald-600' : pct > 40 ? 'text-amber-600' : 'text-rose-600'
}

export default function DeudasPage() {
  const { toast } = useToast()

  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [desactivando, setDesactivando] = useState(false)
  const [savingAbono, setSavingAbono] = useState(false)

  const [mostrarInactivas, setMostrarInactivas] = useState(false)

  // Catalog
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [catDeudaId, setCatDeudaId] = useState<string>('')
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([])

  // Deuda modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingD, setEditingD] = useState<Deuda | null>(null)
  const [form, setForm] = useState(EMPTY_DEUDA)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Desactivar confirm
  const [desactivarId, setDesactivarId] = useState<number | null>(null)

  // Abono modal
  const [abonoDeudaId, setAbonoDeudaId] = useState<number | null>(null)
  const [abonoAcreedor, setAbonoAcreedor] = useState('')
  const [abonoForm, setAbonoForm] = useState(EMPTY_ABONO)
  const [abonoErrors, setAbonoErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/metodos-pago').then(r => r.json()),
    ]).then(([q, c, m]) => {
      setQuincenas(q)
      setMetodosPago(m)
      const cat = c.find((x: Categoria) => x.nombre === 'Deudas')
      if (cat) setCatDeudaId(cat.id.toString())

      const today = new Date().toISOString().split('T')[0]
      const current = q.find((x: Quincena) => x.fechaInicio <= today && x.fechaFin >= today)
      if (current) setAbonoForm(f => ({ ...f, quincenaId: current.id.toString() }))
    })
  }, [])

  const fetchDeudas = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/deudas')
      const data: Deuda[] = await res.json()
      setDeudas(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDeudas() }, [fetchDeudas])

  function openCreate() {
    setEditingD(null)
    setForm({ ...EMPTY_DEUDA })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(d: Deuda) {
    setEditingD(d)
    setForm({
      acreedor: d.acreedor,
      deudaOriginal: d.deudaOriginal.toString(),
      abonoMensual: d.abonoMensual?.toString() ?? '',
      fechaInicio: d.fechaInicio ? d.fechaInicio.split('T')[0] : '',
      notas: d.notas ?? '',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function openAbono(d: Deuda) {
    setAbonoDeudaId(d.id)
    setAbonoAcreedor(d.acreedor)
    const today = new Date().toISOString().split('T')[0]
    const current = quincenas.find(q => q.fechaInicio <= today && q.fechaFin >= today)
    setAbonoForm({
      ...EMPTY_ABONO,
      fecha: today,
      quincenaId: current?.id.toString() ?? '',
      descripcion: `Abono ${d.acreedor}`,
    })
    setAbonoErrors({})
  }

  function validateDeuda() {
    const errors: Record<string, string> = {}
    if (!form.acreedor.trim()) errors.acreedor = 'Requerido'
    if (!form.deudaOriginal || Number(form.deudaOriginal) <= 0) errors.deudaOriginal = 'Monto válido requerido'
    return errors
  }

  async function handleSaveDeuda() {
    const errors = validateDeuda()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        acreedor: form.acreedor.trim(),
        deudaOriginal: form.deudaOriginal,
        abonoMensual: form.abonoMensual || null,
        fechaInicio: form.fechaInicio || null,
        notas: form.notas || null,
      }
      const res = editingD
        ? await fetch(`/api/deudas/${editingD.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/deudas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error()
      toast(editingD ? 'Deuda actualizada' : 'Deuda creada')
      setModalOpen(false)
      fetchDeudas()
    } catch {
      toast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDesactivar() {
    if (desactivarId == null) return
    setDesactivando(true)
    try {
      const res = await fetch(`/api/deudas/${desactivarId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: false }),
      })
      if (!res.ok) throw new Error()
      toast('Deuda archivada')
      setDesactivarId(null)
      fetchDeudas()
    } catch {
      toast('Error al archivar', 'error')
    } finally {
      setDesactivando(false)
    }
  }

  function validateAbono() {
    const errors: Record<string, string> = {}
    if (!abonoForm.monto || Number(abonoForm.monto) <= 0) errors.monto = 'Monto válido requerido'
    if (!abonoForm.fecha) errors.fecha = 'Requerido'
    if (!abonoForm.quincenaId) errors.quincenaId = 'Requerido'
    return errors
  }

  async function handleSaveAbono() {
    const errors = validateAbono()
    if (Object.keys(errors).length) { setAbonoErrors(errors); return }
    setSavingAbono(true)
    try {
      const body = {
        fecha: abonoForm.fecha,
        quincenaId: abonoForm.quincenaId,
        descripcion: abonoForm.descripcion || `Abono ${abonoAcreedor}`,
        categoriaId: catDeudaId,
        tipo: 'Gasto',
        monto: abonoForm.monto,
        metodoPagoId: abonoForm.metodoPagoId || null,
        estatus: 'Pagado',
        notas: abonoAcreedor,
        source: 'dashboard',
      }
      const res = await fetch('/api/transacciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast(`Abono a ${abonoAcreedor} registrado`)
      setAbonoDeudaId(null)
      fetchDeudas()
    } catch {
      toast('Error al registrar abono', 'error')
    } finally {
      setSavingAbono(false)
    }
  }

  const activas = deudas.filter(d => d.activo)
  const inactivas = deudas.filter(d => !d.activo)
  const visible = mostrarInactivas ? deudas : activas

  const totalDeuda = activas.reduce((s, d) => s + Number(d.deudaOriginal), 0)
  const totalSaldo = activas.reduce((s, d) => s + d.saldo, 0)
  const totalAbonado = activas.reduce((s, d) => s + d.totalAbonado, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Deudas</h2>
        <div className="flex items-center gap-3">
          {inactivas.length > 0 && (
            <button
              onClick={() => setMostrarInactivas(v => !v)}
              className="text-sm text-slate-500 hover:text-slate-700 underline cursor-pointer"
            >
              {mostrarInactivas ? 'Ocultar archivadas' : `Ver archivadas (${inactivas.length})`}
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
          >
            <Plus size={16} />
            Nueva deuda
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">Deuda original total</p>
          <p className="text-xl font-bold text-slate-800">{formatMXN(totalDeuda)}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 text-center">
          <p className="text-xs text-emerald-600 mb-1">Total abonado</p>
          <p className="text-xl font-bold text-emerald-700">{formatMXN(totalAbonado)}</p>
        </div>
        <div className="bg-rose-50 rounded-xl border border-rose-100 p-4 text-center">
          <p className="text-xs text-rose-600 mb-1">Saldo pendiente</p>
          <p className="text-xl font-bold text-rose-700">{formatMXN(totalSaldo)}</p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-16 flex justify-center text-slate-400 text-sm gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Cargando...
        </div>
      ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <HandCoins size={28} className="text-emerald-400" />
            </div>
            <p className="font-medium text-slate-600">Sin deudas registradas</p>
          <p className="text-sm mt-1">Crea una deuda para llevar el seguimiento</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {visible.map(d => (
            <div
              key={d.id}
              className={`bg-white rounded-2xl border p-5 ${
                d.activo ? 'border-slate-200' : 'border-slate-100 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 text-lg">{d.acreedor}</h3>
                    {!d.activo && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Archivada</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-sm text-slate-500">
                    {d.fechaInicio && <span>Desde {formatDate(d.fechaInicio)}</span>}
                    {d.abonoMensual != null && d.abonoMensual > 0 && (
                      <span>· Abono: {formatMXN(Number(d.abonoMensual))}/mes</span>
                    )}
                    {d.mesesRestantes != null && <span>· ~{d.mesesRestantes} meses restantes</span>}
                  </div>
                  {d.notas && <p className="text-xs text-slate-400 mt-1">{d.notas}</p>}
                </div>
                <div className="flex items-start gap-2 ml-4">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-rose-600">{formatMXN(d.saldo)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">de {formatMXN(Number(d.deudaOriginal))}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Abonado: {formatMXN(d.totalAbonado)}</span>
                  <span className={`font-semibold ${pctText(d.pct)}`}>{d.pct.toFixed(1)}% pagado</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${pctColor(d.pct)}`}
                    style={{ width: `${Math.min(d.pct, 100)}%` }}
                  />
                </div>
              </div>

              {d.activo && (
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    onClick={() => openAbono(d)}
                    className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg cursor-pointer font-medium"
                  >
                    <HandCoins size={13} />
                    Registrar abono
                  </button>
                  <button
                    onClick={() => openEdit(d)}
                    className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    <Pencil size={13} />
                    Editar
                  </button>
                  <button
                    onClick={() => setDesactivarId(d.id)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    <Archive size={13} />
                    Archivar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deuda Create/Edit Modal */}
      <FormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingD ? 'Editar deuda' : 'Nueva deuda'}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="d-acreedor">Acreedor *</Label>
            <input
              id="d-acreedor"
              type="text"
              placeholder="Ej: Coppel, Kueski, Tanda..."
              value={form.acreedor}
              onChange={e => setForm(f => ({ ...f, acreedor: e.target.value }))}
              className={fieldClass(formErrors.acreedor)}
            />
            {formErrors.acreedor && <p className="text-xs text-rose-500 mt-1">{formErrors.acreedor}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="d-original">Deuda original (MXN) *</Label>
              <input
                id="d-original"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.deudaOriginal}
                onChange={e => setForm(f => ({ ...f, deudaOriginal: e.target.value }))}
                className={fieldClass(formErrors.deudaOriginal)}
              />
              {formErrors.deudaOriginal && <p className="text-xs text-rose-500 mt-1">{formErrors.deudaOriginal}</p>}
            </div>
            <div>
              <Label htmlFor="d-abono">Abono mensual (MXN)</Label>
              <input
                id="d-abono"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.abonoMensual}
                onChange={e => setForm(f => ({ ...f, abonoMensual: e.target.value }))}
                className={fieldClass()}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="d-inicio">Fecha de inicio</Label>
            <input
              id="d-inicio"
              type="date"
              value={form.fechaInicio}
              onChange={e => setForm(f => ({ ...f, fechaInicio: e.target.value }))}
              className={fieldClass()}
            />
          </div>

          <div>
            <Label htmlFor="d-notas">Notas</Label>
            <textarea
              id="d-notas"
              rows={2}
              placeholder="Notas adicionales (opcional)"
              value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              className={`${fieldClass()} resize-none`}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveDeuda}
              disabled={saving}
              className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]"
            >
              {saving ? 'Guardando...' : editingD ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Abono Modal */}
      <FormModal
        open={abonoDeudaId != null}
        onOpenChange={open => !open && setAbonoDeudaId(null)}
        title={`Registrar abono — ${abonoAcreedor}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="a-monto">Monto del abono (MXN) *</Label>
              <input
                id="a-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={abonoForm.monto}
                onChange={e => setAbonoForm(f => ({ ...f, monto: e.target.value }))}
                className={fieldClass(abonoErrors.monto)}
              />
              {abonoErrors.monto && <p className="text-xs text-rose-500 mt-1">{abonoErrors.monto}</p>}
            </div>
            <div>
              <Label htmlFor="a-fecha">Fecha *</Label>
              <input
                id="a-fecha"
                type="date"
                value={abonoForm.fecha}
                onChange={e => setAbonoForm(f => ({ ...f, fecha: e.target.value }))}
                className={fieldClass(abonoErrors.fecha)}
              />
              {abonoErrors.fecha && <p className="text-xs text-rose-500 mt-1">{abonoErrors.fecha}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="a-quincena">Quincena *</Label>
            <select
              id="a-quincena"
              value={abonoForm.quincenaId}
              onChange={e => setAbonoForm(f => ({ ...f, quincenaId: e.target.value }))}
              className={fieldClass(abonoErrors.quincenaId)}
            >
              <option value="">Seleccionar...</option>
              {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
            </select>
            {abonoErrors.quincenaId && <p className="text-xs text-rose-500 mt-1">{abonoErrors.quincenaId}</p>}
          </div>

          <div>
            <Label htmlFor="a-desc">Descripción</Label>
            <input
              id="a-desc"
              type="text"
              value={abonoForm.descripcion}
              onChange={e => setAbonoForm(f => ({ ...f, descripcion: e.target.value }))}
              className={fieldClass()}
            />
          </div>

          <div>
            <Label htmlFor="a-metodo">Método de pago</Label>
            <select
              id="a-metodo"
              value={abonoForm.metodoPagoId}
              onChange={e => setAbonoForm(f => ({ ...f, metodoPagoId: e.target.value }))}
              className={fieldClass()}
            >
              <option value="">Sin especificar</option>
              {metodosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>

          <p className="text-xs text-slate-400">
            El abono se registrará como una transacción en la categoría Deudas.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setAbonoDeudaId(null)}
              disabled={savingAbono}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveAbono}
              disabled={savingAbono}
              className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[110px]"
            >
              {savingAbono ? 'Registrando...' : 'Registrar abono'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Archivar confirm */}
      <ConfirmDialog
        open={desactivarId != null}
        onOpenChange={open => !open && setDesactivarId(null)}
        title="Archivar deuda"
        description="La deuda se marcará como inactiva. Puedes verla activando la opción de archivadas."
        confirmLabel="Archivar"
        onConfirm={handleDesactivar}
        loading={desactivando}
      />
    </div>
  )
}
