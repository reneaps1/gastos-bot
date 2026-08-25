'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Copy, Repeat, ChevronDown, ChevronRight, ChevronUp, CalendarClock, AlertTriangle, Loader2, Download, Search, X, LayoutGrid, Table2, Droplets, TrendingUp, TrendingDown, Scale } from 'lucide-react'
import { ReporteButton } from '@/components/ReporteButton'
import { formatMXN, formatDateStr } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { getInitialQuincenaId, getDefaultQuincenaId, getMexicoDateString, persistQuincenaId, getQuincenaIdForDate, formatQuincenaRange } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { KpiCard } from '@/components/ui/KpiCard'
import { toCsv, downloadCsv } from '@/lib/csv'
import { QuincenaChips, ALL_QUINCENAS } from '@/components/ui/QuincenaChips'
import { FilterChip } from '@/components/ui/FilterChip'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'
import { sumLiquidez, normalizeMontos, type LiquidezMontos } from '@/lib/liquidez'
import { DetalleGastoContent } from '@/components/ui/DetalleGastoModal'

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
  recurrente: boolean; frecuencia: string | null; recurrenciaGrupoId: string | null
  numOcurrencias: number | null; diaCobro: number | null; fechaVencimiento: string | null
  categoria: Categoria; quincena: Quincena; real: number; pendiente: number; pct: number; categoriaTotal: number; excedido: number
}

function groupKey(p: Pick<Presupuesto, 'quincenaId' | 'categoriaId'>) {
  return `${p.quincenaId}-${p.categoriaId}`
}

interface PresupuestoGrupo {
  key: string; categoriaId: number; categoria: Categoria
  quincenaId: number; quincena: Quincena
  montoPresupuestado: number; real: number; pct: number; excedido: number; items: Presupuesto[]
}

function buildGrupos(presupuestos: Presupuesto[]): PresupuestoGrupo[] {
  const map = new Map<string, PresupuestoGrupo>()
  for (const p of presupuestos) {
    const k = groupKey(p)
    if (!map.has(k)) {
      map.set(k, { key: k, categoriaId: p.categoriaId, categoria: p.categoria,
        quincenaId: p.quincenaId, quincena: p.quincena,
        montoPresupuestado: p.categoriaTotal, real: 0, pct: 0, excedido: 0, items: [] })
    }
    const g = map.get(k)!
    g.items.push(p)
    g.real += p.real
  }
  for (const g of map.values()) {
    g.pct = g.montoPresupuestado > 0 ? (g.real / g.montoPresupuestado) * 100 : 0
    g.excedido = g.real > g.montoPresupuestado ? Number((g.real - g.montoPresupuestado).toFixed(2)) : 0
  }
  return Array.from(map.values())
}
interface TxSinPresupuesto {
  id: number; descripcion: string; monto: string | number
  categoria: { id: number; nombre: string }; fecha: string; estatus: 'Pagado' | 'Pendiente'
}

const EMPTY_FORM = {
  categoriaId: '', descripcion: '', tipo: 'Gasto',
  montoPresupuestado: '', clasificacion: '', notas: '',
  recurrente: false, frecuencia: 'CADA_QUINCENA',
  terminaCon: 'sin_fin' as 'sin_fin' | 'n_ocurrencias',
  numOcurrencias: '6',
  diaCobro: '',
  fechaVencimiento: '',
  targetQuincenaId: '',
}

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

function matchesBusqueda(g: PresupuestoGrupo, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (g.categoria.nombre.toLowerCase().includes(needle)) return true
  return g.items.some(i =>
    i.descripcion.toLowerCase().includes(needle) ||
    (i.clasificacion ?? '').toLowerCase().includes(needle)
  )
}

type SortKey = 'quincena' | 'categoria' | 'descripcion' | 'presupuestado' | 'real' | 'pct' | 'restante' | 'recurrente' | 'vence'

interface TablaFiltros {
  categoriaId: string
  clasificacion: string // '', 'Fijo', 'Variable', 'sin'
  recurrente: string // '', 'si', 'no'
  estado: string // '', 'excedido', 'dentro'
  saldo: string // '', 'pendiente', 'pagado'
  porCubrir: string // '', '0', '50', '100' — % usado por debajo del cual se considera "por cubrir"
  ocultarIngresos: boolean
  busqueda: string
}

function matchesFiltrosTabla(p: Presupuesto, f: TablaFiltros) {
  if (f.categoriaId && p.categoriaId.toString() !== f.categoriaId) return false
  if (f.clasificacion === 'sin' && p.clasificacion) return false
  if ((f.clasificacion === 'Fijo' || f.clasificacion === 'Variable') && p.clasificacion !== f.clasificacion) return false
  if (f.recurrente === 'si' && !p.recurrente) return false
  if (f.recurrente === 'no' && p.recurrente) return false
  if (f.estado === 'excedido' && !(p.excedido > 0)) return false
  if (f.estado === 'dentro' && p.excedido > 0) return false
  if (f.saldo === 'pendiente' && !(p.pendiente > 0)) return false
  if (f.saldo === 'pagado' && p.pendiente > 0) return false
  if (f.porCubrir === '0' && p.real !== 0) return false
  if (f.porCubrir === '50' && !(p.pct < 50)) return false
  if (f.porCubrir === '100' && !(p.pct < 100)) return false
  if (f.ocultarIngresos && p.categoria.tipo === 'Ingreso') return false
  const needle = f.busqueda.trim().toLowerCase()
  if (needle && !p.descripcion.toLowerCase().includes(needle) && !p.categoria.nombre.toLowerCase().includes(needle)) return false
  return true
}

function getSortValue(p: Presupuesto, key: SortKey): string | number {
  switch (key) {
    case 'quincena': return p.quincena.fechaInicio
    case 'categoria': return p.categoria.nombre
    case 'descripcion': return p.descripcion
    case 'presupuestado': return Number(p.montoPresupuestado)
    case 'real': return p.real
    case 'pct': return p.pct
    case 'restante': return Number(p.montoPresupuestado) - p.real
    case 'recurrente': return p.recurrente ? 1 : 0
    case 'vence': return p.fechaVencimiento ?? ''
  }
}

