'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, Search, Filter, Download, Upload, GripVertical, Check, X, Archive, ArchiveRestore, ChevronDown } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'

interface Categoria {
  id: number
  nombre: string
  tipo: string
  clasificacion: string | null
  ejemplos: string | null
  activo: boolean
  cuentaParaLimite: boolean
  transaccionesCount: number
}

const CAT_COLORS: Record<string, string> = {
  Hogar: 'bg-orange-500', Salud: 'bg-rose-500', Familia: 'bg-pink-500',
  Transporte: 'bg-sky-500', Suscripciones: 'bg-violet-500', Deudas: 'bg-red-500',
  Personal: 'bg-amber-500', Ingresos: 'bg-emerald-500', Ahorro: 'bg-blue-500',
}

const AVAILABLE_COLORS = [
  { name: 'Naranja', class: 'bg-orange-500' },
  { name: 'Rosa', class: 'bg-rose-500' },
  { name: 'Pink', class: 'bg-pink-500' },
  { name: 'Celeste', class: 'bg-sky-500' },
  { name: 'Violeta', class: 'bg-violet-500' },
  { name: 'Rojo', class: 'bg-red-500' },
  { name: 'Ambar', class: 'bg-amber-500' },
  { name: 'Verde', class: 'bg-emerald-500' },
  { name: 'Azul', class: 'bg-blue-500' },
  { name: 'Slate', class: 'bg-slate-500' },
  { name: 'Indigo', class: 'bg-indigo-500' },
  { name: 'Teal', class: 'bg-teal-500' },
]

const EMPTY_FORM = { nombre: '', tipo: 'Gasto', clasificacion: '', ejemplos: '', activo: true, cuentaParaLimite: true, color: 'bg-slate-500' }

