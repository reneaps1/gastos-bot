'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import {
  CUENTA_ICONS, CUENTA_COLORS, DEFAULT_COLOR_KEY, DEFAULT_ICON_NAME,
  resolveCuentaColor, resolveCuentaIcon, TIPOS_CUENTA, TIPO_CUENTA_LABEL,
} from '@/lib/cuenta-icons'

interface Cuenta {
  id: number
  nombre: string
  tipo: string | null
  icono: string | null
  color: string | null
  activo: boolean
  orden: number
}

const EMPTY_FORM = { nombre: '', tipo: 'Debito' as string, icono: DEFAULT_ICON_NAME, color: DEFAULT_COLOR_KEY, activo: true, orden: '' }

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function CuentasConfigPage() {
  const { toast } = useToast()

  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Cuenta | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cuentas')
      setCuentas(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, orden: String(cuentas.length + 1) })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(c: Cuenta) {
    setEditing(c)
    setForm({
      nombre: c.nombre,
      tipo: c.tipo ?? 'Debito',
      icono: c.icono ?? DEFAULT_ICON_NAME,
      color: c.color ?? DEFAULT_COLOR_KEY,
      activo: c.activo,
      orden: c.orden.toString(),
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
    setSaving(true)
    try {
      const body = {
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        icono: form.icono,
        color: form.color,
        activo: form.activo,
        orden: form.orden || 0,
      }
      const res = editing
        ? await fetch(`/api/cuentas/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/cuentas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Error')
      }
      toast(editing ? 'Cuenta actualizada' : 'Cuenta creada')
      setModalOpen(false)
      fetchData()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      toast(msg === 'Cuenta already exists' ? 'Ya existe una cuenta con ese nombre' : msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (confirmId == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/cuentas/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Error al eliminar')
      }
      toast('Cuenta eliminada')
      setConfirmId(null)
      fetchData()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function toggleActivo(c: Cuenta) {
    try {
      const res = await fetch(`/api/cuentas/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !c.activo }),
      })
      if (!res.ok) throw new Error()
      fetchData()
    } catch {
      toast('Error al actualizar', 'error')
    }
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Cuentas</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Bancos, efectivo, vales e inversiones. Se usan como cuenta de pago de un crédito y como las líneas de un corte de liquidez.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors shrink-0"
        >
          <Plus size={16} /> Nueva cuenta
        </button>
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
        ) : cuentas.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Wallet size={28} className="text-blue-400" />
            </div>
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin cuentas configuradas</p>
            <p className="text-sm mt-1">Crea tu primera cuenta para usarla en cortes de liquidez y créditos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Cuenta</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {cuentas.map(c => {
                  const Icon = resolveCuentaIcon(c.icono)
                  const colorClasses = resolveCuentaColor(c.color)
                  return (
                    <tr key={c.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${!c.activo ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg ${colorClasses.badgeBg} flex items-center justify-center shrink-0`}>
                            <Icon size={16} className={colorClasses.iconText} />
                          </div>
                          <span className="font-medium text-slate-800 dark:text-slate-100">{c.nombre}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                        {c.tipo ? (TIPO_CUENTA_LABEL[c.tipo as keyof typeof TIPO_CUENTA_LABEL] ?? c.tipo) : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => toggleActivo(c)}
                          className={`text-xs font-semibold px-2 py-1 rounded-full cursor-pointer transition-colors ${
                            c.activo
                              ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                              : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600'
                          }`}
                        >
                          {c.activo ? 'Activa' : 'Inactiva'}
                        </button>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setConfirmId(c.id)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
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

      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Editar cuenta' : 'Nueva cuenta'}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="cu-nombre">Nombre *</Label>
            <input id="cu-nombre" type="text" placeholder="Ej: BBVA, Efectivo, Vales despensa..."
              value={form.nombre} onChange={e => set('nombre', e.target.value)} className={fieldClass(formErrors.nombre)} />
            {formErrors.nombre && <p className="text-xs text-rose-500 mt-1">{formErrors.nombre}</p>}
          </div>

          <div>
            <Label htmlFor="cu-tipo">Tipo</Label>
            <select id="cu-tipo" value={form.tipo} onChange={e => set('tipo', e.target.value)} className={fieldClass()}>
              {TIPOS_CUENTA.map(t => <option key={t} value={t}>{TIPO_CUENTA_LABEL[t]}</option>)}
            </select>
          </div>

          <div>
            <Label htmlFor="cu-icono">Icono</Label>
            <div id="cu-icono" className="flex flex-wrap gap-2">
              {CUENTA_ICONS.map(({ name, Icon }) => (
                <button key={name} type="button" onClick={() => set('icono', name)}
                  aria-label={name}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all ${
                    form.icono === name
                      ? `${resolveCuentaColor(form.color).badgeBg} ${resolveCuentaColor(form.color).iconText} ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-800`
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}>
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="cu-color">Color</Label>
            <div id="cu-color" className="flex flex-wrap gap-2">
              {CUENTA_COLORS.map(c => (
                <button key={c.key} type="button" onClick={() => set('color', c.key)}
                  className={`w-8 h-8 rounded-full ${c.swatch} cursor-pointer transition-all ${
                    form.color === c.key ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-800 scale-110' : 'hover:scale-105'
                  }`}
                  aria-label={c.key} />
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="cu-orden">Orden</Label>
            <input id="cu-orden" type="number" step="1" value={form.orden} onChange={e => set('orden', e.target.value)} className={fieldClass()} />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Controla el orden en que aparece en los formularios (menor primero)</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cu-activo"
              type="checkbox"
              checked={form.activo}
              onChange={e => set('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
            <Label htmlFor="cu-activo">Activa (aparece en cortes de liquidez y selectores de crédito)</Label>
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
        title="Eliminar cuenta"
        description="Esta acción no se puede deshacer. Solo se puede eliminar una cuenta sin créditos ni cortes de liquidez asociados; si ya tiene historial, desactívala en su lugar."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
