'use client'
import { useState, useEffect, useCallback } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { getMonthRange } from '@/lib/periodo'

type TipoPeriodo = 'QUINCENAL' | 'SEMANAL' | 'MENSUAL'

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
  tipo: TipoPeriodo
}

interface Configuracion {
  id: number
  frecuenciaPagoDefault: TipoPeriodo
}

const TIPOS: TipoPeriodo[] = ['QUINCENAL', 'SEMANAL', 'MENSUAL']
const TIPO_LABEL: Record<string, string> = { QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', MENSUAL: 'Mensual' }
const TIPO_DOT: Record<string, string> = { QUINCENAL: 'bg-indigo-500', SEMANAL: 'bg-sky-500', MENSUAL: 'bg-amber-500' }

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Fechas sugeridas (nunca definitivas sin confirmar) para el siguiente periodo. */
function suggestNextPeriod(periodos: Quincena[], tipo: string) {
  const sorted = [...periodos].sort((a, b) => a.fechaFin.localeCompare(b.fechaFin))
  const last = sorted.at(-1)
  const inicio = last ? addDaysISO(last.fechaFin.slice(0, 10), 1) : getMexicoDateString()

  let fin: string
  if (tipo === 'SEMANAL') fin = addDaysISO(inicio, 6)
  else if (tipo === 'MENSUAL') fin = getMonthRange(inicio).hasta
  else fin = addDaysISO(inicio, 14) // QUINCENAL: ballpark, siempre editable

  let codigo = ''
  const m = last?.codigo.match(/^Q(\d+)$/)
  if (m && tipo === 'QUINCENAL') codigo = `Q${parseInt(m[1], 10) + 1}`

  return { codigo, fechaInicio: inicio, fechaFin: fin, tipo }
}

export default function QuincenasConfigPage() {
  const { toast } = useToast()
  const today = getMexicoDateString()

  const [periodos, setPeriodos] = useState<Quincena[]>([])
  const [config, setConfig] = useState<Configuracion>({ id: 1, frecuenciaPagoDefault: 'QUINCENAL' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Quincena | null>(null)
  const [form, setForm] = useState({ codigo: '', fechaInicio: '', fechaFin: '', tipo: 'QUINCENAL' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [warnings, setWarnings] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Quincena | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, cRes] = await Promise.all([fetch('/api/quincenas'), fetch('/api/configuracion')])
      setPeriodos(await pRes.json())
      setConfig(await cRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function openCreate() {
    setEditing(null)
    setForm(suggestNextPeriod(periodos, config.frecuenciaPagoDefault))
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(q: Quincena) {
    setEditing(q)
    setForm({ codigo: q.codigo, fechaInicio: q.fechaInicio.slice(0, 10), fechaFin: q.fechaFin.slice(0, 10), tipo: q.tipo })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.codigo.trim()) errors.codigo = 'Requerido'
    if (!form.fechaInicio) errors.fechaInicio = 'Requerido'
    if (!form.fechaFin) errors.fechaFin = 'Requerido'
    if (form.fechaInicio && form.fechaFin && form.fechaFin < form.fechaInicio) errors.fechaFin = 'Debe ser posterior al inicio'
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const payload = { codigo: form.codigo.trim(), fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, tipo: form.tipo }
      const res = editing
        ? await fetch(`/api/quincenas/${editing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/quincenas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      toast(editing ? 'Período actualizado' : 'Período creado')
      setModalOpen(false)
      setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
      fetchData()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/quincenas/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al eliminar')
      toast('Período eliminado')
      setDeleteTarget(null)
      fetchData()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleFrecuenciaChange(value: string) {
    setSavingConfig(true)
    try {
      const res = await fetch('/api/configuracion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frecuenciaPagoDefault: value }),
      })
      if (!res.ok) throw new Error()
      setConfig(c => ({ ...c, frecuenciaPagoDefault: value as TipoPeriodo }))
      toast('Frecuencia predeterminada actualizada')
    } catch {
      toast('Error al guardar', 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const sorted = [...periodos].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Períodos de pago</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Administra las fechas de cada quincena y la frecuencia de pago predeterminada</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors shrink-0"
        >
          <Plus size={16} /> Agregar período
        </button>
      </div>

      {/* Frecuencia predeterminada */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Frecuencia de pago predeterminada</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Solo define qué fechas se sugieren al agregar un período nuevo. No afecta los períodos ya creados.</p>
        </div>
        <select
          value={config.frecuenciaPagoDefault}
          onChange={e => handleFrecuenciaChange(e.target.value)}
          disabled={savingConfig}
          className={`${fieldClass()} w-auto min-w-[160px]`}
        >
          {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
      </div>

      {/* Avisos */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">Aviso</p>
            <button onClick={() => setWarnings([])} className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 text-xs cursor-pointer shrink-0">
              Cerrar
            </button>
          </div>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400 dark:text-slate-500 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <p className="text-5xl mb-3">🗓️</p>
            <p className="font-medium">Sin períodos registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Código</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Inicio</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Fin</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {sorted.map(q => {
                  const ini = q.fechaInicio.slice(0, 10)
                  const fin = q.fechaFin.slice(0, 10)
                  const isRunning = today >= ini && today <= fin
                  return (
                    <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-slate-800 dark:text-slate-100">{q.codigo}</td>
                      <td className="px-4 py-3.5">
                        <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${TIPO_DOT[q.tipo] ?? 'bg-slate-400'}`} />
                          {TIPO_LABEL[q.tipo] ?? q.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">{ini}</td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">{fin}</td>
                      <td className="px-4 py-3.5 text-center">
                        {isRunning
                          ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">Activa ahora</span>
                          : <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(q)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors"
                            aria-label="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(q)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors"
                            aria-label="Eliminar"
                          >
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
      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? `Editar — ${editing.codigo}` : 'Nuevo período'}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="q-codigo">Código *</Label>
            <input id="q-codigo" type="text" placeholder="Ej: Q43" value={form.codigo} onChange={e => set('codigo', e.target.value)} className={fieldClass(formErrors.codigo)} />
            {formErrors.codigo && <p className="text-xs text-rose-500 mt-1">{formErrors.codigo}</p>}
          </div>

          <div>
            <Label htmlFor="q-tipo">Tipo</Label>
            <select id="q-tipo" value={form.tipo} onChange={e => set('tipo', e.target.value)} className={fieldClass()}>
              {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="q-inicio">Inicio *</Label>
              <input id="q-inicio" type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} className={fieldClass(formErrors.fechaInicio)} />
              {formErrors.fechaInicio && <p className="text-xs text-rose-500 mt-1">{formErrors.fechaInicio}</p>}
            </div>
            <div>
              <Label htmlFor="q-fin">Fin *</Label>
              <input id="q-fin" type="date" value={form.fechaFin} onChange={e => set('fechaFin', e.target.value)} className={fieldClass(formErrors.fechaFin)} />
              {formErrors.fechaFin && <p className="text-xs text-rose-500 mt-1">{formErrors.fechaFin}</p>}
            </div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 -mt-2">
            Las fechas se sugieren según la frecuencia predeterminada, pero siempre puedes ajustarlas — las quincenas reales no tienen duración fija.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">
              {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear período'}
            </button>
          </div>
        </div>
      </FormModal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`Eliminar ${deleteTarget?.codigo ?? ''}`}
        description="Esta acción no se puede deshacer. Si el período tiene transacciones, presupuestos u otros registros asociados, no se podrá eliminar."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