function fieldClass(err?: string) {
  return `w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">{children}</label>
}

export default function AdminCategoriasPage() {
  const { toast } = useToast()

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState('')

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [deleteTarget, setDeleteTarget] = useState<Categoria | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const filtered = categorias.filter(c => {
    if (search && !c.nombre.toLowerCase().includes(search.toLowerCase())) return false
    if (filterTipo && c.tipo !== filterTipo) return false
    if (filterEstado === 'activo' && !c.activo) return false
    if (filterEstado === 'inactivo' && c.activo) return false
    return true
  })

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const someSelected = selected.size > 0

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(c => c.id)))
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(c: Categoria) {
    setEditing(c)
    setForm({
      nombre: c.nombre,
      tipo: c.tipo,
      clasificacion: c.clasificacion ?? '',
      ejemplos: c.ejemplos ?? '',
      activo: c.activo,
      cuentaParaLimite: c.cuentaParaLimite,
      color: CAT_COLORS[c.nombre] ?? 'bg-slate-500',
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.nombre.trim()) errors.nombre = 'Requerido'
    if (!form.tipo) errors.tipo = 'Requerido'
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
        clasificacion: form.clasificacion || null,
        ejemplos: form.ejemplos || null,
        activo: form.activo,
        cuentaParaLimite: form.cuentaParaLimite,
      }
      const res = editing
        ? await fetch(`/api/categorias/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/categorias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error')
      }
      toast(editing ? 'Categoría actualizada' : 'Categoría creada')
      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      toast(e.message || 'Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/categorias/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error')
      }
      toast('Categoría eliminada')
      setDeleteTarget(null)
      fetchData()
    } catch (e: any) {
      toast(e.message || 'Error al eliminar', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleBulkAction(action: 'activate' | 'deactivate') {
    if (selected.size === 0) return
    const activo = action === 'activate'
    try {
      await Promise.all(
        Array.from(selected).map(id =>
          fetch(`/api/categorias/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo }),
          })
        )
      )
      toast(`${selected.size} categoría${selected.size > 1 ? 's' : ''} ${activo ? 'activada' : 'desactivada'}${selected.size > 1 ? 's' : ''}`)
      setSelected(new Set())
      fetchData()
    } catch {
      toast('Error en operación masiva', 'error')
    }
  }

  function handleDragStart(id: number) {
    setDragId(id)
  }

  function handleDragOver(e: React.DragEvent, id: number) {
    e.preventDefault()
    setDragOverId(id)
  }

  function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) {
      setDragId(null)
      setDragOverId(null)
      return
    }
    const fromIdx = categorias.findIndex(c => c.id === dragId)
    const toIdx = categorias.findIndex(c => c.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...categorias]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setCategorias(reordered)
    setDragId(null)
    setDragOverId(null)
  }

  function handleExport() {
    const data = categorias.map(c => ({
      nombre: c.nombre,
      tipo: c.tipo,
      clasificacion: c.clasificacion,
      ejemplos: c.ejemplos,
      activo: c.activo,
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `categorias-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Exportado correctamente')
  }

  function handleImport() {
    fileInputRef.current?.click()
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data)) throw new Error('Formato inválido')
      let created = 0
      for (const item of data) {
        if (!item.nombre || !item.tipo) continue
        const res = await fetch('/api/categorias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        })
        if (res.ok) created++
      }
      toast(`${created} categoría${created !== 1 ? 'as' : ''} importada${created !== 1 ? 's' : ''}`)
      fetchData()
    } catch {
      toast('Error al importar archivo', 'error')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Administrador de Categorías</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {categorias.length} categoría{categorias.length !== 1 ? 'as' : ''} · {categorias.filter(c => c.activo).length} activa{categorias.filter(c => c.activo).length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
            className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer transition-colors">
            <Download size={14} /> Exportar
          </button>
          <button onClick={handleImport}
            className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer transition-colors">
            <Upload size={14} /> Importar
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
            <Plus size={16} /> Nueva
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input type="text" placeholder="Buscar categoría..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer">
            <option value="">Todos los tipos</option>
            <option value="Gasto">Gasto</option>
            <option value="Ingreso">Ingreso</option>
            <option value="Ahorro">Ahorro</option>
          </select>
          <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer">
            <option value="">Todos los estados</option>
            <option value="activo">Activas</option>
            <option value="inactivo">Inactivas</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Mostrando {filtered.length} de {categorias.length}
        </p>
      </div>

      {/* Bulk Actions */}
      {someSelected && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 flex items-center justify-between flex-wrap gap-3 animate-in">
          <span className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
            {selected.size} seleccionada{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => handleBulkAction('activate')}
              className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 px-3 py-1.5 rounded-lg cursor-pointer font-medium transition-colors">
              <ArchiveRestore size={13} /> Activar
            </button>
            <button onClick={() => handleBulkAction('deactivate')}
              className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 px-3 py-1.5 rounded-lg cursor-pointer font-medium transition-colors">
              <Archive size={13} /> Desactivar
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 cursor-pointer">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer" />
                  </th>
                  <th className="w-8" />
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Categoría</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Clasificación</th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden lg:table-cell">Ejemplos</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Uso</th>
                  <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {filtered.map(c => (
                  <tr key={c.id}
                    draggable
                    onDragStart={() => handleDragStart(c.id)}
                    onDragOver={e => handleDragOver(e, c.id)}
                    onDrop={() => handleDrop(c.id)}
                    onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                    className={`transition-colors ${dragOverId === c.id ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'} ${dragId === c.id ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer" />
                    </td>
                    <td className="px-1 py-3">
                      <GripVertical size={14} className="text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing" />
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5 font-medium text-slate-800 dark:text-slate-100">
                        <span className={`w-3 h-3 rounded-full shrink-0 ${CAT_COLORS[c.nombre] ?? 'bg-slate-400'}`} />
                        {c.nombre}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.tipo === 'Gasto' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' :
                        c.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {c.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {c.clasificacion ?? <span className="text-slate-400 dark:text-slate-500 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs max-w-[200px] truncate hidden lg:table-cell">
                      {c.ejemplos ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium ${c.transaccionesCount > 0 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        {c.transaccionesCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.activo
                        ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-semibold"><Check size={12} /> Activo</span>
                        : <span className="text-slate-400 dark:text-slate-500 text-xs">Inactivo</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)}
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors"
                          aria-label="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteTarget(c)}
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors"
                          aria-label="Eliminar">
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
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <CardSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map(c => (
            <div key={c.id}
              draggable
              onDragStart={() => handleDragStart(c.id)}
              onDragOver={e => handleDragOver(e, c.id)}
              onDrop={() => handleDrop(c.id)}
              onDragEnd={() => { setDragId(null); setDragOverId(null) }}
              className={`bg-white dark:bg-slate-800 rounded-xl border p-4 transition-all ${
                dragOverId === c.id ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700'
              } ${dragId === c.id ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer" />
                  <span className={`w-4 h-4 rounded-full shrink-0 ${CAT_COLORS[c.nombre] ?? 'bg-slate-400'}`} />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{c.nombre}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        c.tipo === 'Gasto' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' :
                        c.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {c.tipo}
                      </span>
                      {c.activo
                        ? <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Activo</span>
                        : <span className="text-xs text-slate-400 dark:text-slate-500">Inactivo</span>
                      }
                    </div>
                  </div>
                </div>
                <GripVertical size={16} className="text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing shrink-0" />
              </div>
              {c.clasificacion && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Clasificación: <span className="font-medium text-slate-700 dark:text-slate-300">{c.clasificacion}</span></p>
              )}
              {c.ejemplos && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 truncate">Ej: {c.ejemplos}</p>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                <span className={`text-xs ${c.transaccionesCount > 0 ? 'text-slate-600 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {c.transaccionesCount} transacción{c.transaccionesCount !== 1 ? 'es' : ''}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(c)}
                    className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg cursor-pointer transition-colors"
                    aria-label="Editar">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setDeleteTarget(c)}
                    className="p-2 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer transition-colors"
                    aria-label="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? `Editar — ${editing.nombre}` : 'Nueva categoría'}>
        <div className="space-y-4">
          {/* Color Preview */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
            <span className={`w-8 h-8 rounded-full ${form.color} shrink-0`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{form.nombre || 'Nombre de categoría'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{form.tipo}</p>
            </div>
          </div>

          <div>
            <Label htmlFor="cat-nombre">Nombre *</Label>
            <input id="cat-nombre" type="text" placeholder="Ej: Mascotas, Educación..." value={form.nombre}
              onChange={e => set('nombre', e.target.value)} className={fieldClass(formErrors.nombre)} />
            {formErrors.nombre && <p className="text-xs text-rose-500 mt-1">{formErrors.nombre}</p>}
          </div>

          <div>
            <Label htmlFor="cat-tipo">Tipo *</Label>
            <select id="cat-tipo" value={form.tipo} onChange={e => set('tipo', e.target.value)} className={fieldClass(formErrors.tipo)}>
              <option value="Gasto">Gasto</option>
              <option value="Ingreso">Ingreso</option>
              <option value="Ahorro">Ahorro</option>
            </select>
          </div>

          <div>
            <Label htmlFor="cat-clas">Clasificación</Label>
            <select id="cat-clas" value={form.clasificacion} onChange={e => set('clasificacion', e.target.value)} className={fieldClass()}>
              <option value="">Sin clasificar</option>
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
            </select>
          </div>

          <div>
            <Label htmlFor="cat-ejemplos">Ejemplos</Label>
            <textarea id="cat-ejemplos" rows={2} placeholder="Ej: Renta, Agua, Luz..." value={form.ejemplos}
              onChange={e => set('ejemplos', e.target.value)} className={`${fieldClass()} resize-none`} />
          </div>

          <div>
            <Label htmlFor="cat-color">Color</Label>
            <div id="cat-color" className="flex flex-wrap gap-2">
              {AVAILABLE_COLORS.map(color => (
                <button key={color.class} type="button" onClick={() => set('color', color.class)}
                  className={`w-8 h-8 rounded-full ${color.class} cursor-pointer transition-all ${form.color === color.class ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-800 scale-110' : 'hover:scale-105'}`}
                  aria-label={color.name} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input id="cat-activo" type="checkbox" checked={form.activo} onChange={e => set('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer" />
            <Label htmlFor="cat-activo">Activo</Label>
          </div>

          {form.tipo === 'Gasto' && (
            <div>
              <div className="flex items-center gap-2">
                <input id="cat-cuenta-limite" type="checkbox" checked={form.cuentaParaLimite} onChange={e => set('cuentaParaLimite', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer" />
                <Label htmlFor="cat-cuenta-limite">Cuenta para el límite de gasto de referencia</Label>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 ml-6">
                Si lo desmarcas, los gastos de esta categoría no suman contra tu límite de referencia (Configuración → Períodos de pago).
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px] transition-colors">
              {saving ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title="Eliminar categoría"
        description={
          deleteTarget?.transaccionesCount
            ? `Esta categoría tiene ${deleteTarget.transaccionesCount} transacción(es) asociada(s). No se puede eliminar.`
            : `¿Eliminar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer.`
        }
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        loading={deleting}
      />

      <style jsx global>{`
        .animate-in { animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
        <Filter size={28} className="text-slate-300 dark:text-slate-500" />
      </div>
      <p className="font-medium text-slate-600 dark:text-slate-400">Sin resultados</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Ajusta los filtros o crea una nueva categoría</p>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-0 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 dark:border-slate-700/50">
          <div className="w-4 h-4 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="w-3 h-3 bg-slate-200 dark:bg-slate-700 rounded-full" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-20" />
          <div className="flex-1" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-8" />
        </div>
      ))}
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-4 h-4 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="w-4 h-4 bg-slate-200 dark:bg-slate-700 rounded-full" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
          </div>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-2" />
          <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16" />
            <div className="flex gap-2">
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg" />
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
