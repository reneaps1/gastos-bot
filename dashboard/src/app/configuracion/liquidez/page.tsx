'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Droplets } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Snapshot {
  id: number
  quincenaId: number
  bbva: number
  banamex: number
  uala: number
  ualaInversion: number
  efectivo: number
  valesDespensa: number
  valesGasolina: number
  faltaPagar: number
  teorico: number | null
  notas: string | null
  validado: boolean
  fechaCorte: string
  quincena: Quincena
}

const EMPTY_FORM = {
  quincenaId: '',
  fechaCorte: new Date().toISOString().split('T')[0],
  bbva: '',
  banamex: '',
  uala: '',
  ualaInversion: '',
  efectivo: '',
  valesDespensa: '',
  valesGasolina: '',
  faltaPagar: '',
  notas: '',
  validado: false,
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 mb-1">{children}</label>
}

function calcTeorico(f: typeof EMPTY_FORM) {
  const sum = ['bbva', 'banamex', 'uala', 'ualaInversion', 'efectivo', 'valesDespensa', 'valesGasolina']
    .reduce((s, k) => s + (parseFloat(f[k as keyof typeof f] as string) || 0), 0)
  const falta = parseFloat(f.faltaPagar) || 0
  return sum - falta
}

export default function LiquidezConfigPage() {
  const { toast } = useToast()

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [quincenaId, setQuincenaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Snapshot | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/quincenas').then(r => r.json()).then(setQuincenas)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (quincenaId) params.set('quincenaId', quincenaId)
      const res = await fetch(`/api/liquidez?${params}`)
      setSnapshots(await res.json())
    } finally {
      setLoading(false)
    }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, quincenaId })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(s: Snapshot) {
    setEditing(s)
    setForm({
      quincenaId: s.quincenaId.toString(),
      fechaCorte: s.fechaCorte.split('T')[0],
      bbva: s.bbva.toString(),
      banamex: s.banamex.toString(),
      uala: s.uala.toString(),
      ualaInversion: s.ualaInversion.toString(),
      efectivo: s.efectivo.toString(),
      valesDespensa: s.valesDespensa.toString(),
      valesGasolina: s.valesGasolina.toString(),
      faltaPagar: s.faltaPagar.toString(),
      notas: s.notas ?? '',
      validado: s.validado,
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.quincenaId) errors.quincenaId = 'Requerido'
    if (!form.fechaCorte) errors.fechaCorte = 'Requerido'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        quincenaId: form.quincenaId,
        fechaCorte: form.fechaCorte,
        bbva: form.bbva || '0',
        banamex: form.banamex || '0',
        uala: form.uala || '0',
        ualaInversion: form.ualaInversion || '0',
        efectivo: form.efectivo || '0',
        valesDespensa: form.valesDespensa || '0',
        valesGasolina: form.valesGasolina || '0',
        faltaPagar: form.faltaPagar || '0',
        teorico: calcTeorico(form).toString(),
        notas: form.notas || null,
        validado: form.validado,
      }
      const res = editing
        ? await fetch(`/api/liquidez/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/liquidez', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error()
      toast(editing ? 'Snapshot actualizado' : 'Snapshot creado')
      setModalOpen(false)
      fetchData()
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
      const res = await fetch(`/api/liquidez/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Snapshot eliminado')
      setConfirmId(null)
      fetchData()
    } catch {
      toast('Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Liquidez</h2>
          <p className="text-sm text-slate-500 mt-1">Snapshots de caja por quincena</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
        >
          <Plus size={16} />
          Nuevo snapshot
        </button>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <select
          value={quincenaId}
          onChange={e => setQuincenaId(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
        >
          <option value="">Todas las quincenas</option>
          {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 flex items-center justify-center">
              <Droplets size={28} className="text-blue-400" />
            </div>
            <p className="font-medium text-slate-600">Sin snapshots de liquidez</p>
            <p className="text-sm mt-1">Crea un snapshot para registrar el estado de tus cuentas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Quincena</th>
                  <th className="text-right px-3 py-3 text-slate-500 font-medium">BBVA</th>
                  <th className="text-right px-3 py-3 text-slate-500 font-medium hidden md:table-cell">Banamex</th>
                  <th className="text-right px-3 py-3 text-slate-500 font-medium hidden lg:table-cell">Ualá</th>
                  <th className="text-right px-3 py-3 text-slate-500 font-medium">Efectivo</th>
                  <th className="text-right px-3 py-3 text-slate-500 font-medium">Teórico</th>
                  <th className="text-center px-3 py-3 text-slate-500 font-medium">Validado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {snapshots.map(s => {
                  const total = s.bbva + s.banamex + s.uala + s.ualaInversion + s.efectivo + s.valesDespensa + s.valesGasolina
                  const teorico = s.teorico ?? (total - s.faltaPagar)
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3.5">
                        <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                          {s.quincena.codigo}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right text-slate-700">{formatMXN(s.bbva)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700 hidden md:table-cell">{formatMXN(s.banamex)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700 hidden lg:table-cell">{formatMXN(s.uala)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700">{formatMXN(s.efectivo)}</td>
                      <td className="px-3 py-3.5 text-right font-semibold text-slate-800">{formatMXN(teorico)}</td>
                      <td className="px-3 py-3.5 text-center">
                        {s.validado
                          ? <span className="text-emerald-600 text-xs font-semibold">✓</span>
                          : <span className="text-slate-300 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setConfirmId(s.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
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

      {/* Modal */}
      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Editar snapshot' : 'Nuevo snapshot'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lq-quincena">Quincena *</Label>
              <select id="lq-quincena" value={form.quincenaId} onChange={e => set('quincenaId', e.target.value)} className={fieldClass(formErrors.quincenaId)}>
                <option value="">Seleccionar...</option>
                {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </select>
              {formErrors.quincenaId && <p className="text-xs text-rose-500 mt-1">{formErrors.quincenaId}</p>}
            </div>
            <div>
              <Label htmlFor="lq-fecha">Fecha de corte *</Label>
              <input id="lq-fecha" type="date" value={form.fechaCorte} onChange={e => set('fechaCorte', e.target.value)} className={fieldClass(formErrors.fechaCorte)} />
              {formErrors.fechaCorte && <p className="text-xs text-rose-500 mt-1">{formErrors.fechaCorte}</p>}
            </div>
          </div>

          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cuentas</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lq-bbva">BBVA</Label>
              <input id="lq-bbva" type="number" min="0" step="0.01" placeholder="0.00" value={form.bbva} onChange={e => set('bbva', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-banamex">Banamex</Label>
              <input id="lq-banamex" type="number" min="0" step="0.01" placeholder="0.00" value={form.banamex} onChange={e => set('banamex', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-uala">Ualá</Label>
              <input id="lq-uala" type="number" min="0" step="0.01" placeholder="0.00" value={form.uala} onChange={e => set('uala', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-uinv">Ualá Inversión</Label>
              <input id="lq-uinv" type="number" min="0" step="0.01" placeholder="0.00" value={form.ualaInversion} onChange={e => set('ualaInversion', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-efec">Efectivo</Label>
              <input id="lq-efec" type="number" min="0" step="0.01" placeholder="0.00" value={form.efectivo} onChange={e => set('efectivo', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-vd">Vales despensa</Label>
              <input id="lq-vd" type="number" min="0" step="0.01" placeholder="0.00" value={form.valesDespensa} onChange={e => set('valesDespensa', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-vg">Vales gasolina</Label>
              <input id="lq-vg" type="number" min="0" step="0.01" placeholder="0.00" value={form.valesGasolina} onChange={e => set('valesGasolina', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-fp">Falta por pagar</Label>
              <input id="lq-fp" type="number" min="0" step="0.01" placeholder="0.00" value={form.faltaPagar} onChange={e => set('faltaPagar', e.target.value)} className={fieldClass()} />
            </div>
          </div>

          {/* Teórico calculado */}
          <div className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm text-slate-600 font-medium">Teórico calculado</span>
            <span className="text-lg font-bold text-slate-800">{formatMXN(calcTeorico(form))}</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="lq-validado"
              type="checkbox"
              checked={form.validado}
              onChange={e => set('validado', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <Label htmlFor="lq-validado">Validado</Label>
          </div>

          <div>
            <Label htmlFor="lq-notas">Notas</Label>
            <textarea id="lq-notas" rows={2} placeholder="Notas adicionales (opcional)" value={form.notas} onChange={e => set('notas', e.target.value)} className={`${fieldClass()} resize-none`} />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
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
        title="Eliminar snapshot"
        description="Esta acción no se puede deshacer. El snapshot se eliminará permanentemente."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
