'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Copy } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'

const CAT_DOT: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
interface Presupuesto {
  id: number
  descripcion: string
  montoPresupuestado: number
  clasificacion: string | null
  tipo: string
  notas: string | null
  quincenaId: number
  categoriaId: number
  categoria: Categoria
  quincena: Quincena
  real: number
  pct: number
}

const EMPTY_FORM = {
  categoriaId: '',
  descripcion: '',
  tipo: 'Gasto',
  montoPresupuestado: '',
  clasificacion: '',
  notas: '',
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
  return pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
}
function pctTextColor(pct: number) {
  return pct > 90 ? 'text-rose-600' : pct > 70 ? 'text-amber-600' : 'text-emerald-600'
}

export default function PresupuestoPage() {
  const { toast } = useToast()

  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [quincenaId, setQuincenaId] = useState('')
  const [quincenaActual, setQuincenaActual] = useState<Quincena | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingP, setEditingP] = useState<Presupuesto | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Load quincenas and categorias once
  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
    ]).then(([q, c]) => {
      setQuincenas(q)
      setCategorias(c)
      // Default: current quincena
      const today = new Date().toISOString().split('T')[0]
      const current = q.find((x: Quincena) =>
        x.fechaInicio <= today && x.fechaFin >= today
      )
      if (current) setQuincenaId(current.id.toString())
    })
  }, [])

  const fetchPresupuestos = useCallback(async () => {
    if (!quincenaId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${quincenaId}`)
      const data: Presupuesto[] = await res.json()
      setPresupuestos(data)
      setQuincenaActual(data[0]?.quincena ?? quincenas.find(q => q.id.toString() === quincenaId) ?? null)
    } finally {
      setLoading(false)
    }
  }, [quincenaId, quincenas])

  useEffect(() => { fetchPresupuestos() }, [fetchPresupuestos])

  function openCreate() {
    setEditingP(null)
    setForm({ ...EMPTY_FORM })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(p: Presupuesto) {
    setEditingP(p)
    setForm({
      categoriaId: p.categoriaId.toString(),
      descripcion: p.descripcion,
      tipo: p.tipo,
      montoPresupuestado: p.montoPresupuestado.toString(),
      clasificacion: p.clasificacion ?? '',
      notas: p.notas ?? '',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.categoriaId) errors.categoriaId = 'Requerido'
    if (!form.descripcion.trim()) errors.descripcion = 'Requerido'
    if (!form.montoPresupuestado || Number(form.montoPresupuestado) <= 0) errors.montoPresupuestado = 'Monto válido requerido'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        quincenaId,
        categoriaId: form.categoriaId,
        descripcion: form.descripcion.trim(),
        tipo: form.tipo,
        montoPresupuestado: form.montoPresupuestado,
        clasificacion: form.clasificacion || null,
        notas: form.notas || null,
      }
      const res = editingP
        ? await fetch(`/api/presupuestos/${editingP.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/presupuestos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await res.text())
      toast(editingP ? 'Presupuesto actualizado' : 'Presupuesto creado')
      setModalOpen(false)
      fetchPresupuestos()
    } catch {
      toast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (confirmId == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/presupuestos/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Presupuesto eliminado')
      setConfirmId(null)
      fetchPresupuestos()
    } catch {
      toast('Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleCopiar() {
    // Find previous quincena
    const idx = quincenas.findIndex(q => q.id.toString() === quincenaId)
    if (idx < 0 || idx >= quincenas.length - 1) {
      toast('No hay quincena anterior disponible', 'error')
      return
    }
    const prevQ = quincenas[idx + 1] // sorted desc, so idx+1 is earlier
    setCopying(true)
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${prevQ.id}`)
      const prev: Presupuesto[] = await res.json()
      if (prev.length === 0) {
        toast('La quincena anterior no tiene presupuesto', 'error')
        return
      }
      await Promise.all(
        prev.map(p =>
          fetch('/api/presupuestos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quincenaId,
              categoriaId: p.categoriaId.toString(),
              descripcion: p.descripcion,
              tipo: p.tipo,
              montoPresupuestado: p.montoPresupuestado.toString(),
              clasificacion: p.clasificacion,
              notas: p.notas,
            }),
          })
        )
      )
      toast(`${prev.length} presupuestos copiados de ${prevQ.codigo}`)
      fetchPresupuestos()
    } catch {
      toast('Error al copiar presupuestos', 'error')
    } finally {
      setCopying(false)
    }
  }

  const totalPresupuestado = presupuestos.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
  const totalGastado = presupuestos.reduce((s, p) => s + p.real, 0)
  const pctGlobal = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0

  const qInfo = quincenaActual ?? quincenas.find(q => q.id.toString() === quincenaId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Presupuesto</h2>
          {qInfo && (
            <p className="text-sm text-slate-500 mt-1">
              {qInfo.codigo} · {new Date(qInfo.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
              {' — '}
              {new Date(qInfo.fechaFin).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={quincenaId}
            onChange={e => setQuincenaId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Seleccionar quincena</option>
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
          {presupuestos.length === 0 && !loading && (
            <button
              onClick={handleCopiar}
              disabled={copying}
              className="flex items-center gap-2 text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Copy size={14} />
              {copying ? 'Copiando...' : 'Copiar anterior'}
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
          >
            <Plus size={16} />
            Nuevo presupuesto
          </button>
        </div>
      </div>

      {/* Global progress */}
      {presupuestos.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex justify-between items-end mb-3">
            <div>
              <p className="text-sm text-slate-500">Progreso global</p>
              <p className="text-2xl font-bold text-slate-800">
                {formatMXN(totalGastado)}{' '}
                <span className="text-slate-400 font-normal text-base">/ {formatMXN(totalPresupuestado)}</span>
              </p>
            </div>
            <span className={`text-lg font-bold ${pctTextColor(pctGlobal)}`}>
              {pctGlobal.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${pctColor(pctGlobal)}`}
              style={{ width: `${Math.min(pctGlobal, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-category */}
      {loading ? (
        <div className="py-16 flex justify-center text-slate-400 text-sm gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Cargando...
        </div>
      ) : presupuestos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-5xl mb-3">📋</p>
          <p className="font-medium">Sin presupuesto configurado</p>
          <p className="text-sm mt-1">Crea un presupuesto o copia el de la quincena anterior</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {presupuestos.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
                  <div>
                    <p className="font-semibold text-slate-800">{p.descripcion}</p>
                    <p className="text-xs text-slate-400">
                      {p.categoria.nombre}
                      {p.clasificacion && ` · ${p.clasificacion}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="font-bold text-slate-800">{formatMXN(p.real)}</p>
                    <p className="text-xs text-slate-400">de {formatMXN(Number(p.montoPresupuestado))}</p>
                  </div>
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                    aria-label="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setConfirmId(p.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                    aria-label="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${pctColor(p.pct)}`}
                    style={{ width: `${Math.min(p.pct, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-semibold w-10 text-right ${pctTextColor(p.pct)}`}>
                  {p.pct.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <FormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingP ? 'Editar presupuesto' : 'Nuevo presupuesto'}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="p-cat">Categoría *</Label>
            <select
              id="p-cat"
              value={form.categoriaId}
              onChange={e => setForm(f => ({ ...f, categoriaId: e.target.value }))}
              className={fieldClass(formErrors.categoriaId)}
            >
              <option value="">Seleccionar...</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {formErrors.categoriaId && <p className="text-xs text-rose-500 mt-1">{formErrors.categoriaId}</p>}
          </div>

          <div>
            <Label htmlFor="p-desc">Descripción *</Label>
            <input
              id="p-desc"
              type="text"
              placeholder="Ej: Renta, Súper quincenal..."
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              className={fieldClass(formErrors.descripcion)}
            />
            {formErrors.descripcion && <p className="text-xs text-rose-500 mt-1">{formErrors.descripcion}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="p-monto">Monto (MXN) *</Label>
              <input
                id="p-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.montoPresupuestado}
                onChange={e => setForm(f => ({ ...f, montoPresupuestado: e.target.value }))}
                className={fieldClass(formErrors.montoPresupuestado)}
              />
              {formErrors.montoPresupuestado && <p className="text-xs text-rose-500 mt-1">{formErrors.montoPresupuestado}</p>}
            </div>
            <div>
              <Label htmlFor="p-clasificacion">Clasificación</Label>
              <select
                id="p-clasificacion"
                value={form.clasificacion}
                onChange={e => setForm(f => ({ ...f, clasificacion: e.target.value }))}
                className={fieldClass()}
              >
                <option value="">Sin clasificar</option>
                <option value="Fijo">Fijo</option>
                <option value="Variable">Variable</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="p-notas">Notas</Label>
            <textarea
              id="p-notas"
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
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]"
            >
              {saving ? 'Guardando...' : editingP ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={open => !open && setConfirmId(null)}
        title="Eliminar presupuesto"
        description="Se eliminará este presupuesto. El historial de transacciones no se verá afectado."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
