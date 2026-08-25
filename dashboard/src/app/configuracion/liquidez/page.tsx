'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Pencil, Trash2, Droplets, Wallet, Clock, TrendingUp, TrendingDown } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { KpiCard } from '@/components/ui/KpiCard'
import { getInitialQuincenaId, getMexicoDateString, persistQuincenaId } from '@/lib/quincena-selection'
import { sumLiquidez, normalizeMontos } from '@/lib/liquidez'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'

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
  otros: number
  otrosNota: string | null
  faltaPagar: number
  teorico: number | null
  notas: string | null
  validado: boolean
  fechaCorte: string
  quincena: Quincena
}

const EMPTY_FORM = {
  quincenaId: '',
  fechaCorte: getMexicoDateString(),
  bbva: '',
  banamex: '',
  uala: '',
  ualaInversion: '',
  efectivo: '',
  valesDespensa: '',
  valesGasolina: '',
  otros: '',
  otrosNota: '',
  faltaPagar: '',
  notas: '',
  validado: false,
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

function calcTeorico(f: typeof EMPTY_FORM) {
  const sum = ['bbva', 'banamex', 'uala', 'ualaInversion', 'efectivo', 'valesDespensa', 'valesGasolina', 'otros']
    .reduce((s, k) => s + (parseFloat(f[k as keyof typeof f] as string) || 0), 0)
  const falta = parseFloat(f.faltaPagar) || 0
  return sum - falta
}

function LiquidezConfigContent() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const quincenaIdParam = searchParams.get('quincenaId')

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
  const [faltaLoading, setFaltaLoading] = useState(false)

  useEffect(() => {
    fetch('/api/quincenas').then(r => r.json()).then((data: Quincena[]) => {
      setQuincenas(data)
      const fromUrl = quincenaIdParam && data.some(q => q.id.toString() === quincenaIdParam) ? quincenaIdParam : null
      setQuincenaId(fromUrl ?? getInitialQuincenaId(data))
    })
    // Solo al montar: la seleccion via URL define el estado inicial, no debe reaplicarse en cada cambio de quincenaIdParam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
  }

  const fetchData = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (quincenaId) params.set('quincenaId', quincenaId)
      const res = await fetch(`/api/liquidez?${params}`)
      const data: Snapshot[] = await res.json()
      setSnapshots(data.map(s => ({
        ...s,
        ...normalizeMontos(s),
        faltaPagar: Number(s.faltaPagar) || 0,
        teorico: s.teorico != null ? Number(s.teorico) : null,
      })))
    } finally {
      setLoading(false)
    }
  }, [quincenaId])

  useEffect(() => { fetchData() }, [fetchData])

  // "Falta por pagar" de una quincena = misma formula que Presupuesto/Dashboard
  // (lib/presupuesto-totales.calcularFaltaPorPagar), para que el snapshot de
  // liquidez no quede desincronizado con el presupuesto real.
  async function fetchFaltaPorPagar(qId: string): Promise<number | null> {
    if (!qId) return null
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${qId}`)
      if (!res.ok) return null
      const data = await res.json()
      if (!Array.isArray(data)) return null
      return calcularFaltaPorPagar(data)
    } catch {
      return null
    }
  }

  async function applyQuincena(qId: string) {
    setForm(f => ({ ...f, quincenaId: qId }))
    if (!qId) return
    setFaltaLoading(true)
    const falta = await fetchFaltaPorPagar(qId)
    setFaltaLoading(false)
    if (falta != null) setForm(f => ({ ...f, faltaPagar: falta.toString() }))
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, quincenaId })
    setFormErrors({})
    setModalOpen(true)
    if (quincenaId) applyQuincena(quincenaId)
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
      otros: s.otros.toString(),
      otrosNota: s.otrosNota ?? '',
      faltaPagar: s.faltaPagar.toString(),
      notas: s.notas ?? '',
      validado: s.validado,
    })
    setFormErrors({})
    setModalOpen(true)
    applyQuincena(s.quincenaId.toString())
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
        otros: form.otros || '0',
        otrosNota: form.otrosNota || null,
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

  // La API ordena por fechaCorte desc, asi que el primero es el corte mas
  // reciente de la quincena seleccionada.
  const latestSnapshot = snapshots[0] ?? null
  const totalLiquido = latestSnapshot ? sumLiquidez(latestSnapshot) : 0
  const faltaPagarLatest = latestSnapshot?.faltaPagar ?? 0
  const deltaLiquido = totalLiquido - faltaPagarLatest

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Liquidez</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Snapshots de caja por quincena</p>
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
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <select
          value={quincenaId}
          onChange={e => selectQuincena(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
        >
          {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
        </select>
      </div>

      {/* Analítica: líquido vs falta por pagar del corte más reciente */}
      {!loading && latestSnapshot && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            label="Total líquido" value={formatMXN(totalLiquido)}
            subtitle={`corte ${formatDate(latestSnapshot.fechaCorte)}`}
            icon={<Wallet size={20} className="text-blue-600 dark:text-blue-300" />}
            color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
          />
          <KpiCard
            label="Falta por pagar" value={formatMXN(faltaPagarLatest)}
            icon={<Clock size={20} className="text-amber-600 dark:text-amber-300" />}
            color="text-amber-600 dark:text-amber-400" bg="bg-amber-50 dark:bg-amber-950/50 dark:ring-1 dark:ring-amber-800/50"
          />
          <KpiCard
            label="Delta (líquido neto)" value={formatMXN(deltaLiquido)}
            subtitle={deltaLiquido < 0 ? 'te falta cubrir' : 'te queda libre'}
            icon={deltaLiquido < 0 ? <TrendingDown size={20} className="text-rose-600 dark:text-rose-300" /> : <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
            color={deltaLiquido < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
            bg={deltaLiquido < 0 ? 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50' : 'bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50'}
          />
        </div>
      )}

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
        ) : snapshots.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Droplets size={28} className="text-blue-400" />
            </div>
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin snapshots de liquidez</p>
            <p className="text-sm mt-1">Crea un snapshot para registrar el estado de tus cuentas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Quincena</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">BBVA</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium hidden md:table-cell">Banamex</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium hidden lg:table-cell">Ualá</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Efectivo</th>
                  <th className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Teórico</th>
                  <th className="text-center px-3 py-3 text-slate-500 dark:text-slate-400 font-medium">Validado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {snapshots.map(s => {
                  const total = sumLiquidez(s)
                  const teorico = s.teorico ?? (total - s.faltaPagar)
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-4 py-3.5">
                        <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                          {s.quincena.codigo}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right text-slate-700 dark:text-slate-300">{formatMXN(s.bbva)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700 dark:text-slate-300 hidden md:table-cell">{formatMXN(s.banamex)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700 dark:text-slate-300 hidden lg:table-cell">{formatMXN(s.uala)}</td>
                      <td className="px-3 py-3.5 text-right text-slate-700 dark:text-slate-300">{formatMXN(s.efectivo)}</td>
                      <td className="px-3 py-3.5 text-right font-semibold text-slate-800 dark:text-slate-100">
                        {formatMXN(teorico)}
                        {s.otros > 0 && (
                          <span
                            className="ml-1 text-[10px] text-slate-400 dark:text-slate-500 cursor-help"
                            title={`Incluye Otros: ${formatMXN(s.otros)}${s.otrosNota ? ` — ${s.otrosNota}` : ''}`}
                          >
                            ⓘ
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {s.validado
                          ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">✓</span>
                          : <span className="text-slate-300 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setConfirmId(s.id)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
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
              <select id="lq-quincena" value={form.quincenaId} onChange={e => applyQuincena(e.target.value)} className={fieldClass(formErrors.quincenaId)}>
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

          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Cuentas</p>
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
              <Label htmlFor="lq-otros">Otros</Label>
              <input id="lq-otros" type="number" min="0" step="0.01" placeholder="0.00" value={form.otros} onChange={e => set('otros', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-otros-nota">¿Qué es &quot;Otros&quot;?</Label>
              <input id="lq-otros-nota" type="text" placeholder="Ej. Efectivo en caja chica" value={form.otrosNota} onChange={e => set('otrosNota', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="lq-fp">
                Falta por pagar
                {faltaLoading && <span className="ml-1 text-slate-400 dark:text-slate-500 normal-case font-normal">(calculando...)</span>}
              </Label>
              <input id="lq-fp" type="number" min="0" step="0.01" placeholder="0.00" value={form.faltaPagar} onChange={e => set('faltaPagar', e.target.value)} className={fieldClass()} />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Auto-calculado del presupuesto de la quincena; puedes ajustarlo si hace falta.</p>
            </div>
          </div>

          {/* Teórico calculado */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Teórico calculado</span>
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatMXN(calcTeorico(form))}</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="lq-validado"
              type="checkbox"
              checked={form.validado}
              onChange={e => set('validado', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
            <Label htmlFor="lq-validado">Validado</Label>
          </div>

          <div>
            <Label htmlFor="lq-notas">Notas</Label>
            <textarea id="lq-notas" rows={2} placeholder="Notas adicionales (opcional)" value={form.notas} onChange={e => set('notas', e.target.value)} className={`${fieldClass()} resize-none`} />
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
        title="Eliminar snapshot"
        description="Esta acción no se puede deshacer. El snapshot se eliminará permanentemente."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}

export default function LiquidezConfigPage() {
  return (
    <Suspense fallback={null}>
      <LiquidezConfigContent />
    </Suspense>
  )
}
