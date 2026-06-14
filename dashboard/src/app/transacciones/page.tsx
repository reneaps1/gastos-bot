'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'

const EMOJI: Record<string, string> = {
  Hogar: '🏠', Salud: '💊', Familia: '👨‍👩‍👧', Transporte: '🚗',
  Suscripciones: '📱', Deudas: '💳', Personal: '🎯', Ingresos: '💵', Ahorro: '🏦',
}

interface Categoria { id: number; nombre: string; tipo: string }
interface User { id: number; nombre: string }
interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface MetodoPago { id: number; nombre: string }
interface Transaccion {
  id: number
  fecha: string
  descripcion: string
  tipo: 'Gasto' | 'Ingreso' | 'Ahorro'
  monto: number
  estatus: 'Pagado' | 'Pendiente'
  notas: string | null
  categoria: Categoria
  user: User | null
  quincena: Quincena
  metodoPago: MetodoPago | null
  quincenaId: number
  categoriaId: number
  userId: number | null
  metodoPagoId: number | null
}

const EMPTY_FORM = {
  fecha: new Date().toISOString().split('T')[0],
  descripcion: '',
  categoriaId: '',
  tipo: 'Gasto',
  monto: '',
  quincenaId: '',
  userId: '',
  metodoPagoId: '',
  estatus: 'Pendiente',
  notas: '',
}

const LIMIT = 25

