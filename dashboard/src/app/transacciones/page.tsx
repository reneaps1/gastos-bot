'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Search, X, ArrowUpRight, ArrowDownRight, Wallet, Calendar, User, CreditCard, StickyNote, Check, AlertCircle, Download } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { formatQuincenaRange, getInitialQuincenaId, getMexicoDateString, getQuincenaIdForDate, isDateInQuincenaGap, persistQuincenaId } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { toCsv, downloadCsv } from '@/lib/csv'
import { QuincenaChips, ALL_QUINCENAS } from '@/components/ui/QuincenaChips'
import { FilterChip } from '@/components/ui/FilterChip'

const CAT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Hogar: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500' },
  Salud: { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-400', dot: 'bg-rose-500' },
  Familia: { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-700 dark:text-pink-400', dot: 'bg-pink-500' },
  Transporte: { bg: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-700 dark:text-sky-400', dot: 'bg-sky-500' },
  Suscripciones: { bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-400', dot: 'bg-violet-500' },
  Deudas: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  Personal: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  Ingresos: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  Ahorro: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
}
const DEFAULT_CAT_COLOR = { bg: 'bg-slate-50', text: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-400' }

interface Categoria { id: number; nombre: string; tipo: string }
interface User { id: number; nombre: string }
interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface MetodoPago { id: number; nombre: string }
interface Credito { id: number; nombre: string; tipoCredito: string; acreedor: string; activo: boolean; diaPago: number | null }
interface PresupuestoOption { id: number; descripcion: string; montoEfectivo: number }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: 'Gasto' | 'Ingreso' | 'Ahorro'
  monto: number; estatus: 'Pagado' | 'Pendiente'; notas: string | null
  categoria: Categoria; user: User | null; quincena: Quincena; metodoPago: MetodoPago | null
  presupuesto: { id: number; descripcion: string } | null
  quincenaId: number; categoriaId: number; userId: number | null; metodoPagoId: number | null; creditoId: number | null
  presupuestoId: number | null
}

const EMPTY_FORM = {
  fecha: getMexicoDateString(), descripcion: '', categoriaId: '',
  tipo: 'Gasto', monto: '', quincenaId: '', userId: '', metodoPagoId: '',
  creditoId: '', totalPagos: '', fechaPagoProgramada: '',
  estatus: 'Pendiente', notas: '', presupuestoId: '',
}

const LIMIT = 25

function fieldClass(error?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${error ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function TransaccionesPage() {
  const { toast } = useToast()

  const [txs, setTxs] = useState<Transaccion[]>([])
  const [total, setTotal] = useState(0)
  const [totales, setTotales] = useState({ Gasto: 0, Ingreso: 0, Ahorro: 0, GastoPagado: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  const [quincenaId, setQuincenaId] = useState('')
  const [tipo, setTipo] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [userId, setUserId] = useState('')
  const [estatus, setEstatus] = useState('')
  const [asignacion, setAsignacion] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([])
  const [creditos, setCreditos] = useState<Credito[]>([])
  const [presupuestoOpciones, setPresupuestoOpciones] = useState<PresupuestoOption[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [detailTx, setDetailTx] = useState<Transaccion | null>(null)
  const [pendingDateChange, setPendingDateChange] = useState<{ fecha: string; suggestedQuincenaId: string } | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(busqueda); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/metodos-pago').then(r => r.json()),
      fetch('/api/creditos').then(r => r.json()),
    ]).then(([q, c, u, m, cr]) => {
      setQuincenas(q)
      setCategorias(c)
      setUsers(u)
      setMetodosPago(m)
      setCreditos(cr.filter((credito: Credito) => credito.activo))
      setQuincenaId(getInitialQuincenaId(q))
    })
  }, [])

  function selectQuincena(id: string) {
    setQuincenaId(id)
    setPage(1)
    if (id !== ALL_QUINCENAS) persistQuincenaId(id)
  }

  const fetchTxs = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    const params = new URLSearchParams()
    if (quincenaId && quincenaId !== ALL_QUINCENAS) params.set('quincenaId', quincenaId)
    if (tipo) params.set('tipo', tipo)
    if (categoriaId) params.set('categoriaId', categoriaId)
    if (userId) params.set('userId', userId)
    if (estatus) params.set('estatus', estatus)
    if (asignacion) params.set('asignado', asignacion)
    if (debouncedSearch) params.set('busqueda', debouncedSearch)
    params.set('page', page.toString())
    params.set('limit', LIMIT.toString())
    try {
      const res = await fetch(`/api/transacciones?${params}`)
      const json = await res.json()
      setTxs(json.data ?? [])
      setTotal(json.pagination?.total ?? 0)
      setTotales(json.totales ?? { Gasto: 0, Ingreso: 0, Ahorro: 0, GastoPagado: 0 })
    } finally { setLoading(false) }
  }, [quincenaId, tipo, categoriaId, userId, estatus, asignacion, debouncedSearch, page])

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchTxs() }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchTxs])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!modalOpen || !form.quincenaId || !form.categoriaId) {
        setPresupuestoOpciones([])
        return
      }
      const params = new URLSearchParams({ quincenaId: form.quincenaId, categoriaId: form.categoriaId })
      fetch(`/api/presupuestos?${params}`)
        .then(r => r.json())
        .then((data: PresupuestoOption[]) => setPresupuestoOpciones(data))
        .catch(() => setPresupuestoOpciones([]))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [modalOpen, form.quincenaId, form.categoriaId])

  function openCreate() {
    setEditingTx(null)
    const dateQuincenaId = getQuincenaIdForDate(quincenas, EMPTY_FORM.fecha)
    setForm({ ...EMPTY_FORM, quincenaId: dateQuincenaId || (quincenaId !== ALL_QUINCENAS ? quincenaId : '') })
    setFormErrors({})
    setModalOpen(true)
  }

  function setFormDate(fecha: string) {
    const dateQuincenaId = getQuincenaIdForDate(quincenas, fecha)
    if (editingTx && dateQuincenaId && dateQuincenaId !== form.quincenaId) {
      setForm(f => ({ ...f, fecha }))
      setPendingDateChange({ fecha, suggestedQuincenaId: dateQuincenaId })
    } else {
      setForm(f => ({ ...f, fecha, quincenaId: dateQuincenaId || f.quincenaId, presupuestoId: dateQuincenaId && dateQuincenaId !== f.quincenaId ? '' : f.presupuestoId }))
    }
  }

  function setMetodoPago(metodoPagoId: string) {
    const metodo = metodosPago.find(m => m.id.toString() === metodoPagoId)
    setForm(f => ({
      ...f,
      metodoPagoId,
      estatus: metodo?.nombre === 'Credito' ? 'Pendiente' : f.estatus,
      creditoId: metodo?.nombre === 'Credito' ? f.creditoId : '',
      totalPagos: metodo?.nombre === 'Credito' ? f.totalPagos : '',
      fechaPagoProgramada: metodo?.nombre === 'Credito' ? f.fechaPagoProgramada : '',
    }))
  }

  function openEdit(tx: Transaccion) {
    setEditingTx(tx)
    setDetailTx(null)
    setForm({
      fecha: tx.fecha.split('T')[0], descripcion: tx.descripcion,
      categoriaId: tx.categoriaId.toString(), tipo: tx.tipo,
      monto: tx.monto.toString(), quincenaId: tx.quincenaId.toString(),
      userId: tx.userId?.toString() ?? '', metodoPagoId: tx.metodoPagoId?.toString() ?? '',
      creditoId: tx.creditoId?.toString() ?? '', totalPagos: '', fechaPagoProgramada: '',
      estatus: tx.estatus, notas: tx.notas ?? '',
      presupuestoId: tx.presupuestoId?.toString() ?? '',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.fecha) errors.fecha = 'Requerido'
    if (!form.descripcion.trim()) errors.descripcion = 'Requerido'
    if (!form.categoriaId) errors.categoriaId = 'Requerido'
    if (!form.tipo) errors.tipo = 'Requerido'
    if (!form.monto || isNaN(Number(form.monto)) || Number(form.monto) <= 0) errors.monto = 'Monto válido requerido'
    if (!form.quincenaId) errors.quincenaId = 'Requerido'
    if (isCredito) {
      if (!form.creditoId) errors.creditoId = 'Selecciona tarjeta/crédito'
      if (form.totalPagos && Number(form.totalPagos) > 1 && !form.fechaPagoProgramada) errors.fechaPagoProgramada = 'Requerido para MSI'
      if (form.totalPagos && Number(form.totalPagos) < 1) errors.totalPagos = 'Debe ser 1 o más'
    }
    return errors
  }

  async function handleSave() {
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const body = {
        fecha: form.fecha, descripcion: form.descripcion.trim(), categoriaId: form.categoriaId,
        tipo: form.tipo, monto: form.monto, quincenaId: form.quincenaId, quincenaConsumoId: form.quincenaId,
        userId: form.userId || null, metodoPagoId: form.metodoPagoId || null, creditoId: form.creditoId || null,
        totalPagos: form.totalPagos || null, fechaPagoProgramada: form.fechaPagoProgramada || null,
        estatus: form.estatus, notas: form.notas || null, source: 'dashboard',
        presupuestoId: form.presupuestoId || null,
      }
      const res = editingTx
        ? await fetch(`/api/transacciones/${editingTx.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/transacciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await res.text())
      toast(editingTx ? 'Transacción actualizada' : 'Transacción creada')
      setModalOpen(false)
      fetchTxs()
    } catch { toast('Error al guardar', 'error') } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (confirmId == null) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/transacciones/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Transacción eliminada')
      setConfirmId(null)
      setDetailTx(null)
      fetchTxs()
    } catch { toast('Error al eliminar', 'error') } finally { setDeleting(false) }
  }

  async function toggleEstatus(tx: Transaccion) {
    setTogglingId(tx.id)
    const next = tx.estatus === 'Pagado' ? 'Pendiente' : 'Pagado'
    try {
      const res = await fetch(`/api/transacciones/${tx.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estatus: next }),
      })
      if (!res.ok) throw new Error()
      setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, estatus: next } : t))
      if (detailTx?.id === tx.id) setDetailTx(prev => prev ? { ...prev, estatus: next } : prev)
    } catch { toast('Error al actualizar estatus', 'error') } finally { setTogglingId(null) }
  }

  async function handleExportCsv() {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (quincenaId && quincenaId !== ALL_QUINCENAS) params.set('quincenaId', quincenaId)
      if (tipo) params.set('tipo', tipo)
      if (categoriaId) params.set('categoriaId', categoriaId)
      if (userId) params.set('userId', userId)
      if (estatus) params.set('estatus', estatus)
      if (asignacion) params.set('asignado', asignacion)
      if (debouncedSearch) params.set('busqueda', debouncedSearch)
      params.set('page', '1')
      params.set('limit', '9999')
      const res = await fetch(`/api/transacciones?${params}`)
      const json = await res.json()
      const rows: Transaccion[] = json.data ?? []
      const csv = toCsv(rows, [
        { key: 'fecha', label: 'Fecha', value: r => formatDate(r.fecha) },
        { key: 'descripcion', label: 'Descripción', value: r => r.descripcion },
        { key: 'categoria', label: 'Categoría', value: r => r.categoria?.nombre ?? '' },
        { key: 'tipo', label: 'Tipo', value: r => r.tipo },
        { key: 'estatus', label: 'Estatus', value: r => r.estatus },
        { key: 'quincena', label: 'Quincena', value: r => r.quincena?.codigo ?? '' },
        { key: 'usuario', label: 'Usuario', value: r => r.user?.nombre ?? '' },
        { key: 'metodoPago', label: 'Método de pago', value: r => r.metodoPago?.nombre ?? '' },
        { key: 'presupuesto', label: 'Presupuesto asignado', value: r => r.presupuesto?.descripcion ?? '' },
        { key: 'monto', label: 'Monto', value: r => Number(r.monto).toFixed(2) },
      ])
      const selectedQ = quincenas.find(q => q.id.toString() === quincenaId)
      downloadCsv(`transacciones-${selectedQ?.codigo ?? 'todas'}-${getMexicoDateString()}.csv`, csv)
    } catch {
      toast('Error al exportar CSV', 'error')
    } finally {
      setExporting(false)
    }
  }

  const today = getMexicoDateString()
  const totalPages = Math.ceil(total / LIMIT)
  const totalGastos = totales.Gasto
  const totalIngresos = totales.Ingreso
  const formQuincena = quincenas.find(q => q.id.toString() === form.quincenaId)
  const suggestedQuincenaId = form.fecha ? getQuincenaIdForDate(quincenas, form.fecha) : ''
  const suggestedQuincena = quincenas.find(q => q.id.toString() === suggestedQuincenaId)
  const fechaEnGap = form.fecha ? isDateInQuincenaGap(quincenas, form.fecha) : false
  const selectedMetodo = metodosPago.find(m => m.id.toString() === form.metodoPagoId)
  const isCredito = selectedMetodo?.nombre === 'Credito'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Transacciones</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} disabled={exporting || total === 0}
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
            <Download size={16} /> {exporting ? 'Exportando...' : 'Descargar CSV'}
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
            <Plus size={16} /> Nueva transacción
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        {/* Chips de quincena */}
        <QuincenaChips quincenas={quincenas} quincenaId={quincenaId} today={today} onSelect={selectQuincena} showAll />
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip value={tipo} onChange={v => { setTipo(v); setPage(1) }} onClear={() => { setTipo(''); setPage(1) }} placeholder="Tipo">
            <option value="Gasto">Gasto</option>
            <option value="Ingreso">Ingreso</option>
            <option value="Ahorro">Ahorro</option>
          </FilterChip>
          <FilterChip value={categoriaId} onChange={v => { setCategoriaId(v); setPage(1) }} onClear={() => { setCategoriaId(''); setPage(1) }} placeholder="Categoría">
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </FilterChip>
          <FilterChip value={userId} onChange={v => { setUserId(v); setPage(1) }} onClear={() => { setUserId(''); setPage(1) }} placeholder="Usuario">
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </FilterChip>
          <FilterChip value={estatus} onChange={v => { setEstatus(v); setPage(1) }} onClear={() => { setEstatus(''); setPage(1) }} placeholder="Estatus">
            <option value="Pagado">Pagado</option>
            <option value="Pendiente">Pendiente</option>
          </FilterChip>
          <FilterChip value={asignacion} onChange={v => { setAsignacion(v); setPage(1) }} onClear={() => { setAsignacion(''); setPage(1) }} placeholder="Asignación">
            <option value="si">Asignada</option>
            <option value="no">Sin asignar</option>
          </FilterChip>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input type="text" placeholder="Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-8 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} aria-label="Quitar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        {quincenaId !== ALL_QUINCENAS && <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Registros</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{total}</p>
        </div>
        <div className="min-w-0 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-900/30 p-4 text-center">
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Ingresos</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">{formatMXN(totalIngresos)}</p>
        </div>
        <div className="min-w-0 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-900/30 p-4 text-center">
          <p className="text-xs text-rose-600 dark:text-rose-400 mb-1">Gastos</p>
          <p className="text-xl sm:text-2xl font-bold text-rose-700 dark:text-rose-400 tabular-nums whitespace-nowrap">{formatMXN(totalGastos)}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center text-slate-400 dark:text-slate-500 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : txs.length === 0 ? (
          <div className="text-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              <Wallet size={28} className="text-slate-300 dark:text-slate-500" />
            </div>
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin transacciones</p>
            <p className="text-sm mt-1">
              {quincenaId || tipo || categoriaId || userId || estatus || asignacion || debouncedSearch
                ? 'No hay resultados para los filtros seleccionados'
                : 'Crea una transacción para comenzar'}
            </p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
            {txs.map(tx => {
              const catColor = CAT_COLORS[tx.categoria?.nombre] ?? DEFAULT_CAT_COLOR
              return (
                <button
                  key={tx.id}
                  onClick={() => setDetailTx(tx)}
                  className="w-full text-left px-4 py-4 bg-white dark:bg-slate-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{tx.descripcion}</p>
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{formatDate(tx.fecha)} · {tx.quincena.codigo}</p>
                    </div>
                    <p className={`shrink-0 text-base font-bold tabular-nums ${
                      tx.tipo === 'Ingreso' ? 'text-emerald-600 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${catColor.bg} ${catColor.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${catColor.dot}`} />
                      {tx.categoria?.nombre}
                    </span>
                    {tx.tipo !== 'Gasto' && (
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                        tx.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {tx.tipo === 'Ingreso' ? <ArrowUpRight size={11} /> : <Wallet size={11} />}
                        {tx.tipo}
                      </span>
                    )}
                    {tx.presupuestoId ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                        <Check size={11} /> Asignada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        <AlertCircle size={11} /> Sin asignar
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); toggleEstatus(tx) }}
                      disabled={togglingId === tx.id}
                      className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                        tx.estatus === 'Pagado' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                      } disabled:opacity-50`}
                    >
                      {togglingId === tx.id ? '...' : tx.estatus}
                    </button>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Descripción</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Categoría</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Presup.</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Quincena</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Fecha</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden lg:table-cell">Usuario</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estatus</th>
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {txs.map(tx => {
                  const catColor = CAT_COLORS[tx.categoria?.nombre] ?? DEFAULT_CAT_COLOR
                  return (
                    <tr key={tx.id} onClick={() => setDetailTx(tx)}
                      className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 cursor-pointer transition-colors group">
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-slate-800 dark:text-slate-100 group-hover:text-indigo-700 transition-colors max-w-[200px] block truncate">{tx.descripcion}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${catColor.bg} ${catColor.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${catColor.dot}`} />
                          {tx.categoria?.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {tx.presupuestoId ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400" title={tx.presupuesto?.descripcion}>
                            <Check size={10} /> Asignada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                            <AlertCircle size={10} /> Sin asignar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">{tx.quincena.codigo}</span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">{formatDate(tx.fecha)}</td>
                      <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 hidden lg:table-cell">{tx.user?.nombre ?? '—'}</td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          tx.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                        }`}>
                          {tx.tipo === 'Ingreso' ? <ArrowUpRight size={11} /> : tx.tipo === 'Ahorro' ? <Wallet size={11} /> : <ArrowDownRight size={11} />}
                          {tx.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button onClick={e => { e.stopPropagation(); toggleEstatus(tx) }} disabled={togglingId === tx.id}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                            tx.estatus === 'Pagado' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                          } disabled:opacity-50`}>
                          {togglingId === tx.id ? '...' : tx.estatus}
                        </button>
                      </td>
                      <td className={`px-4 py-3.5 text-right font-bold tabular-nums ${
                        tx.tipo === 'Ingreso' ? 'text-emerald-600 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm text-slate-500 dark:text-slate-400">
            <span>{(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} de {total}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-default">
                <ChevronLeft size={14} /> Anterior
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-default">
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Side Panel */}
      {detailTx && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity" onClick={() => setDetailTx(null)} />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white dark:bg-slate-800 shadow-2xl flex flex-col animate-slide-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Detalle</h3>
              <button onClick={() => setDetailTx(null)} className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg cursor-pointer transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="text-center pb-4 border-b border-slate-100 dark:border-slate-700">
                <p className={`text-3xl font-bold tabular-nums ${detailTx.tipo === 'Ingreso' ? 'text-emerald-600' : detailTx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'}`}>
                  {detailTx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(detailTx.monto))}
                </p>
                <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 mt-2">{detailTx.descripcion}</p>
              </div>

              <div className="space-y-3">
                <DetailRow icon={<Calendar size={16} />} label="Fecha" value={
                  <div className="text-right">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{formatDate(detailTx.fecha)}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {detailTx.quincena.codigo} · {formatDate(detailTx.quincena.fechaInicio)} – {formatDate(detailTx.quincena.fechaFin)}
                    </p>
                  </div>
                } />
                <DetailRow icon={<CreditCard size={16} />} label="Quincena" value={
                  <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">{detailTx.quincena.codigo}</span>
                } />
                <DetailRow icon={<div className={`w-2 h-2 rounded-full ${(CAT_COLORS[detailTx.categoria?.nombre] ?? DEFAULT_CAT_COLOR).dot}`} />} label="Categoría" value={detailTx.categoria?.nombre} />
                <DetailRow icon={<Wallet size={16} />} label="Partida de presupuesto" value={
                  detailTx.presupuesto
                    ? <span className="text-indigo-600 dark:text-indigo-400">{detailTx.presupuesto.descripcion}</span>
                    : <span className="text-amber-600 dark:text-amber-400">Sin asignar</span>
                } />
                <DetailRow icon={<User size={16} />} label="Usuario" value={detailTx.user?.nombre ?? 'Sin asignar'} />
                {detailTx.metodoPago && (
                  <DetailRow icon={<CreditCard size={16} />} label="Método de pago" value={detailTx.metodoPago.nombre} />
                )}
                <DetailRow icon={<Wallet size={16} />} label="Tipo" value={
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    detailTx.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : detailTx.tipo === 'Ahorro' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                  }`}>{detailTx.tipo}</span>
                } />
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <StickyNote size={16} /> Estatus
                  </span>
                  <button onClick={() => toggleEstatus(detailTx)} disabled={togglingId === detailTx.id}
                    className={`text-xs font-semibold px-3 py-1 rounded-full cursor-pointer transition-colors ${
                      detailTx.estatus === 'Pagado' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                    } disabled:opacity-50`}>
                    {togglingId === detailTx.id ? '...' : detailTx.estatus}
                  </button>
                </div>
                {detailTx.notas && (
                  <DetailRow icon={<StickyNote size={16} />} label="Notas" value={<span className="text-slate-600 dark:text-slate-400">{detailTx.notas}</span>} />
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex gap-3">
              <button onClick={() => openEdit(detailTx)}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
                <Pencil size={14} /> Editar
              </button>
              <button onClick={() => { setConfirmId(detailTx.id) }}
                className="flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-rose-200 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer transition-colors">
                <Trash2 size={14} /> Eliminar
              </button>
            </div>
          </div>
        </>
      )}

      <style jsx global>{`
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
      `}</style>

      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editingTx ? 'Editar transacción' : 'Nueva transacción'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-fecha">Fecha *</Label>
              <input id="tx-fecha" type="date" value={form.fecha} onChange={e => setFormDate(e.target.value)} className={fieldClass(formErrors.fecha)} />
              {formErrors.fecha && <p className="text-xs text-rose-500 mt-1">{formErrors.fecha}</p>}
              {fechaEnGap && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Esta fecha cae entre quincenas. Selecciona la quincena manualmente.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="tx-quincena">Quincena *</Label>
              <select id="tx-quincena" value={form.quincenaId} onChange={e => setForm(f => ({ ...f, quincenaId: e.target.value, presupuestoId: '' }))} className={fieldClass(formErrors.quincenaId)}>
                <option value="">Seleccionar...</option>
                {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </select>
              {formQuincena && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  {formQuincena.codigo}: {formatQuincenaRange(formQuincena)}
                </p>
              )}
              {!formQuincena && form.fecha && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  No hay Q configurada para esta fecha.
                </p>
              )}
              {suggestedQuincena && form.quincenaId !== suggestedQuincena.id.toString() && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, quincenaId: suggestedQuincena.id.toString(), presupuestoId: '' }))}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-1 cursor-pointer hover:underline"
                >
                  Usar {suggestedQuincena.codigo} según fecha
                </button>
              )}
              {formErrors.quincenaId && <p className="text-xs text-rose-500 mt-1">{formErrors.quincenaId}</p>}
            </div>
          </div>
          <div>
            <Label htmlFor="tx-desc">Descripción *</Label>
            <input id="tx-desc" type="text" placeholder="Ej: Renta, Super, Gasolina..." value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={fieldClass(formErrors.descripcion)} />
            {formErrors.descripcion && <p className="text-xs text-rose-500 mt-1">{formErrors.descripcion}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-categoria">Categoría *</Label>
              <select id="tx-categoria" value={form.categoriaId} onChange={e => setForm(f => ({ ...f, categoriaId: e.target.value, presupuestoId: '' }))} className={fieldClass(formErrors.categoriaId)}>
                <option value="">Seleccionar...</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              {formErrors.categoriaId && <p className="text-xs text-rose-500 mt-1">{formErrors.categoriaId}</p>}
            </div>
            <div>
              <Label htmlFor="tx-tipo">Tipo *</Label>
              <select id="tx-tipo" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} className={fieldClass(formErrors.tipo)}>
                <option value="Gasto">Gasto</option>
                <option value="Ingreso">Ingreso</option>
                <option value="Ahorro">Ahorro</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="tx-presupuesto">Línea de presupuesto</Label>
            <select id="tx-presupuesto" value={form.presupuestoId} onChange={e => setForm(f => ({ ...f, presupuestoId: e.target.value }))} className={fieldClass()} disabled={!form.categoriaId || !form.quincenaId}>
              <option value="">Sin asignar</option>
              {presupuestoOpciones.map(p => (
                <option key={p.id} value={p.id}>{p.descripcion} ({formatMXN(p.montoEfectivo)})</option>
              ))}
            </select>
            {form.categoriaId && form.quincenaId && presupuestoOpciones.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Esta categoría no tiene partidas de presupuesto en esta quincena.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-monto">Monto (MXN) *</Label>
              <input id="tx-monto" type="number" min="0" step="0.01" placeholder="0.00" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} className={fieldClass(formErrors.monto)} />
              {formErrors.monto && <p className="text-xs text-rose-500 mt-1">{formErrors.monto}</p>}
            </div>
            <div>
              <Label htmlFor="tx-estatus">Estatus</Label>
              <select id="tx-estatus" value={form.estatus} onChange={e => setForm(f => ({ ...f, estatus: e.target.value }))} className={fieldClass()}>
                <option value="Pendiente">Pendiente</option>
                <option value="Pagado">Pagado</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-usuario">Usuario</Label>
              <select id="tx-usuario" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} className={fieldClass()}>
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="tx-metodo">Método de pago</Label>
              <select id="tx-metodo" value={form.metodoPagoId} onChange={e => setMetodoPago(e.target.value)} className={fieldClass()}>
                <option value="">Sin especificar</option>
                {metodosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
          </div>

          {isCredito && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/20 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Compra con crédito / MSI</p>
                <p className="text-xs text-indigo-600/80 dark:text-indigo-300/70 mt-1">
                  Selecciona con qué tarjeta o crédito se pagará. Si es MSI, el sistema generará pagos programados por quincena.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tx-credito">Tarjeta o crédito *</Label>
                  <select id="tx-credito" value={form.creditoId} onChange={e => setForm(f => ({ ...f, creditoId: e.target.value }))} className={fieldClass(formErrors.creditoId)}>
                    <option value="">Seleccionar...</option>
                    {creditos.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.tipoCredito}</option>)}
                  </select>
                  {formErrors.creditoId && <p className="text-xs text-rose-500 mt-1">{formErrors.creditoId}</p>}
                </div>
                <div>
                  <Label htmlFor="tx-total-pagos">Pagos / MSI</Label>
                  <input id="tx-total-pagos" type="number" min="1" step="1" placeholder="Ej: 1, 3, 6, 12" value={form.totalPagos} onChange={e => setForm(f => ({ ...f, totalPagos: e.target.value }))} className={fieldClass(formErrors.totalPagos)} />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Usa 1 para crédito normal o 3/6/12 para MSI.</p>
                  {formErrors.totalPagos && <p className="text-xs text-rose-500 mt-1">{formErrors.totalPagos}</p>}
                </div>
              </div>

              <div>
                <Label htmlFor="tx-fecha-pago">Fecha del primer pago</Label>
                <input id="tx-fecha-pago" type="date" value={form.fechaPagoProgramada} onChange={e => setForm(f => ({ ...f, fechaPagoProgramada: e.target.value }))} className={fieldClass(formErrors.fechaPagoProgramada)} />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  A partir de esta fecha se crean los pagos mensuales. Cada pago cae en la Q correspondiente a su fecha.
                </p>
                {formErrors.fechaPagoProgramada && <p className="text-xs text-rose-500 mt-1">{formErrors.fechaPagoProgramada}</p>}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="tx-notas">Notas</Label>
            <textarea id="tx-notas" rows={2} placeholder="Notas adicionales (opcional)" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} className={`${fieldClass()} resize-none`} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">
              {saving ? 'Guardando...' : editingTx ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      {pendingDateChange && (() => {
        const suggestedQ = quincenas.find(q => q.id.toString() === pendingDateChange.suggestedQuincenaId)
        const currentQ = quincenas.find(q => q.id.toString() === form.quincenaId)
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl p-6 w-full max-w-sm space-y-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">¿Mover a otra quincena?</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                La fecha seleccionada pertenece a{' '}
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">{suggestedQ?.codigo}</span>
                , diferente a la quincena actual{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-300">{currentQ?.codigo}</span>.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setForm(f => ({ ...f, quincenaId: pendingDateChange.suggestedQuincenaId, presupuestoId: '' }))
                    setPendingDateChange(null)
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                >
                  Mover a {suggestedQ?.codigo}
                </button>
                <button
                  onClick={() => setPendingDateChange(null)}
                  className="flex-1 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors"
                >
                  Mantener {currentQ?.codigo}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <ConfirmDialog open={confirmId != null} onOpenChange={open => !open && setConfirmId(null)}
        title="Eliminar transacción" description="Esta acción no se puede deshacer. La transacción se eliminará permanentemente."
        onConfirm={handleDelete} loading={deleting} />
    </div>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">{icon} {label}</span>
      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  )
}
