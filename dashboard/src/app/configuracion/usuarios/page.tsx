'use client'
import { useState, useEffect, useCallback } from 'react'
import { Pencil } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'

interface User {
  id: number
  nombre: string
  phoneWhatsapp: string | null
  activo: boolean
  fechaRegistro: string
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function UsuariosConfigPage() {
  const { toast } = useToast()

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState({ nombre: '', phoneWhatsapp: '', activo: true })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function openEdit(u: User) {
    setEditing(u)
    setForm({
      nombre: u.nombre,
      phoneWhatsapp: u.phoneWhatsapp ?? '',
      activo: u.activo,
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.nombre.trim()) errors.nombre = 'Requerido'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          phoneWhatsapp: form.phoneWhatsapp || null,
          activo: form.activo,
        }),
      })
      if (!res.ok) throw new Error()
      toast('Usuario actualizado')
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
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Usuarios</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Administrar usuarios del sistema</p>
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
        ) : users.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <p className="text-5xl mb-3">👤</p>
            <p className="font-medium">Sin usuarios registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Nombre</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">WhatsApp</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Registro</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-800 dark:text-slate-100">{u.nombre}</td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                      {u.phoneWhatsapp ?? <span className="text-slate-400 dark:text-slate-500 italic">Sin teléfono</span>}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {u.activo
                        ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">Activo</span>
                        : <span className="text-slate-400 dark:text-slate-500 text-xs">Inactivo</span>
                      }
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 hidden md:table-cell">{formatDate(u.fechaRegistro)}</td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => openEdit(u)}
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
            <Label htmlFor="u-nombre">Nombre *</Label>
            <input id="u-nombre" type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)} className={fieldClass(formErrors.nombre)} />
            {formErrors.nombre && <p className="text-xs text-rose-500 mt-1">{formErrors.nombre}</p>}
          </div>

          <div>
            <Label htmlFor="u-phone">Teléfono WhatsApp</Label>
            <input id="u-phone" type="text" placeholder="Ej: +521234567890" value={form.phoneWhatsapp} onChange={e => set('phoneWhatsapp', e.target.value)} className={fieldClass()} />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="u-activo"
              type="checkbox"
              checked={form.activo}
              onChange={e => set('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
            <Label htmlFor="u-activo">Activo</Label>
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
