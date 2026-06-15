'use client'
import { useState, useEffect, useCallback } from 'react'
import { Pencil } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'

interface Categoria {
  id: number
  nombre: string
  tipo: string
  clasificacion: string | null
  ejemplos: string | null
  activo: boolean
}

const CAT_DOT: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function CategoriasConfigPage() {
  const { toast } = useToast()

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [form, setForm] = useState({ clasificacion: '', ejemplos: '', activo: true })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/categorias')
      setCategorias(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function openEdit(c: Categoria) {
    setEditing(c)
    setForm({
      clasificacion: c.clasificacion ?? '',
      ejemplos: c.ejemplos ?? '',
      activo: c.activo,
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.clasificacion) errors.clasificacion = 'Selecciona una clasificación'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/categorias/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clasificacion: form.clasificacion || null,
          ejemplos: form.ejemplos || null,
          activo: form.activo,
        }),
      })
      if (!res.ok) throw new Error()
      toast('Categoría actualizada')
      setModalOpen(false)
      fetchData()
    } catch {
      toast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Categorías</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Las 9 categorías oficiales del sistema</p>
      </div>

      {/* Aviso */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
        Las categorías son un catálogo cerrado. No se pueden agregar ni eliminar. Solo puedes editar la clasificación, ejemplos y estado.
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Categoría</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Clasificación</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Ejemplos</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Activo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {categorias.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CAT_DOT[c.nombre] ?? 'bg-slate-400'}`} />
                        {c.nombre}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.tipo === 'Gasto' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' :
                        c.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {c.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                      {c.clasificacion ?? <span className="text-slate-400 dark:text-slate-500 italic">Sin clasificar</span>}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 text-xs max-w-[250px] truncate hidden md:table-cell">
                      {c.ejemplos ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {c.activo
                        ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">Activo</span>
                        : <span className="text-slate-400 dark:text-slate-500 text-xs">Inactivo</span>
                      }
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors"
                        aria-label="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={`Editar — ${editing?.nombre ?? ''}`}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="cat-clas">Clasificación *</Label>
            <select id="cat-clas" value={form.clasificacion} onChange={e => set('clasificacion', e.target.value)} className={fieldClass(formErrors.clasificacion)}>
              <option value="">Sin clasificar</option>
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
            </select>
            {formErrors.clasificacion && <p className="text-xs text-rose-500 mt-1">{formErrors.clasificacion}</p>}
          </div>

          <div>
            <Label htmlFor="cat-ejemplos">Ejemplos</Label>
            <textarea
              id="cat-ejemplos"
              rows={3}
              placeholder="Ej: Renta, Agua, Luz..."
              value={form.ejemplos}
              onChange={e => set('ejemplos', e.target.value)}
              className={`${fieldClass()} resize-none`}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cat-activo"
              type="checkbox"
              checked={form.activo}
              onChange={e => set('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
            <Label htmlFor="cat-activo">Activo</Label>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </FormModal>
    </div>
  )
}