function pctColor(pct: number) {
  return pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
}
function pctTextColor(pct: number) {
  return pct > 90 ? 'text-rose-600 dark:text-rose-400' : pct > 70 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
}
function montoTipoColor(tipo: string) {
  if (tipo === 'Ingreso') return 'text-emerald-600 dark:text-emerald-400'
  if (tipo === 'Ahorro') return 'text-blue-600 dark:text-blue-400'
  return 'text-rose-600 dark:text-rose-400' // Gasto
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

  const [busqueda, setBusqueda] = useState('')
  const [pendientePorPagar, setPendientePorPagar] = useState(0)
  const [limiteReferencia, setLimiteReferencia] = useState<number | null>(null)
  const [ingresoReferencia, setIngresoReferencia] = useState<number | null>(null)
  const [gastoParaLimite, setGastoParaLimite] = useState(0)

  const [vista, setVista] = useState<'tarjetas' | 'tabla'>('tarjetas')
  const [tablaQuincenaId, setTablaQuincenaId] = useState(ALL_QUINCENAS)
  const [presupuestosTabla, setPresupuestosTabla] = useState<Presupuesto[]>([])
  const [tablaLoading, setTablaLoading] = useState(false)
  const [tablaCategoriaId, setTablaCategoriaId] = useState('')
  const [tablaClasificacion, setTablaClasificacion] = useState('')
  const [tablaRecurrente, setTablaRecurrente] = useState('')
  const [tablaEstado, setTablaEstado] = useState('')
  const [tablaSaldo, setTablaSaldo] = useState('')
  const [tablaPorCubrir, setTablaPorCubrir] = useState('')
  const [tablaOcultarIngresos, setTablaOcultarIngresos] = useState(true)
  const [busquedaTabla, setBusquedaTabla] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('quincena')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [txSinPresupuesto, setTxSinPresupuesto] = useState<TxSinPresupuesto[]>([])
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null)
  const [assigningTxId, setAssigningTxId] = useState<number | null>(null)
  const [crearLineaForTxId, setCrearLineaForTxId] = useState<number | null>(null)
  const [crearLineaForm, setCrearLineaForm] = useState({ descripcion: '', categoriaId: '', monto: '' })
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [modalOpen, setModalOpen] = useState(false)
  const [editingP, setEditingP] = useState<Presupuesto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; p: Presupuesto } | null>(null)
  const [editScopeBody, setEditScopeBody] = useState<Record<string, unknown> | null>(null)
  // Partida cuyo detalle de gasto se esta viendo en la ventana flotante
  const [detalleP, setDetalleP] = useState<Presupuesto | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/configuracion').then(r => r.json()),
    ]).then(([q, c, cfg]) => {
      setQuincenas(q)
      setCategorias(c)
      setQuincenaId(getInitialQuincenaId(q))
      setTablaQuincenaId(getDefaultQuincenaId(q))
      setLimiteReferencia(cfg.limiteGastoReferencia != null ? Number(cfg.limiteGastoReferencia) : null)
      setIngresoReferencia(cfg.ingresoReferencia != null ? Number(cfg.ingresoReferencia) : null)
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    persistQuincenaId(id)
  }

  const fetchPresupuestosTabla = useCallback(async () => {
    setTablaLoading(true)
    try {
      const params = tablaQuincenaId !== ALL_QUINCENAS ? `?quincenaId=${tablaQuincenaId}` : ''
      const res = await fetch(`/api/presupuestos${params}`)
      setPresupuestosTabla(await res.json())
    } finally { setTablaLoading(false) }
  }, [tablaQuincenaId])

  useEffect(() => {
    if (vista === 'tabla') fetchPresupuestosTabla()
  }, [vista, fetchPresupuestosTabla])

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortKey(key); setSortDir('desc') }
  }

  const fetchPresupuestos = useCallback(async () => {
    if (!quincenaId) return
    setLoading(true)
    try {
      const [presupRes, txRes] = await Promise.all([
        fetch(`/api/presupuestos?quincenaId=${quincenaId}`),
        fetch(`/api/transacciones?quincenaId=${quincenaId}&tipo=Gasto&limit=500`),
      ])
      const data: Presupuesto[] = await presupRes.json()
      const txData = await txRes.json()
      const transacciones: Array<TxSinPresupuesto & { presupuestoId: number | null }> = txData.data ?? []

      setPresupuestos(data)
      setQuincenaActual(data[0]?.quincena ?? quincenas.find(q => q.id.toString() === quincenaId) ?? null)

      setTxSinPresupuesto(transacciones.filter(t => t.presupuestoId == null))
      setGastoParaLimite(Number(txData.totales?.GastoParaLimite ?? 0))

      setPendientePorPagar(calcularFaltaPorPagar(data))
    } finally { setLoading(false) }
  }, [quincenaId, quincenas])

  useEffect(() => { fetchPresupuestos() }, [fetchPresupuestos])

  async function handleAsignar(txId: number, presupuestoId: number) {
    setAssigningTxId(txId)
    setOpenPopoverId(null)
    try {
      const res = await fetch(`/api/transacciones/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presupuestoId }),
      })
      if (res.ok) {
        setTxSinPresupuesto(prev => prev.filter(t => t.id !== txId))
        fetchPresupuestos()
      }
    } finally { setAssigningTxId(null) }
  }

  async function handleCrearYAsignar(txId: number) {
    if (!crearLineaForm.descripcion || !crearLineaForm.categoriaId || !crearLineaForm.monto) return
    setSaving(true)
    try {
      const presupRes = await fetch('/api/presupuestos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quincenaId, descripcion: crearLineaForm.descripcion,
          categoriaId: crearLineaForm.categoriaId,
          montoPresupuestado: crearLineaForm.monto,
          tipo: 'Gasto',
        }),
      })
      if (!presupRes.ok) return
      const newPresup = await presupRes.json()
      const txRes = await fetch(`/api/transacciones/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presupuestoId: newPresup.id }),
      })
      if (txRes.ok) {
        setTxSinPresupuesto(prev => prev.filter(t => t.id !== txId))
        setOpenPopoverId(null)
        setCrearLineaForTxId(null)
        fetchPresupuestos()
      }
    } finally { setSaving(false) }
  }

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
      recurrente: p.recurrente, frecuencia: p.frecuencia ?? 'CADA_QUINCENA',
      terminaCon: p.numOcurrencias ? 'n_ocurrencias' : 'sin_fin', numOcurrencias: p.numOcurrencias?.toString() ?? '6',
      diaCobro: p.diaCobro?.toString() ?? '',
      fechaVencimiento: p.fechaVencimiento ? p.fechaVencimiento.split('T')[0] : '',
      targetQuincenaId: '',
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

  function buildSaveBody() {
    return {
      quincenaId: form.targetQuincenaId || quincenaId,
      categoriaId: form.categoriaId, descripcion: form.descripcion.trim(),
      tipo: form.tipo, montoPresupuestado: form.montoPresupuestado,
      clasificacion: form.clasificacion || null, notas: form.notas || null,
      recurrente: form.recurrente,
      frecuencia: form.recurrente ? form.frecuencia : null,
      numOcurrencias: form.recurrente && form.terminaCon === 'n_ocurrencias'
        ? parseInt(form.numOcurrencias) || null
        : null,
      diaCobro: form.diaCobro ? parseInt(form.diaCobro) : null,
      fechaVencimiento: form.fechaVencimiento || null,
    }
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    const body = buildSaveBody()
    // Editing a line that's already part of a recurring series: hide the
    // edit form and ask which quincenas to apply the change to before saving.
    if (editingP?.recurrenciaGrupoId) { setModalOpen(false); setEditScopeBody(body); return }
    await saveBody(body)
  }

  async function saveBody(body: Record<string, unknown>) {
    setSaving(true)
    try {
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
      setEditScopeBody(null)
      fetchPresupuestos()
      fetchPresupuestosTabla()
    } catch { toast('Error al guardar', 'error') } finally { setSaving(false) }
  }

  async function handleSaveWithScope(scope: 'single' | 'future' | 'this_forward' | 'all') {
    if (!editScopeBody) return
    await saveBody({ ...editScopeBody, scope })
  }

  async function handleDelete(mode: 'single' | 'all') {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { id, p } = deleteTarget
      const url = mode === 'all' && p.recurrenciaGrupoId
        ? `/api/presupuestos/${id}?grupoId=${p.recurrenciaGrupoId}`
        : `/api/presupuestos/${id}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast(mode === 'all' && p.recurrenciaGrupoId
        ? `${data.count} partidas eliminadas`
        : 'Presupuesto eliminado')
      setDeleteTarget(null)
      fetchPresupuestos()
      fetchPresupuestosTabla()
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

  function handleExportCsv() {
    const csv = toCsv(presupuestos, [
      { key: 'categoria', label: 'Categoría', value: p => p.categoria?.nombre ?? '' },
      { key: 'descripcion', label: 'Descripción', value: p => p.descripcion },
      { key: 'presupuestado', label: 'Presupuestado', value: p => Number(p.montoPresupuestado).toFixed(2) },
      { key: 'real', label: 'Real', value: p => Number(p.real).toFixed(2) },
      { key: 'pct', label: '% Usado', value: p => p.pct.toFixed(0) },
      { key: 'restante', label: 'Restante', value: p => Number(Math.max(p.montoPresupuestado - p.real, 0)).toFixed(2) },
      { key: 'excedido', label: 'Excedido', value: p => Number(p.excedido).toFixed(2) },
      { key: 'recurrente', label: 'Recurrente', value: p => p.recurrente ? (p.frecuencia === 'MENSUAL' ? 'Mensual' : 'Quincenal') : 'No' },
      { key: 'vence', label: 'Vence', value: p => p.fechaVencimiento ? formatDateStr(p.fechaVencimiento, { day: '2-digit', month: 'short', year: 'numeric' }) : '' },
    ])
    const quincenaLabel = quincenaActual?.codigo ?? quincenas.find(q => q.id.toString() === quincenaId)?.codigo ?? 'quincena'
    downloadCsv(`presupuesto-${quincenaLabel}-${getMexicoDateString()}.csv`, csv)
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const grupos = buildGrupos(presupuestos)
  const gruposFiltrados = grupos.filter(g => matchesBusqueda(g, busqueda))

  // Totals: only categories of tipo Gasto — excludes Ingresos/Ahorro categories from spending progress
  const gastoGrupos = grupos.filter(g => g.categoria.tipo === 'Gasto')
  const totalPresupuestado = gastoGrupos.reduce((s, g) => s + g.montoPresupuestado, 0)
  const totalGastado = gastoGrupos.reduce((s, g) => s + g.real, 0)
  const pctGlobal = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0

  const today = getMexicoDateString()
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
        <div className="flex items-center flex-wrap gap-3">
          {qInfo && (
            <Link href={`/quincena/${qInfo.codigo}`}
              className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg transition-colors">
              <Droplets size={14} /> Liquidez
            </Link>
          )}
          {qInfo && <ReporteButton quincenaId={qInfo.id} quincenaCodigo={qInfo.codigo} />}
          {presupuestos.length === 0 && !loading && (
            <button onClick={handleCopiar} disabled={copying}
              className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
              <Copy size={14} />
              {copying ? 'Copiando...' : 'Copiar anterior'}
            </button>
          )}
          <button onClick={handleExportCsv} disabled={presupuestos.length === 0}
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
            <Download size={14} /> Descargar CSV
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      {/* Toggle de vista */}
      <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        <button onClick={() => setVista('tarjetas')}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md cursor-pointer transition-colors ${vista === 'tarjetas' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <LayoutGrid size={14} /> Tarjetas
        </button>
        <button onClick={() => setVista('tabla')}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md cursor-pointer transition-colors ${vista === 'tabla' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Table2 size={14} /> Tabla
        </button>
      </div>

      {vista === 'tabla' ? (
        <PresupuestoTabla
          quincenas={quincenas} categorias={categorias} today={today}
          tablaQuincenaId={tablaQuincenaId} setTablaQuincenaId={setTablaQuincenaId}
          presupuestosTabla={presupuestosTabla} tablaLoading={tablaLoading}
          tablaCategoriaId={tablaCategoriaId} setTablaCategoriaId={setTablaCategoriaId}
          tablaClasificacion={tablaClasificacion} setTablaClasificacion={setTablaClasificacion}
          tablaRecurrente={tablaRecurrente} setTablaRecurrente={setTablaRecurrente}
          tablaEstado={tablaEstado} setTablaEstado={setTablaEstado}
          tablaSaldo={tablaSaldo} setTablaSaldo={setTablaSaldo}
          tablaPorCubrir={tablaPorCubrir} setTablaPorCubrir={setTablaPorCubrir}
          tablaOcultarIngresos={tablaOcultarIngresos} setTablaOcultarIngresos={setTablaOcultarIngresos}
          busquedaTabla={busquedaTabla} setBusquedaTabla={setBusquedaTabla}
          sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort}
          openEdit={openEdit} setDeleteTarget={setDeleteTarget} setDetalleP={setDetalleP}
          ingresoReferencia={ingresoReferencia}
        />
      ) : (
        <>
      {/* Selector de quincena */}
      <QuincenaChips quincenas={quincenas} quincenaId={quincenaId} today={today} onSelect={selectQuincena} />

      <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />

      {/* Summary cards */}
      {grupos.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 ${limiteReferencia != null ? 'sm:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Restante</p>
            <p className={`text-2xl font-bold tabular-nums ${totalPresupuestado - totalGastado >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatMXN(totalPresupuestado - totalGastado)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {pctGlobal > 90 ? 'Cuidado: casi agotado' : pctGlobal > 70 ? 'Va bien, pero vigilante' : 'Suficiente para la quincena'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Falta por pagar</p>
            <p className={`text-2xl font-bold tabular-nums ${pendientePorPagar > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatMXN(pendientePorPagar)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {pendientePorPagar > 0 ? 'Pendiente de pago + presupuesto que aún no registras' : 'Todo pagado y registrado en esta quincena'}
            </p>
          </div>

          {limiteReferencia != null && (() => {
            const pctLimite = limiteReferencia > 0 ? (gastoParaLimite / limiteReferencia) * 100 : 0
            return (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                  Límite de referencia
                  <span className="cursor-help text-slate-300 dark:text-slate-600" title="Tu límite de gasto de referencia (Configuración → Períodos de pago). Es solo informativo, no bloquea nada.">ⓘ</span>
                </p>
                <div className="flex justify-between items-end mb-2">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                    {formatMXN(gastoParaLimite)}
                    <span className="text-slate-400 dark:text-slate-500 font-normal text-base"> / {formatMXN(limiteReferencia)}</span>
                  </p>
                  <span className={`text-lg font-bold ${pctTextColor(pctLimite)}`}>{pctLimite.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all ${pctColor(pctLimite)}`} style={{ width: `${Math.min(pctLimite, 100)}%` }} />
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Gastos sin presupuesto */}
      {!loading && txSinPresupuesto.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-800/50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Gastos sin presupuesto</h3>
            <span className="ml-auto text-xs text-amber-600 dark:text-amber-500">{txSinPresupuesto.length} {txSinPresupuesto.length === 1 ? 'transacción' : 'transacciones'}</span>
          </div>
          <div className="border border-amber-200 dark:border-amber-800/40 rounded-xl overflow-visible bg-white dark:bg-slate-800/60">
            {txSinPresupuesto.map((tx, idx) => {
              const isOpen = openPopoverId === tx.id
              const isAssigning = assigningTxId === tx.id
              const showCrearForm = crearLineaForTxId === tx.id
              const categoriasDisponibles = Array.from(
                new Map([tx.categoria, ...presupuestos.map(p => p.categoria)].map(c => [c.id, c])).values()
              ).sort((a, b) => a.nombre.localeCompare(b.nombre))
              return (
                <div key={tx.id}
                  className={`relative flex items-center justify-between gap-3 px-3 py-2.5 ${idx < txSinPresupuesto.length - 1 ? 'border-b border-amber-100 dark:border-amber-900/40' : ''}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[tx.categoria.nombre] ?? 'bg-slate-400'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{tx.descripcion}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{tx.categoria.nombre} · {new Date(tx.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatMXN(Number(tx.monto))}</span>
                    <div className="relative">
                      <button
                        onClick={() => { setOpenPopoverId(isOpen ? null : tx.id); setCrearLineaForTxId(null) }}
                        disabled={isAssigning}
                        className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/70 text-amber-700 dark:text-amber-400 flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
                        aria-label="Asignar a línea de presupuesto"
                      >
                        {isAssigning ? <Loader2 size={10} className="animate-spin" /> : <Plus size={12} />}
                      </button>
                      {isOpen && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => { setOpenPopoverId(null); setCrearLineaForTxId(null) }} aria-hidden />
                          <div className="absolute right-0 bottom-full mb-1.5 w-64 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-30 overflow-hidden">
                            {!showCrearForm ? (
                              <>
                                <div className="px-3 pt-2 pb-1 border-b border-slate-100 dark:border-slate-700">
                                  <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Asignar a:</p>
                                </div>
                                <div className="max-h-48 overflow-y-auto py-1">
                                  {presupuestos.length > 0 ? presupuestos.map(p => (
                                    <button key={p.id} onClick={() => handleAsignar(tx.id, p.id)}
                                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-start justify-between gap-2 transition-colors cursor-pointer">
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{p.descripcion}</p>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{p.categoria.nombre}</p>
                                      </div>
                                      <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0 pt-0.5">{formatMXN(Number(p.montoPresupuestado))}</span>
                                    </button>
                                  )) : (
                                    <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">Sin líneas en esta quincena</p>
                                  )}
                                </div>
                                <div className="border-t border-slate-100 dark:border-slate-700">
                                  <button
                                    onClick={() => { setCrearLineaForTxId(tx.id); setCrearLineaForm({ descripcion: tx.descripcion, categoriaId: tx.categoria.id.toString(), monto: tx.monto.toString() }) }}
                                    className="w-full text-left px-3 py-2 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 flex items-center gap-1.5 transition-colors font-medium cursor-pointer">
                                    <Plus size={11} /> Crear nueva línea
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="p-3 space-y-2">
                                <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nueva línea de presupuesto</p>
                                <div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Descripción</p>
                                  <input type="text" value={crearLineaForm.descripcion}
                                    onChange={e => setCrearLineaForm(f => ({ ...f, descripcion: e.target.value }))}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Categoría</p>
                                  <select value={crearLineaForm.categoriaId}
                                    onChange={e => setCrearLineaForm(f => ({ ...f, categoriaId: e.target.value }))}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400">
                                    {categoriasDisponibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Presupuesto $</p>
                                  <input type="number" value={crearLineaForm.monto} min="0"
                                    onChange={e => setCrearLineaForm(f => ({ ...f, monto: e.target.value }))}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                                </div>
                                <div className="flex gap-2 pt-0.5">
                                  <button onClick={() => setCrearLineaForTxId(null)}
                                    className="flex-1 text-xs py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                                    Cancelar
                                  </button>
                                  <button onClick={() => handleCrearYAsignar(tx.id)}
                                    disabled={saving || !crearLineaForm.descripcion || !crearLineaForm.monto}
                                    className="flex-1 text-xs py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer">
                                    {saving && <Loader2 size={10} className="animate-spin" />}
                                    Crear y asignar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex justify-between items-center">
            <span className="text-xs text-amber-600 dark:text-amber-500">Total fuera de plan</span>
            <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-100">
              {formatMXN(txSinPresupuesto.reduce((s, t) => s + Number(t.monto), 0))}
            </span>
          </div>
        </div>
      )}

      {/* Buscador */}
      {!loading && grupos.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input type="text" placeholder="Buscar por categoría o descripción..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-8 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          {busqueda && (
            <button type="button" onClick={() => setBusqueda('')} aria-label="Quitar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer">
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Per-category groups */}
      {loading ? (
        <PresupuestoSkeleton />
      ) : grupos.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Copy size={28} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin presupuesto configurado</p>
          <p className="text-sm mt-1">Crea un presupuesto o copia el de la quincena anterior</p>
        </div>
      ) : gruposFiltrados.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Search size={28} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin resultados</p>
          <p className="text-sm mt-1">Ninguna partida coincide con &quot;{busqueda}&quot;</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {gruposFiltrados.map(grupo => {
            const isMulti = grupo.items.length > 1
            const expanded = expandedGroups.has(grupo.key)
            const singleItem = grupo.items[0]

            return (
              <div key={grupo.key} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-sm transition-all">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isMulti && (
                        <button onClick={() => toggleGroup(grupo.key)}
                          className="text-slate-400 dark:text-slate-500 hover:text-indigo-500 transition-colors cursor-pointer shrink-0">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CAT_DOT[grupo.categoria.nombre] ?? 'bg-slate-400'}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {isMulti ? grupo.categoria.nombre : singleItem.descripcion}
                          </p>
                          {!isMulti && singleItem.recurrente && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                              <Repeat size={9} />
                              {singleItem.frecuencia === 'MENSUAL'
                                ? singleItem.diaCobro ? `mensual · día ${singleItem.diaCobro}` : 'mensual'
                                : 'quincenal'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            {isMulti
                              ? `${grupo.items.length} conceptos`
                              : `${grupo.categoria.nombre}${singleItem.clasificacion ? ` · ${singleItem.clasificacion}` : ''}`}
                          </p>
                          {!isMulti && singleItem.fechaVencimiento && (() => {
                            const d = new Date(`${singleItem.fechaVencimiento.split('T')[0]}T00:00:00`)
                            const esQ1 = d.getDate() <= 15
                            return (
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${esQ1 ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>
                                <CalendarClock size={10} />
                                vence {d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(grupo.real)}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">de {formatMXN(grupo.montoPresupuestado)}</p>
                      </div>
                      {!isMulti && (
                        <>
                          <button onClick={() => openEdit(singleItem)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteTarget({ id: singleItem.id, p: singleItem })}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${pctColor(grupo.pct)}`} style={{ width: `${Math.min(grupo.pct, 100)}%` }} />
                    </div>
                    <span className={`text-xs font-semibold w-10 text-right tabular-nums ${pctTextColor(grupo.pct)}`}>
                      {grupo.pct.toFixed(0)}%
                    </span>
                  </div>
                  {grupo.excedido > 0 && (
                    <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 mt-1">
                      +{formatMXN(grupo.excedido)} excedido
                    </p>
                  )}
                </div>

                {/* Sub-items for multi-category groups */}
                {isMulti && expanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    {grupo.items.map(item => (
                      <div key={item.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1 h-4 rounded-full bg-slate-200 dark:bg-slate-600 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{item.descripcion}</p>
                                {item.recurrente && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded-full shrink-0">
                                    <Repeat size={8} />
                                    {item.frecuencia === 'MENSUAL' ? (item.diaCobro ? `día ${item.diaCobro}` : 'mensual') : 'quincenal'}
                                  </span>
                                )}
                              </div>
                              {item.fechaVencimiento && (() => {
                                const d = new Date(`${item.fechaVencimiento.split('T')[0]}T00:00:00`)
                                const esQ1 = d.getDate() <= 15
                                return (
                                  <span className={`text-[10px] flex items-center gap-0.5 mt-0.5 font-medium ${esQ1 ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>
                                    <CalendarClock size={9} />
                                    vence {d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
                                  </span>
                                )
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                              <button onClick={() => setDetalleP(item)}
                                className="hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer transition-colors"
                                aria-label={`Ver movimientos de ${item.descripcion}`}>
                                {formatMXN(item.real)}
                              </button>
                              <span className="text-slate-400 dark:text-slate-500 font-normal"> de {formatMXN(Number(item.montoPresupuestado))}</span>
                            </span>
                            <button onClick={() => openEdit(item)}
                              className="p-1 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => setDeleteTarget({ id: item.id, p: item })}
                              className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 pl-3">
                          <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${pctColor(item.pct)}`} style={{ width: `${Math.min(item.pct, 100)}%` }} />
                          </div>
                          <span className={`text-[11px] font-semibold w-9 text-right tabular-nums ${pctTextColor(item.pct)}`}>
                            {item.pct.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-2 flex items-center justify-between bg-slate-50 dark:bg-slate-700/40 rounded-b-xl">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total {grupo.categoria.nombre}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatMXN(grupo.real)} de {formatMXN(grupo.montoPresupuestado)}</span>
                    </div>
                  </div>
                )}

                {/* Collapsed hint for multi groups */}
                {isMulti && !expanded && (
                  <button onClick={() => toggleGroup(grupo.key)}
                    className="w-full px-4 py-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 text-left border-t border-slate-100 dark:border-slate-700 transition-colors cursor-pointer rounded-b-xl">
                    Ver {grupo.items.length} conceptos: {grupo.items.map(i => i.descripcion).join(', ')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
        </>
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
              <label htmlFor="p-fechavenc" className="flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                <CalendarClock size={11} />
                Vence el día
              </label>
              <input id="p-fechavenc" type="date"
                value={form.fechaVencimiento}
                onChange={e => {
                  const val = e.target.value
                  const suggestedId = val ? getQuincenaIdForDate(quincenas, val) : ''
                  const currentId = (editingP?.quincenaId?.toString() ?? quincenaId)
                  const isDifferent = suggestedId && suggestedId !== currentId
                  setForm(f => ({
                    ...f,
                    fechaVencimiento: val,
                    targetQuincenaId: isDifferent ? suggestedId : '',
                  }))
                }}
                className={fieldClass()} />
              {(() => {
                if (!form.fechaVencimiento) return (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Opcional — sin fecha específica</p>
                )
                const suggestedId = getQuincenaIdForDate(quincenas, form.fechaVencimiento)
                const suggestedQ = quincenas.find(q => q.id.toString() === suggestedId)
                const currentId = (editingP?.quincenaId?.toString() ?? quincenaId)
                const isDifferent = suggestedId && suggestedId !== currentId

                if (isDifferent && suggestedQ) {
                  const confirmed = form.targetQuincenaId === suggestedId
                  return (
                    <div className={`mt-1.5 rounded-lg px-2.5 py-2 border text-[11px] ${confirmed ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/40' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'}`}>
                      <p className={`font-medium mb-1.5 ${confirmed ? 'text-indigo-700 dark:text-indigo-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        {confirmed ? `✓ Se moverá a ${suggestedQ.codigo}` : `Esta fecha corresponde a ${suggestedQ.codigo} · ${formatQuincenaRange(suggestedQ)}`}
                      </p>
                      {!confirmed && (
                        <div className="flex gap-1.5">
                          <button type="button"
                            onClick={() => setForm(f => ({ ...f, targetQuincenaId: suggestedId }))}
                            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md cursor-pointer transition-colors">
                            Mover a {suggestedQ.codigo}
                          </button>
                          <button type="button"
                            onClick={() => setForm(f => ({ ...f, targetQuincenaId: 'keep' }))}
                            className="px-2 py-0.5 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md cursor-pointer transition-colors">
                            Mantener Q actual
                          </button>
                        </div>
                      )}
                    </div>
                  )
                }

                const d = new Date(`${form.fechaVencimiento}T00:00:00`)
                const esQ1 = d.getDate() <= 15
                return (
                  <p className={`text-[11px] mt-1 flex items-center gap-1 font-medium ${esQ1 ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>
                    <CalendarClock size={10} />
                    {esQ1 ? 'Cae en 1ª quincena (días 1–15)' : 'Cae en 2ª quincena (días 16–fin)'}
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

          {/* Recurrence section — shown both when creating and editing */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {editingP?.recurrenciaGrupoId && (
                <p className="px-4 py-2 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 border-b border-slate-200 dark:border-slate-700">
                  Esta partida es parte de una serie recurrente. Al guardar te preguntaremos qué quincenas quieres actualizar.
                </p>
              )}
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
                    {editingP ? 'Se aplicará a' : 'Se creará en'}{' '}
                    {form.terminaCon === 'n_ocurrencias'
                      ? `${form.numOcurrencias} ${form.frecuencia === 'MENSUAL' ? 'meses' : 'quincenas'}`
                      : 'todas las quincenas futuras disponibles'
                    }
                    {form.frecuencia === 'MENSUAL' ? ', solo primera quincena del mes' : ''}.
                  </div>
                </div>
              )}
          </div>

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

      {/* Detalle: transacciones que componen el gasto real de una partida */}
      <FormModal
        open={detalleP != null}
        onOpenChange={open => !open && setDetalleP(null)}
        title={detalleP?.descripcion ?? ''}
        maxWidthClass="max-w-2xl"
        subtitle={detalleP && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {detalleP.categoria.nombre} · {detalleP.quincena.codigo}
          </p>
        )}
      >
        {detalleP && (
          <DetalleGastoContent
            key={detalleP.id}
            partida={{
              id: detalleP.id,
              descripcion: detalleP.descripcion,
              montoPresupuestado: detalleP.montoPresupuestado,
              real: detalleP.real,
              categoriaNombre: detalleP.categoria.nombre,
              quincenaCodigo: detalleP.quincena.codigo,
            }}
          />
        )}
      </FormModal>

      {/* Non-recurring delete — simple confirm */}
      <ConfirmDialog
        open={deleteTarget != null && !deleteTarget.p.recurrenciaGrupoId}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title="Eliminar presupuesto"
        description="Se eliminará este presupuesto. El historial de transacciones no se verá afectado."
        onConfirm={() => handleDelete('single')}
        loading={deleting}
      />

      {/* Recurring delete — smart dialog */}
      {deleteTarget?.p.recurrenciaGrupoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center shrink-0">
                <Repeat size={16} className="text-rose-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Eliminar partida recurrente</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">{deleteTarget.p.descripcion}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400">
              Esta partida forma parte de una serie recurrente. ¿Qué deseas eliminar?
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleDelete('single')}
                disabled={deleting}
                className="w-full text-left px-4 py-3 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium">Solo esta quincena</p>
                <p className="text-xs text-rose-400 dark:text-rose-500 mt-0.5">Elimina únicamente este registro</p>
              </button>

              <button
                onClick={() => handleDelete('all')}
                disabled={deleting}
                className="w-full text-left px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <p className="text-sm font-medium">
                    Eliminar todas las repeticiones
                    {deleteTarget.p.numOcurrencias ? ` · ${deleteTarget.p.numOcurrencias} elementos` : ''}
                  </p>
                </div>
                <p className="text-xs text-rose-200 mt-0.5 ml-5">Borra todas las quincenas del grupo</p>
              </button>
            </div>

            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="w-full py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50 cursor-pointer transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Editing a line that's part of a recurring series — ask scope */}
      {editScopeBody && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
                <Repeat size={16} className="text-indigo-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Actualizar partida recurrente</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">{editingP?.descripcion}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400">
              Esta partida forma parte de una serie recurrente. ¿A qué quincenas quieres aplicar los cambios?
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleSaveWithScope('single')}
                disabled={saving}
                className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium">Solo esta quincena</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Cambia únicamente este registro; no afecta la serie</p>
              </button>

              <button
                onClick={() => handleSaveWithScope('future')}
                disabled={saving}
                className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium">De aquí en adelante</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Sólo las quincenas futuras; esta no se modifica</p>
              </button>

              <button
                onClick={() => handleSaveWithScope('this_forward')}
                disabled={saving}
                className="w-full text-left px-4 py-3 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium">Incluyendo esta quincena</p>
                <p className="text-xs text-indigo-400 dark:text-indigo-500 mt-0.5">Esta quincena y todas las futuras</p>
              </button>

              <button
                onClick={() => handleSaveWithScope('all')}
                disabled={saving}
                className="w-full text-left px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <p className="text-sm font-medium">Todo, absolutamente todo</p>
                </div>
                <p className="text-xs text-indigo-200 mt-0.5 ml-5">Incluye quincenas ya pasadas de la serie</p>
              </button>
            </div>

            <button
              onClick={() => { setEditScopeBody(null); setModalOpen(true) }}
              disabled={saving}
              className="w-full py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50 cursor-pointer transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SortableTh({ label, sortKeyName, align, sortKey, sortDir, onSort }: {
  label: string; sortKeyName: SortKey; align?: 'right'
  sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (key: SortKey) => void
}) {
  const active = sortKey === sortKeyName
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(sortKeyName)}
        className={`inline-flex items-center gap-1 font-medium cursor-pointer transition-colors ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'}`}>
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  )
}

interface PresupuestoTablaProps {
  quincenas: Quincena[]; categorias: Categoria[]; today: string
  tablaQuincenaId: string; setTablaQuincenaId: (id: string) => void
  presupuestosTabla: Presupuesto[]; tablaLoading: boolean
  tablaCategoriaId: string; setTablaCategoriaId: (v: string) => void
  tablaClasificacion: string; setTablaClasificacion: (v: string) => void
  tablaRecurrente: string; setTablaRecurrente: (v: string) => void
  tablaEstado: string; setTablaEstado: (v: string) => void
  tablaSaldo: string; setTablaSaldo: (v: string) => void
  tablaPorCubrir: string; setTablaPorCubrir: (v: string) => void
  tablaOcultarIngresos: boolean; setTablaOcultarIngresos: (v: boolean) => void
  busquedaTabla: string; setBusquedaTabla: (v: string) => void
  sortKey: SortKey; sortDir: 'asc' | 'desc'; toggleSort: (key: SortKey) => void
  openEdit: (p: Presupuesto) => void
  setDeleteTarget: (v: { id: number; p: Presupuesto } | null) => void
  setDetalleP: (p: Presupuesto | null) => void
  ingresoReferencia: number | null
}

function PresupuestoTabla({
  quincenas, categorias, today,
  tablaQuincenaId, setTablaQuincenaId, presupuestosTabla, tablaLoading,
  tablaCategoriaId, setTablaCategoriaId, tablaClasificacion, setTablaClasificacion,
  tablaRecurrente, setTablaRecurrente, tablaEstado, setTablaEstado,
  tablaSaldo, setTablaSaldo, tablaPorCubrir, setTablaPorCubrir,
  tablaOcultarIngresos, setTablaOcultarIngresos,
  busquedaTabla, setBusquedaTabla, sortKey, sortDir, toggleSort,
  openEdit, setDeleteTarget, setDetalleP, ingresoReferencia,
}: PresupuestoTablaProps) {
  const filtros: TablaFiltros = { categoriaId: tablaCategoriaId, clasificacion: tablaClasificacion, recurrente: tablaRecurrente, estado: tablaEstado, saldo: tablaSaldo, porCubrir: tablaPorCubrir, ocultarIngresos: tablaOcultarIngresos, busqueda: busquedaTabla }
  const filasTabla = presupuestosTabla
    .filter(p => matchesFiltrosTabla(p, filtros))
    .sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })

  // Los totales de dinero solo deben sumar partidas de Gasto — Ingreso/Ahorro (p.ej.
  // una línea "Salario") nunca se suman a un total de gasto. Mismo criterio que la
  // vista Tarjetas (gastoGrupos). Las filas siguen mostrándose todas; solo se excluyen
  // de las sumas.
  const gastoFilasTabla = filasTabla.filter(p => p.categoria.tipo === 'Gasto')

  // Dynamic totals over the filtered Gasto rows — recompute on every filter change
  const totalPresupuestado = gastoFilasTabla.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
  const totalReal = gastoFilasTabla.reduce((s, p) => s + p.real, 0)
  const totalPendiente = gastoFilasTabla.reduce((s, p) => s + p.pendiente, 0)
  const totalPct = totalPresupuestado > 0 ? (totalReal / totalPresupuestado) * 100 : 0
  const totalExcedido = totalReal > totalPresupuestado ? totalReal - totalPresupuestado : 0
  const totalRestante = totalPresupuestado - totalReal
  const totalFaltaPorPagar = calcularFaltaPorPagar(gastoFilasTabla)

  const ingresoFilasTabla = filasTabla.filter(p => p.categoria.tipo === 'Ingreso')
  const totalIngresoPresupuestado = ingresoFilasTabla.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
  const balancePresupuestado = totalIngresoPresupuestado - totalPresupuestado

  const [liquidezSnapshot, setLiquidezSnapshot] = useState<(LiquidezMontos & { faltaPagar: number }) | null>(null)
  useEffect(() => {
    if (tablaQuincenaId === ALL_QUINCENAS) { setLiquidezSnapshot(null); return }
    fetch(`/api/liquidez?quincenaId=${tablaQuincenaId}`)
      .then(r => r.json())
      .then(data => {
        const raw = Array.isArray(data) && data.length > 0 ? data[0] : null
        setLiquidezSnapshot(raw ? { ...normalizeMontos(raw), faltaPagar: Number(raw.faltaPagar) || 0 } : null)
      })
  }, [tablaQuincenaId])
  const totalLiquidez = liquidezSnapshot ? sumLiquidez(liquidezSnapshot) : 0
  const liquidezNeta = liquidezSnapshot ? totalLiquidez - liquidezSnapshot.faltaPagar : 0

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <QuincenaChips quincenas={quincenas} quincenaId={tablaQuincenaId} today={today} onSelect={setTablaQuincenaId} showAll />
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip value={tablaCategoriaId} onChange={setTablaCategoriaId} onClear={() => setTablaCategoriaId('')} placeholder="Categoría">
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </FilterChip>
          <FilterChip value={tablaClasificacion} onChange={setTablaClasificacion} onClear={() => setTablaClasificacion('')} placeholder="Clasificación">
            <option value="Fijo">Fijo</option>
            <option value="Variable">Variable</option>
            <option value="sin">Sin clasificar</option>
          </FilterChip>
          <FilterChip value={tablaRecurrente} onChange={setTablaRecurrente} onClear={() => setTablaRecurrente('')} placeholder="Recurrente">
            <option value="si">Sí</option>
            <option value="no">No</option>
          </FilterChip>
          <FilterChip value={tablaEstado} onChange={setTablaEstado} onClear={() => setTablaEstado('')} placeholder="Estado">
            <option value="excedido">Excedido</option>
            <option value="dentro">Dentro de presupuesto</option>
          </FilterChip>
          <FilterChip value={tablaSaldo} onChange={setTablaSaldo} onClear={() => setTablaSaldo('')} placeholder="Saldo">
            <option value="pendiente">Con saldo pendiente</option>
            <option value="pagado">Sin saldo pendiente</option>
          </FilterChip>
          <FilterChip value={tablaPorCubrir} onChange={setTablaPorCubrir} onClear={() => setTablaPorCubrir('')} placeholder="Por cubrir">
            <option value="0">Sin registrar (0%)</option>
            <option value="50">Cubierto menos de 50%</option>
            <option value="100">Cubierto menos de 100%</option>
          </FilterChip>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input type="text" placeholder="Buscar por categoría o descripción..." value={busquedaTabla} onChange={e => setBusquedaTabla(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-8 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            {busquedaTabla && (
              <button type="button" onClick={() => setBusquedaTabla('')} aria-label="Quitar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={tablaOcultarIngresos} onChange={e => setTablaOcultarIngresos(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400" />
            Ocultar ingresos
          </label>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">{filasTabla.length} de {presupuestosTabla.length} partidas</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Ingresos" value={formatMXN(totalIngresoPresupuestado)}
          subtitle={ingresoReferencia != null ? `meta ${formatMXN(ingresoReferencia)}` : undefined}
          icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
          color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50"
        />
        <KpiCard
          label="Gastos" value={formatMXN(totalPresupuestado)}
          icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />}
          color="text-rose-600 dark:text-rose-400" bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50"
        />
        <KpiCard
          label="Balance" value={formatMXN(balancePresupuestado)}
          icon={<Scale size={20} className={balancePresupuestado >= 0 ? 'text-indigo-600 dark:text-indigo-300' : 'text-rose-600 dark:text-rose-300'} />}
          color={balancePresupuestado >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}
          bg={balancePresupuestado >= 0 ? 'bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50' : 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50'}
        />
        {tablaQuincenaId !== ALL_QUINCENAS && (
          liquidezSnapshot ? (
            <KpiCard
              label="Liquidez" value={formatMXN(totalLiquidez)}
              subtitle={liquidezSnapshot.faltaPagar > 0 ? `neta ${formatMXN(liquidezNeta)}` : undefined}
              subtitleColor={liquidezNeta < 0 ? 'text-rose-500 dark:text-rose-400' : undefined}
              icon={<Droplets size={20} className="text-blue-600 dark:text-blue-300" />}
              color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
            />
          ) : (
            <Link href={`/configuracion/liquidez?quincenaId=${tablaQuincenaId}`}>
              <KpiCard
                label="Liquidez" value="—" subtitle="Sin corte capturado"
                icon={<Droplets size={20} className="text-blue-600 dark:text-blue-300" />}
                color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
              />
            </Link>
          )
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {tablaLoading ? (
          <div className="py-20 flex justify-center items-center text-slate-400 dark:text-slate-500 text-sm">Cargando...</div>
        ) : presupuestosTabla.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin partidas de presupuesto</p>
          </div>
        ) : filasTabla.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin resultados</p>
            <p className="text-sm mt-1">Ninguna partida coincide con estos filtros</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {filasTabla.map(p => (
                <div key={p.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{p.descripcion}</p>
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{p.categoria.nombre} · {p.quincena.codigo}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${pctTextColor(p.pct)}`}>{p.pct.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className={`tabular-nums ${montoTipoColor(p.categoria.tipo)}`}>
                      <button onClick={() => setDetalleP(p)}
                        className="font-semibold hover:underline hover:opacity-80 cursor-pointer transition-colors"
                        aria-label={`Ver movimientos de ${p.descripcion}`}>
                        {formatMXN(p.real)}
                      </button>
                      {' '}de {formatMXN(Number(p.montoPresupuestado))}
                    </span>
                    {p.excedido > 0
                      ? <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums">+{formatMXN(p.excedido)}</span>
                      : <span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{formatMXN(Number(p.montoPresupuestado) - p.real)}</span>}
                  </div>
                  {p.pendiente > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">{formatMXN(p.pendiente)} pendiente de pago</p>
                  )}
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(p)} aria-label="Editar"
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDeleteTarget({ id: p.id, p })} aria-label="Eliminar"
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              <div className="bg-slate-50 dark:bg-slate-900/60 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                  Total · {gastoFilasTabla.length} {gastoFilasTabla.length === 1 ? 'partida' : 'partidas'}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Presupuestado</span>
                  <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatMXN(totalPresupuestado)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Real</span>
                  <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatMXN(totalReal)}
                    {totalPendiente > 0 && <span className="ml-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">({formatMXN(totalPendiente)} pend.)</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">{totalExcedido > 0 ? 'Excedido' : 'Restante'}</span>
                  <span className={`font-semibold tabular-nums ${totalExcedido > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {totalExcedido > 0 ? `+${formatMXN(totalExcedido)}` : formatMXN(totalRestante)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm pt-1.5 mt-0.5 border-t border-amber-200/60 dark:border-amber-900/40">
                  <span className="text-amber-700 dark:text-amber-400 font-medium">Falta por pagar</span>
                  <span className="font-bold tabular-nums text-amber-700 dark:text-amber-400">{formatMXN(totalFaltaPorPagar)}</span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">Pendiente de pago + presupuesto que aún no registras</p>
              </div>
            </div>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <SortableTh label="Quincena" sortKeyName="quincena" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Categoría" sortKeyName="categoria" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Descripción" sortKeyName="descripcion" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-left text-slate-500 dark:text-slate-400 font-medium">Clasificación</th>
                    <SortableTh label="Presupuestado" sortKeyName="presupuestado" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Real" sortKeyName="real" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="% usado" sortKeyName="pct" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Restante/Excedido" sortKeyName="restante" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Recurrente" sortKeyName="recurrente" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Vence" sortKeyName="vence" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-left text-slate-500 dark:text-slate-400 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                  {filasTabla.map(p => (
                    <tr key={p.id} className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors">
                      <td className="px-4 py-3"><span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">{p.quincena.codigo}</span></td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${CAT_DOT[p.categoria.nombre] ?? 'bg-slate-400'}`} />
                          {p.categoria.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100 max-w-[220px] truncate">{p.descripcion}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{p.clasificacion ?? '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${montoTipoColor(p.categoria.tipo)}`}>{formatMXN(Number(p.montoPresupuestado))}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${montoTipoColor(p.categoria.tipo)}`}>
                        <button onClick={() => setDetalleP(p)}
                          className="hover:underline hover:opacity-80 cursor-pointer transition-colors"
                          aria-label={`Ver movimientos de ${p.descripcion}`}>
                          {formatMXN(p.real)}
                        </button>
                        {p.pendiente > 0 && (
                          <span className="block text-[10px] font-medium text-amber-600 dark:text-amber-400">{formatMXN(p.pendiente)} pend.</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${pctTextColor(p.pct)}`}>{p.pct.toFixed(0)}%</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.excedido > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {p.excedido > 0 ? `+${formatMXN(p.excedido)}` : formatMXN(Number(p.montoPresupuestado) - p.real)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {p.recurrente ? (p.frecuencia === 'MENSUAL' ? 'Mensual' : 'Quincenal') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {p.fechaVencimiento ? formatDateStr(p.fechaVencimiento, { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(p)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteTarget({ id: p.id, p })}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors" aria-label="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Total · {gastoFilasTabla.length} {gastoFilasTabla.length === 1 ? 'partida' : 'partidas'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatMXN(totalPresupuestado)}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {formatMXN(totalReal)}
                      {totalPendiente > 0 && (
                        <span className="block text-[10px] font-medium text-amber-600 dark:text-amber-400">{formatMXN(totalPendiente)} pend.</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${pctTextColor(totalPct)}`}>{totalPct.toFixed(0)}%</td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${totalExcedido > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {totalExcedido > 0 ? `+${formatMXN(totalExcedido)}` : formatMXN(totalRestante)}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                  <tr className="bg-amber-50/70 dark:bg-amber-950/20 border-t border-amber-200/60 dark:border-amber-900/40">
                    <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      Falta por pagar <span className="font-normal text-amber-600/80 dark:text-amber-500/80">— pendiente de pago + presupuesto que aún no registras</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {formatMXN(totalFaltaPorPagar)}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
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
