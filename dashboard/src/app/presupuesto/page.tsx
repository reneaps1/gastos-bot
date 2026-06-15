'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Copy, Zap, Repeat, ChevronDown, CalendarClock } from 'lucide-react'
import { formatMXN, formatDateStr } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { getInitialQuincenaId, persistQuincenaId } from '@/lib/quincena-selection'

const CAT_DOT: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string }
interface Presupuesto {
  id: number; descripcion: string; montoPresupuestado: number; clasificacion: string | null
  tipo: string; notas: string | null; quincenaId: number; categoriaId: number
  recurrente: boolean; frecuencia: string | null; recurrenciaGrupoId: string | null; diaCobro: number | null
  categoria: Categoria; quincena: Quincena; real: number; pct: number
}
interface EntradaRapida {
  id: number; descripcion: string; monto: number; tipo: string | null
  categoriaId: number | null; categoria: { nombre: string } | null; procesado: boolean
}

const EMPTY_FORM = {
  categoriaId: '', descripcion: '', tipo: 'Gasto',
  montoPresupuestado: '', clasificacion: '', notas: '',
  recurrente: false, frecuencia: 'CADA_QUINCENA',
  terminaCon: 'sin_fin' as 'sin_fin' | 'n_ocurrencias',
  numOcurrencias: '6',
  diaCobro: '',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

function pctColor(pct: number) {
  return pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
}
function pctTextColor(pct: number) {
  return pct > 90 ? 'text-rose-600 dark:text-rose-400' : pct > 70 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
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

  const [entradasRapidas, setEntradasRapidas] = useState<EntradaRapida[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingP, setEditingP] = useState<Presupuesto | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
    ]).then(([q, c]) => {
      setQuincenas(q)
      setCategorias(c)
      setQuincenaId(getInitialQuincenaId(q))
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
  }

  const fetchPresupuestos = useCallback(async () => {
    if (!quincenaId) return
    setLoading(true)
    try {
      const [presupRes, entradasRes] = await Promise.all([
        fetch(`/api/presupuestos?quincenaId=${quincenaId}`),
        fetch(`/api/entradas-rapidas?quincenaId=${quincenaId}`),
      ])
      const data: Presupuesto[] = await presupRes.json()
      const entradas: EntradaRapida[] = await entradasRes.json()
      setPresupuestos(data)
      setEntradasRapidas(entradas)
      setQuincenaActual(data[0]?.quincena ?? quincenas.find(q => q.id.toString() === quincenaId) ?? null)
    } finally { setLoading(false) }
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
      categoriaId: p.categoriaId.toString(), descripcion: p.descripcion,
      tipo: p.tipo, montoPresupuestado: p.montoPresupuestado.toString(),
      clasificacion: p.clasificacion ?? '', notas: p.notas ?? '',
      recurrente: false, frecuencia: 'CADA_QUINCENA',
      terminaCon: 'sin_fin', numOcurrencias: '6',
      diaCobro: p.diaCobro?.toString() ?? '',
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
        quincenaId, categoriaId: form.categoriaId, descripcion: form.descripcion.trim(),
        tipo: form.tipo, montoPresupuestado: form.montoPresupuestado,
        clasificacion: form.clasificacion || null, notas: form.notas || null,
        recurrente: form.recurrente,
        frecuencia: form.recurrente ? form.frecuencia : null,
        numOcurrencias: form.recurrente && form.terminaCon === 'n_ocurrencias'
          ? parseInt(form.numOcurrencias) || null
          : null,
        diaCobro: form.recurrente && form.diaCobro ? parseInt(form.diaCobro) : null,
      }
      const res = editingP
        ? await fetch(`/api/presupuestos/${editingP.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/presupuestos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await res.text())
      const msg = editingP
        ? 'Presupuesto actualizado'
        : form.recurrente
          ? `Partida recurrente creada en ${form.terminaCon === 'n_ocurrencias' ? form.numOcurrencias : 'todas las'} quincenas`
          : 'Presupuesto creado'
      toast(msg)
      setModalOpen(false)
      fetchPresupuestos()
    } catch { toast('Error al guardar', 'error') } finally { setSaving(false) }
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
    } catch { toast('Error al eliminar', 'error') } finally { setDeleting(false) }
  }

  async function handleCopiar() {
    const idx = quincenas.findIndex(q => q.id.toString() === quincenaId)
    if (idx < 0 || idx >= quincenas.length - 1) { toast('No hay quincena anterior disponible', 'error'); return }
    const prevQ = quincenas[idx + 1]
    setCopying(true)
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${prevQ.id}`)
      const prev: Presupuesto[] = await res.json()
      if (prev.length === 0) { toast('La quincena anterior no tiene presupuesto', 'error'); return }
      await Promise.all(prev.map(p =>
        fetch('/api/presupuestos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quincenaId, categoriaId: p.categoriaId.toString(), descripcion: p.descripcion,
            tipo: p.tipo, montoPresupuestado: p.montoPresupuestado.toString(),
            clasificacion: p.clasificacion, notas: p.notas,
          }),
        })
      ))
      toast(`${prev.length} presupuestos copiados de ${prevQ.codigo}`)
      fetchPresupuestos()
    } catch { toast('Error al copiar presupuestos', 'error') } finally { setCopying(false) }
  }

  const totalPresupuestado = presupuestos.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
  const totalGastado = presupuestos.reduce((s, p) => s + p.real, 0)
  const pctGlobal = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0

  const entradasPorCategoria = entradasRapidas.reduce((acc, e) => {
    const catId = e.categoriaId
    if (catId) {
      if (!acc[catId]) acc[catId] = { total: 0, count: 0 }
      acc[catId].total += Number(e.monto)
      acc[catId].count++
    }
    return acc
  }, {} as Record<number, { total: number; count: number }>)

  const totalRecurrente = entradasRapidas.reduce((s, e) => s + Number(e.monto), 0)

  const qInfo = quincenaActual ?? quincenas.find(q => q.id.toString() === quincenaId)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Presupuesto</h2>
          {qInfo && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {qInfo.codigo} · {formatDateStr(qInfo.fechaInicio, { day: '2-digit', month: 'long' })}
              {' — '}
              {formatDateStr(qInfo.fechaFin, { day: '2-digit', month: 'long' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select value={quincenaId} onChange={e => selectQuincena(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer">
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
          {presupuestos.length === 0 && !loading && (
            <button onClick={handleCopiar} disabled={copying}
              className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
              <Copy size={14} />
              {copying ? 'Copiando...' : 'Copiar anterior'}
            </button>
          )}
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {presupuestos.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Progreso global</p>
            <div className="flex justify-between items-end mb-2">
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                {formatMXN(totalGastado)}
                <span className="text-slate-400 dark:text-slate-500 font-normal text-base"> / {formatMXN(totalPresupuestado)}</span>
              </p>
              <span className={`text-lg font-bold ${pctTextColor(pctGlobal)}`}>{pctGlobal.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3">
              <div className={`h-3 rounded-full transition-all ${pctColor(pctGlobal)}`} style={{ width: `${Math.min(pctGlobal, 100)}%` }} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Repeat size={14} className="text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Recurrentes</p>
            </div>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(totalRecurrente)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{entradasRapidas.length} conceptos configurados</p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Restante</p>
            <p className={`text-2xl font-bold tabular-nums ${totalPresupuestado - totalGastado >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatMXN(totalPresupuestado - totalGastado)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {pctGlobal > 90 ? 'Cuidado: casi agotado' : pctGlobal > 70 ? 'Va bien, pero vigilante' : 'Suficiente para la quincena'}
            </p>
          </div>
        </div>
      )}

      {/* Per-category */}
      {loading ? (
        <PresupuestoSkeleton />
      ) : presupuestos.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Copy size={28} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin presupuesto configurado</p>
          <p className="text-sm mt-1">Crea un presupuesto o copia el de la quincena anterior</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {presupuestos.map(p => {
            const recurrence = entradasPorCategoria[p.categoriaId]
            return (
              <div key={p.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{p.descripcion}</p>
                        {p.recurrente && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                            <Repeat size={9} />
                            {p.frecuencia === 'MENSUAL'
                              ? p.diaCobro ? `mensual · día ${p.diaCobro}` : 'mensual'
                              : 'quincenal'}
                          </span>
                        )}
                        {recurrence && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                            <Zap size={10} /> entrada rápida
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {p.categoria.nombre}{p.clasificacion && ` · ${p.clasificacion}`}
                        </p>
                        {p.diaCobro && (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${p.diaCobro <= 15 ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>
                            <CalendarClock size={10} />
                            día {p.diaCobro}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(p.real)}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">de {formatMXN(Number(p.montoPresupuestado))}</p>
                    </div>
                    <button onClick={() => openEdit(p)}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setConfirmId(p.id)}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${pctColor(p.pct)}`} style={{ width: `${Math.min(p.pct, 100)}%` }} />
                  </div>
                  <span className={`text-xs font-semibold w-10 text-right tabular-nums ${pctTextColor(p.pct)}`}>
                    {p.pct.toFixed(0)}%
                  </span>
                </div>
                {recurrence && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Repeat size={11} className="text-amber-500" />
                    {recurrence.count} {recurrence.count === 1 ? 'concepto' : 'conceptos'} recurrente{recurrence.count > 1 ? 's' : ''} · {formatMXN(recurrence.total)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editingP ? 'Editar presupuesto' : 'Nuevo presupuesto'}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="p-cat">Categoría *</Label>
            <select id="p-cat" value={form.categoriaId} onChange={e => setForm(f => ({ ...f, categoriaId: e.target.value }))} className={fieldClass(formErrors.categoriaId)}>
              <option value="">Seleccionar...</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {formErrors.categoriaId && <p className="text-xs text-rose-500 mt-1">{formErrors.categoriaId}</p>}
          </div>
          <div>
            <Label htmlFor="p-desc">Descripción *</Label>
            <input id="p-desc" type="text" placeholder="Ej: Renta, Súper quincenal..." value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={fieldClass(formErrors.descripcion)} />
            {formErrors.descripcion && <p className="text-xs text-rose-500 mt-1">{formErrors.descripcion}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="p-monto">Monto (MXN) *</Label>
              <input id="p-monto" type="number" min="0" step="0.01" placeholder="0.00" value={form.montoPresupuestado}
                onChange={e => setForm(f => ({ ...f, montoPresupuestado: e.target.value }))} className={fieldClass(formErrors.montoPresupuestado)} />
              {formErrors.montoPresupuestado && <p className="text-xs text-rose-500 mt-1">{formErrors.montoPresupuestado}</p>}
            </div>
            <div>
              <label htmlFor="p-diacobro" className="flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                <CalendarClock size={11} />
                Vence el día
              </label>
              <div className="relative">
                <input id="p-diacobro" type="number" min="1" max="31" placeholder="—"
                  value={form.diaCobro}
                  onChange={e => setForm(f => ({ ...f, diaCobro: e.target.value }))}
                  className={`${fieldClass()} pr-7 text-center`} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">/{31}</span>
              </div>
              {(() => {
                const d = parseInt(form.diaCobro)
                if (!form.diaCobro || isNaN(d)) return (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Opcional — sin fecha específica</p>
                )
                if (d < 1 || d > 31) return (
                  <p className="text-[11px] text-rose-500 mt-1">Debe ser entre 1 y 31</p>
                )
                const esQ1 = d <= 15
                return (
                  <p className={`text-[11px] mt-1 flex items-center gap-1 font-medium ${esQ1 ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>
                    <CalendarClock size={10} />
                    {esQ1 ? `Cae en 1ª quincena (días 1–15)` : `Cae en 2ª quincena (días 16–fin)`}
                  </p>
                )
              })()}
            </div>
          </div>
          <div>
            <Label htmlFor="p-clasificacion">Clasificación</Label>
            <select id="p-clasificacion" value={form.clasificacion} onChange={e => setForm(f => ({ ...f, clasificacion: e.target.value }))} className={fieldClass()}>
              <option value="">Sin clasificar</option>
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
            </select>
          </div>
          <div>
            <Label htmlFor="p-notas">Notas</Label>
            <textarea id="p-notas" rows={2} placeholder="Notas adicionales (opcional)" value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} className={`${fieldClass()} resize-none`} />
          </div>

          {/* Recurrence section — hidden when editing an existing item */}
          {!editingP && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, recurrente: !f.recurrente }))}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
                aria-expanded={form.recurrente}
              >
                <div className="flex items-center gap-2.5">
                  <Repeat size={15} className={form.recurrente ? 'text-indigo-500' : 'text-slate-400 dark:text-slate-500'} />
                  <span className={`text-sm font-medium ${form.recurrente ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`}>
                    Repetir esta partida
                  </span>
                  {form.recurrente && (
                    <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                      Activo
                    </span>
                  )}
                </div>
                <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${form.recurrente ? 'rotate-180' : ''}`} />
              </button>

              {form.recurrente && (
                <div className="px-4 py-4 space-y-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/20">
                  {/* Frequency pills */}
                  <div>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Frecuencia</p>
                    <div className="flex gap-2">
                      {[
                        { value: 'CADA_QUINCENA', label: 'Cada quincena', hint: 'cada 15 días' },
                        { value: 'MENSUAL', label: 'Mensual', hint: 'día 1 de cada mes' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, frecuencia: opt.value }))}
                          className={`flex-1 flex flex-col items-center py-2.5 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer ${
                            form.frecuencia === opt.value
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/20'
                          }`}
                        >
                          <span>{opt.label}</span>
                          <span className={`text-[10px] mt-0.5 ${form.frecuencia === opt.value ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>{opt.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Day of charge — only for monthly */}
                  {form.frecuencia === 'MENSUAL' && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                        Día de cobro <span className="font-normal text-slate-400">(opcional)</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="1" max="31" placeholder="—"
                          value={form.diaCobro}
                          onChange={e => setForm(f => ({ ...f, diaCobro: e.target.value }))}
                          className="w-16 text-center border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <span className="text-sm text-slate-500 dark:text-slate-400">del mes</span>
                        {form.diaCobro && parseInt(form.diaCobro) >= 1 && parseInt(form.diaCobro) <= 31 && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${parseInt(form.diaCobro) <= 15 ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'}`}>
                            {parseInt(form.diaCobro) <= 15 ? '→ 1ª quincena' : '→ 2ª quincena'}
                          </span>
                        )}
                      </div>
                      {!form.diaCobro && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Sin día especificado → se asigna a la 1ª quincena del mes</p>
                      )}
                    </div>
                  )}

                  {/* End condition */}
                  <div>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Termina</p>
                    <div className="space-y-2.5">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="radio" name="termina" value="sin_fin"
                          checked={form.terminaCon === 'sin_fin'}
                          onChange={() => setForm(f => ({ ...f, terminaCon: 'sin_fin' }))}
                          className="accent-indigo-600 w-4 h-4"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Sin fin</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">(todas las quincenas futuras)</span>
                      </label>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="radio" name="termina" value="n_ocurrencias"
                          checked={form.terminaCon === 'n_ocurrencias'}
                          onChange={() => setForm(f => ({ ...f, terminaCon: 'n_ocurrencias' }))}
                          className="accent-indigo-600 w-4 h-4"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Después de</span>
                        <input
                          type="number" min="1" max="52"
                          value={form.numOcurrencias}
                          onChange={e => setForm(f => ({ ...f, numOcurrencias: e.target.value, terminaCon: 'n_ocurrencias' }))}
                          onClick={() => setForm(f => ({ ...f, terminaCon: 'n_ocurrencias' }))}
                          className="w-14 text-center border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {form.frecuencia === 'MENSUAL' ? 'meses' : 'quincenas'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-lg px-3 py-2.5 text-xs text-indigo-700 dark:text-indigo-300">
                    <Repeat size={11} className="inline mr-1.5 mb-0.5" />
                    Se creará en{' '}
                    {form.terminaCon === 'n_ocurrencias'
                      ? `${form.numOcurrencias} ${form.frecuencia === 'MENSUAL' ? 'meses' : 'quincenas'}`
                      : 'todas las quincenas futuras disponibles'
                    }
                    {form.frecuencia === 'MENSUAL' ? ', solo primera quincena del mes' : ''}.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px] transition-colors">
              {saving ? 'Guardando...' : editingP ? 'Guardar cambios' : form.recurrente ? 'Crear recurrente' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      <ConfirmDialog open={confirmId != null} onOpenChange={open => !open && setConfirmId(null)}
        title="Eliminar presupuesto" description="Se eliminará este presupuesto. El historial de transacciones no se verá afectado."
        onConfirm={handleDelete} loading={deleting} />
    </div>
  )
}

function PresupuestoSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex justify-between mb-2">
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-slate-100 dark:bg-slate-700" /><div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-32" /></div>
            <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-20" />
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full" />
        </div>
      ))}
    </div>
  )
}