function fieldClass(error?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    error ? 'border-rose-400' : 'border-slate-200'
  }`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 mb-1">
      {children}
    </label>
  )
}

export default function TransaccionesPage() {
  const { toast } = useToast()

  const [txs, setTxs] = useState<Transaccion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  // Filters
  const [quincenaId, setQuincenaId] = useState('')
  const [tipo, setTipo] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [userId, setUserId] = useState('')
  const [estatus, setEstatus] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Catalog data
  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([])

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  // Form state
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(busqueda)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  // Load catalogs once
  useEffect(() => {
    Promise.all([
      fetch('/api/quincenas').then(r => r.json()),
      fetch('/api/categorias').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/metodos-pago').then(r => r.json()),
    ]).then(([q, c, u, m]) => {
      setQuincenas(q)
      setCategorias(c)
      setUsers(u)
      setMetodosPago(m)
    })
  }, [])

  const fetchTxs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (quincenaId) params.set('quincenaId', quincenaId)
    if (tipo) params.set('tipo', tipo)
    if (categoriaId) params.set('categoriaId', categoriaId)
    if (userId) params.set('userId', userId)
    if (estatus) params.set('estatus', estatus)
    if (debouncedSearch) params.set('busqueda', debouncedSearch)
    params.set('page', page.toString())
    params.set('limit', LIMIT.toString())
    try {
      const res = await fetch(`/api/transacciones?${params}`)
      const json = await res.json()
      setTxs(json.data ?? [])
      setTotal(json.pagination?.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [quincenaId, tipo, categoriaId, userId, estatus, debouncedSearch, page])

  useEffect(() => { fetchTxs() }, [fetchTxs])

  function openCreate() {
    setEditingTx(null)
    setForm({ ...EMPTY_FORM, quincenaId: quincenaId })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(tx: Transaccion) {
    setEditingTx(tx)
    setForm({
      fecha: tx.fecha.split('T')[0],
      descripcion: tx.descripcion,
      categoriaId: tx.categoriaId.toString(),
      tipo: tx.tipo,
      monto: tx.monto.toString(),
      quincenaId: tx.quincenaId.toString(),
      userId: tx.userId?.toString() ?? '',
      metodoPagoId: tx.metodoPagoId?.toString() ?? '',
      estatus: tx.estatus,
      notas: tx.notas ?? '',
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
        categoriaId: form.categoriaId,
        tipo: form.tipo,
        monto: form.monto,
        quincenaId: form.quincenaId,
        userId: form.userId || null,
        metodoPagoId: form.metodoPagoId || null,
        estatus: form.estatus,
        notas: form.notas || null,
        source: 'dashboard',
      }

      const res = editingTx
        ? await fetch(`/api/transacciones/${editingTx.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/transacciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

      if (!res.ok) throw new Error(await res.text())
      toast(editingTx ? 'Transacción actualizada' : 'Transacción creada')
      setModalOpen(false)
      fetchTxs()
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
      const res = await fetch(`/api/transacciones/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Transacción eliminada')
      setConfirmId(null)
      fetchTxs()
    } catch {
      toast('Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function toggleEstatus(tx: Transaccion) {
    setTogglingId(tx.id)
    const next = tx.estatus === 'Pagado' ? 'Pendiente' : 'Pagado'
    try {
      const res = await fetch(`/api/transacciones/${tx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estatus: next }),
      })
      if (!res.ok) throw new Error()
      setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, estatus: next } : t))
    } catch {
      toast('Error al actualizar estatus', 'error')
    } finally {
      setTogglingId(null)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)
  const totalGastos = txs.filter(t => t.tipo === 'Gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + Number(t.monto), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Transacciones</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
        >
          <Plus size={16} />
          Nueva transacción
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <select
            value={quincenaId}
            onChange={e => { setQuincenaId(e.target.value); setPage(1) }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Todas las quincenas</option>
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
          <select
            value={tipo}
            onChange={e => { setTipo(e.target.value); setPage(1) }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Todos los tipos</option>
            <option value="Gasto">Gasto</option>
            <option value="Ingreso">Ingreso</option>
            <option value="Ahorro">Ahorro</option>
          </select>
          <select
            value={categoriaId}
            onChange={e => { setCategoriaId(e.target.value); setPage(1) }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Todas las categorías</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select
            value={userId}
            onChange={e => { setUserId(e.target.value); setPage(1) }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Todos los usuarios</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select
            value={estatus}
            onChange={e => { setEstatus(e.target.value); setPage(1) }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="">Todos los estatus</option>
            <option value="Pagado">Pagado</option>
            <option value="Pendiente">Pendiente</option>
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar descripción..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">Total registros</p>
          <p className="text-2xl font-bold text-slate-800">{total}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 text-center">
          <p className="text-xs text-emerald-600 mb-1">Total ingresos</p>
          <p className="text-2xl font-bold text-emerald-700">{formatMXN(totalIngresos)}</p>
        </div>
        <div className="bg-rose-50 rounded-xl border border-rose-100 p-4 text-center">
          <p className="text-xs text-rose-600 mb-1">Total gastos</p>
          <p className="text-2xl font-bold text-rose-700">{formatMXN(totalGastos)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center text-slate-400 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : txs.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-5xl mb-3">📭</p>
            <p className="font-medium">Sin transacciones</p>
            <p className="text-sm mt-1">
              {quincenaId || tipo || categoriaId || userId || estatus || debouncedSearch
                ? 'No hay resultados para los filtros seleccionados'
                : 'Crea una transacción o importa el Excel'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Descripción</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Categoría</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Quincena</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium hidden md:table-cell">Fecha</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium hidden lg:table-cell">Usuario</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Estatus</th>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">Monto</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {txs.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-800 max-w-[200px] truncate">{tx.descripcion}</td>
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span>{EMOJI[tx.categoria.nombre] ?? '📦'}</span>
                        {tx.categoria.nombre}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {tx.quincena.codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 hidden md:table-cell">{formatDate(tx.fecha)}</td>
                    <td className="px-4 py-3.5 text-slate-500 hidden lg:table-cell">{tx.user?.nombre ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => toggleEstatus(tx)}
                        disabled={togglingId === tx.id}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          tx.estatus === 'Pagado'
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        } disabled:opacity-50`}
                      >
                        {togglingId === tx.id ? '...' : tx.estatus}
                      </button>
                    </td>
                    <td className={`px-4 py-3.5 text-right font-semibold ${
                      tx.tipo === 'Ingreso' ? 'text-emerald-600' : tx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'
                    }`}>
                      {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(tx)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer transition-colors"
                          aria-label="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmId(tx.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                          aria-label="Eliminar"
                        >
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

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>
              {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} de {total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <FormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingTx ? 'Editar transacción' : 'Nueva transacción'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-fecha">Fecha *</Label>
              <input
                id="tx-fecha"
                type="date"
                value={form.fecha}
                onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                className={fieldClass(formErrors.fecha)}
              />
              {formErrors.fecha && <p className="text-xs text-rose-500 mt-1">{formErrors.fecha}</p>}
            </div>
            <div>
              <Label htmlFor="tx-quincena">Quincena *</Label>
              <select
                id="tx-quincena"
                value={form.quincenaId}
                onChange={e => setForm(f => ({ ...f, quincenaId: e.target.value }))}
                className={fieldClass(formErrors.quincenaId)}
              >
                <option value="">Seleccionar...</option>
                {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </select>
              {formErrors.quincenaId && <p className="text-xs text-rose-500 mt-1">{formErrors.quincenaId}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="tx-desc">Descripción *</Label>
            <input
              id="tx-desc"
              type="text"
              placeholder="Ej: Renta, Super, Gasolina..."
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              className={fieldClass(formErrors.descripcion)}
            />
            {formErrors.descripcion && <p className="text-xs text-rose-500 mt-1">{formErrors.descripcion}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-categoria">Categoría *</Label>
              <select
                id="tx-categoria"
                value={form.categoriaId}
                onChange={e => setForm(f => ({ ...f, categoriaId: e.target.value }))}
                className={fieldClass(formErrors.categoriaId)}
              >
                <option value="">Seleccionar...</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              {formErrors.categoriaId && <p className="text-xs text-rose-500 mt-1">{formErrors.categoriaId}</p>}
            </div>
            <div>
              <Label htmlFor="tx-tipo">Tipo *</Label>
              <select
                id="tx-tipo"
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                className={fieldClass(formErrors.tipo)}
              >
                <option value="Gasto">Gasto</option>
                <option value="Ingreso">Ingreso</option>
                <option value="Ahorro">Ahorro</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-monto">Monto (MXN) *</Label>
              <input
                id="tx-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.monto}
                onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                className={fieldClass(formErrors.monto)}
              />
              {formErrors.monto && <p className="text-xs text-rose-500 mt-1">{formErrors.monto}</p>}
            </div>
            <div>
              <Label htmlFor="tx-estatus">Estatus</Label>
              <select
                id="tx-estatus"
                value={form.estatus}
                onChange={e => setForm(f => ({ ...f, estatus: e.target.value }))}
                className={fieldClass()}
              >
                <option value="Pendiente">Pendiente</option>
                <option value="Pagado">Pagado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tx-usuario">Usuario</Label>
              <select
                id="tx-usuario"
                value={form.userId}
                onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
                className={fieldClass()}
              >
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="tx-metodo">Método de pago</Label>
              <select
                id="tx-metodo"
                value={form.metodoPagoId}
                onChange={e => setForm(f => ({ ...f, metodoPagoId: e.target.value }))}
                className={fieldClass()}
              >
                <option value="">Sin especificar</option>
                {metodosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="tx-notas">Notas</Label>
            <textarea
              id="tx-notas"
              rows={2}
              placeholder="Notas adicionales (opcional)"
              value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              className={`${fieldClass()} resize-none`}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]"
            >
              {saving ? 'Guardando...' : editingTx ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={open => !open && setConfirmId(null)}
        title="Eliminar transacción"
        description="Esta acción no se puede deshacer. La transacción se eliminará permanentemente."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
