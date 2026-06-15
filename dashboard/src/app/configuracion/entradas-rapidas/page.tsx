'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, ArrowRight, Zap } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { getInitialQuincenaId, getMexicoDateString, persistQuincenaId } from '@/lib/quincena-selection'

interface Categoria { id: number; nombre: string }
interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Entrada {
  id: number; fecha: string; descripcion: string; monto: number
  categoriaId: number | null; tipo: string | null; quincenaId: number | null
  notas: string | null; procesado: boolean; transaccionId: number | null
  fechaRegistro: string
  categoria: Categoria | null; quincena: Quincena | null
}

const EMPTY_FORM = {
  fecha: getMexicoDateString(),
  descripcion: '', monto: '', categoriaId: '', tipo: 'GASTO',
  quincenaId: '', notas: '',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function EntradasRapidasPage() {
  const { toast } = useToast()
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaFilter, setQuincenaFilter] = useState('')
  const [procesadoFilter, setProcesadoFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Entrada | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/quincenas').then(r => r.json()),
    ]).then(([cats, qs]) => {
      setCategorias(cats)
      setQuincenas(qs)
      setQuincenaFilter(getInitialQuincenaId(qs))
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaFilter(id)
    persistQuincenaId(id)
  }

  const fetchData = useCallback(async () => {
    if (!quincenaFilter) { setLoading(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (quincenaFilter) params.set('quincenaId', quincenaFilter)
      if (procesadoFilter) params.set('procesado', procesadoFilter)
      const res = await fetch(`/api/entradas-rapidas?${params}`)
      setEntradas(await res.json())
    } finally { setLoading(false) }
  }, [quincenaFilter, procesadoFilter])

  useEffect(() => { fetchData() }, [fetchData])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, quincenaId: quincenaFilter })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(e: Entrada) {
    setEditing(e)
    setForm({
      fecha: e.fecha.split('T')[0],
      descripcion: e.descripcion,
      monto: e.monto.toString(),
      categoriaId: e.categoriaId?.toString() ?? '',
      tipo: e.tipo ?? 'GASTO',
      quincenaId: e.quincenaId?.toString() ?? '',
      notas: e.notas ?? '',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.descripcion.trim()) errors.descripcion = 'Requerido'
    if (!form.monto || parseFloat(form.monto) <= 0) errors.monto = 'Monto inválido'
    if (!form.fecha) errors.fecha = 'Requerido'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        fecha: form.fecha,
        descripcion: form.descripcion.trim(),
        monto: form.monto,
        categoriaId: form.categoriaId || null,
        tipo: form.tipo || null,
        quincenaId: form.quincenaId || null,
        notas: form.notas || null,
      }
      const res = editing
        ? await fetch(`/api/entradas-rapidas/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/entradas-rapidas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error()
      toast(editing ? 'Entrada actualizada' : 'Entrada creada')
      setModalOpen(false)
      fetchData()
    } catch { toast('Error al guardar', 'error') } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (confirmId == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/entradas-rapidas/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Entrada eliminada')
      setConfirmId(null)
      fetchData()
    } catch { toast('Error al eliminar', 'error') } finally { setDeleting(false) }
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Conceptos Recurrentes</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gastos e ingresos frecuentes que se repiten cada quincena</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
          <Plus size={16} /> Nueva entrada
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex gap-3 flex-wrap">
        <select value={quincenaFilter} onChange={e => selectQuincena(e.target.value)} className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
          {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
        </select>
        <select value={procesadoFilter} onChange={e => setProcesadoFilter(e.target.value)} className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
          <option value="">Todos</option>
          <option value="false">Sin procesar</option>
          <option value="true">Procesados</option>
        </select>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : entradas.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Zap size={28} className="text-amber-400" />
            </div>
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin conceptos recurrentes</p>
            <p className="text-sm mt-1">Crea entradas rápidas para gastos o ingresos que se repiten</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Fecha</th>
                  <th className="text-left px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Descripción</th>
                  <th className="text-left px-3 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Categoría</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Monto</th>
                  <th className="text-center px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {entradas.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(e.fecha)}</td>
                    <td className="px-3 py-3.5 text-slate-800 dark:text-slate-100 font-medium">{e.descripcion}</td>
                    <td className="px-3 py-3.5 hidden md:table-cell">
                      {e.categoria && (
                        <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-medium px-2 py-0.5 rounded-full">{e.categoria.nombre}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold text-slate-800 dark:text-slate-100">{formatMXN(e.monto)}</td>
                    <td className="px-3 py-3.5 text-center">
                      {e.procesado
                        ? <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold px-2 py-0.5 rounded-full">Procesado</span>
                        : <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full">Pendiente</span>
                      }
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(e)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setConfirmId(e.id)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Editar entrada' : 'Nueva entrada'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="er-fecha">Fecha *</Label>
              <input id="er-fecha" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} className={fieldClass(formErrors.fecha)} />
              {formErrors.fecha && <p className="text-xs text-rose-500 mt-1">{formErrors.fecha}</p>}
            </div>
            <div>
              <Label htmlFor="er-tipo">Tipo</Label>
              <select id="er-tipo" value={form.tipo} onChange={e => set('tipo', e.target.value)} className={fieldClass()}>
                <option value="GASTO">Gasto</option>
                <option value="INGRESO">Ingreso</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="er-desc">Descripción *</Label>
            <input id="er-desc" type="text" placeholder="Ej: Netflix, Internet, etc." value={form.descripcion} onChange={e => set('descripcion', e.target.value)} className={fieldClass(formErrors.descripcion)} />
            {formErrors.descripcion && <p className="text-xs text-rose-500 mt-1">{formErrors.descripcion}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="er-monto">Monto *</Label>
              <input id="er-monto" type="number" min="0" step="0.01" placeholder="0.00" value={form.monto} onChange={e => set('monto', e.target.value)} className={fieldClass(formErrors.monto)} />
              {formErrors.monto && <p className="text-xs text-rose-500 mt-1">{formErrors.monto}</p>}
            </div>
            <div>
              <Label htmlFor="er-cat">Categoría</Label>
              <select id="er-cat" value={form.categoriaId} onChange={e => set('categoriaId', e.target.value)} className={fieldClass()}>
                <option value="">Sin categoría</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="er-q">Quincena</Label>
            <select id="er-q" value={form.quincenaId} onChange={e => set('quincenaId', e.target.value)} className={fieldClass()}>
              <option value="">Sin quincena</option>
              {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="er-notas">Notas</Label>
            <textarea id="er-notas" rows={2} placeholder="Notas adicionales (opcional)" value={form.notas} onChange={e => set('notas', e.target.value)} className={`${fieldClass()} resize-none`} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">
              {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={open => !open && setConfirmId(null)}
        title="Eliminar entrada"
        description="Esta acción no se puede deshacer. La entrada se eliminará permanentemente."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
