'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, CalendarClock, CreditCard, Pencil, Plus } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import { useToast } from '@/components/Toast'
import { formatDate, formatMXN } from '@/lib/utils'

const TIPOS_CREDITO = ['Tarjeta', 'CreditoTienda', 'Prestamo', 'MSI', 'LineaCredito', 'Informal', 'Otro']

interface User { id: number; nombre: string }
interface Cuenta { id: number; nombre: string; activo: boolean }
interface Quincena { id: number; codigo: string }
interface Categoria { id: number; nombre: string }

interface CreditoPago {
  id: number
  fechaPagoProgramada: string
  fechaPagoReal: string | null
  montoTotal: number
  estatus: string
  numeroPago: number | null
  totalPagos: number | null
  credito: { nombre: string }
  quincena: Quincena
  categoria: Categoria
}

interface Credito {
  id: number
  nombre: string
  tipoCredito: string
  acreedor: string
  montoOriginal: number | null
  saldoInicial: number | null
  limiteCredito: number | null
  diaCorte: number | null
  diaPago: number | null
  frecuenciaPago: string | null
  montoPagoFijo: number | null
  activo: boolean
  notas: string | null
  fechaInicio: string | null
  pendiente: number
  pagado: number
  saldo: number
  user: User | null
  cuentaPago: Cuenta | null
}

const EMPTY_FORM = {
  nombre: '',
  tipoCredito: 'Tarjeta',
  acreedor: '',
  userId: '',
  montoOriginal: '',
  saldoInicial: '',
  limiteCredito: '',
  diaCorte: '',
  diaPago: '',
  frecuenciaPago: '',
  montoPagoFijo: '',
  plazoMeses: '',
  tasaInteres: '',
  cuentaPagoId: '',
  fechaInicio: '',
  notas: '',
}

function fieldClass(error?: string) {
  return `w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    error ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'
  }`
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

export default function CreditosPage() {
  const { toast } = useToast()
  const [creditos, setCreditos] = useState<Credito[]>([])
  const [pagos, setPagos] = useState<CreditoPago[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Credito | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then(r => r.json()),
      fetch('/api/cuentas').then(r => r.json()),
    ]).then(([u, c]) => {
      setUsers(u)
      setCuentas(c)
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [creditosRes, pagosRes] = await Promise.all([
        fetch('/api/creditos'),
        fetch('/api/credito-pagos?estatus=Pendiente'),
      ])
      setCreditos(await creditosRes.json())
      setPagos(await pagosRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchData() }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(c: Credito) {
    setEditing(c)
    setForm({
      nombre: c.nombre,
      tipoCredito: c.tipoCredito,
      acreedor: c.acreedor,
      userId: c.user?.id.toString() ?? '',
      montoOriginal: c.montoOriginal?.toString() ?? '',
      saldoInicial: c.saldoInicial?.toString() ?? '',
      limiteCredito: c.limiteCredito?.toString() ?? '',
      diaCorte: c.diaCorte?.toString() ?? '',
      diaPago: c.diaPago?.toString() ?? '',
      frecuenciaPago: c.frecuenciaPago ?? '',
      montoPagoFijo: c.montoPagoFijo?.toString() ?? '',
      plazoMeses: '',
      tasaInteres: '',
      cuentaPagoId: c.cuentaPago?.id.toString() ?? '',
      fechaInicio: c.fechaInicio ? c.fechaInicio.split('T')[0] : '',
      notas: c.notas ?? '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!form.nombre.trim()) next.nombre = 'Requerido'
    if (!form.acreedor.trim()) next.acreedor = 'Requerido'
    if (form.diaCorte && (Number(form.diaCorte) < 1 || Number(form.diaCorte) > 31)) next.diaCorte = 'Día 1-31'
    if (form.diaPago && (Number(form.diaPago) < 1 || Number(form.diaPago) > 31)) next.diaPago = 'Día 1-31'
    return next
  }

  async function handleSave() {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return }
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/creditos/${editing.id}` : '/api/creditos', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast(editing ? 'Crédito actualizado' : 'Crédito creado')
      setModalOpen(false)
      fetchData()
    } catch {
      toast('Error al guardar crédito', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function archiveCredito(id: number) {
    try {
      const res = await fetch(`/api/creditos/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast('Crédito archivado')
      fetchData()
    } catch {
      toast('Error al archivar crédito', 'error')
    }
  }

  const activos = creditos.filter(c => c.activo)
  const totalSaldo = activos.reduce((sum, c) => sum + Number(c.saldo || 0), 0)
  const pagosPendientes = pagos.reduce((sum, p) => sum + Number(p.montoTotal), 0)
  const proximosPagos = pagos.slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Créditos y Deudas</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configura tarjetas, préstamos, MSI y créditos de tienda.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors">
          <Plus size={16} /> Nuevo crédito
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Créditos activos</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{activos.length}</p>
        </div>
        <div className="bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-900/30 p-4">
          <p className="text-xs text-rose-600 dark:text-rose-400 mb-1">Saldo pendiente</p>
          <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">{formatMXN(totalSaldo)}</p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30 p-4">
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-1">Próximos pagos</p>
          <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">{formatMXN(pagosPendientes)}</p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Cargando...</div>
      ) : activos.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 dark:text-slate-500">
          <CreditCard size={32} className="mx-auto mb-3 text-indigo-400" />
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin créditos configurados</p>
          <p className="text-sm mt-1">Crea un crédito para empezar a programar pagos por quincena.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {activos.map(c => (
            <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{c.nombre}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">{c.tipoCredito}</span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{c.acreedor}</p>
                </div>
                <p className="text-xl font-bold text-rose-600 dark:text-rose-400 text-right">{formatMXN(c.saldo)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Límite / Original</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-200">{formatMXN(c.limiteCredito ?? c.montoOriginal ?? c.saldoInicial)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Corte / Pago</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-200">{c.diaCorte || '-'} / {c.diaPago || '-'}</p>
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <button onClick={() => openEdit(c)} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg cursor-pointer">
                  <Pencil size={13} /> Editar
                </button>
                <button onClick={() => archiveCredito(c.id)} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg cursor-pointer">
                  <Archive size={13} /> Archivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <CalendarClock size={18} className="text-indigo-500" />
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">Próximos pagos programados</h3>
        </div>
        {proximosPagos.length === 0 ? (
          <p className="p-5 text-sm text-slate-400 dark:text-slate-500">Aún no hay pagos programados. Se generarán al registrar gastos con crédito o MSI.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-left px-4 py-3">Crédito</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Q</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-right px-4 py-3">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {proximosPagos.map(p => (
                  <tr key={p.id} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.fechaPagoProgramada)}</td>
                    <td className="px-4 py-3">{p.credito.nombre}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{p.quincena.codigo}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{p.categoria.nombre}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMXN(p.montoTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FormModal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Editar crédito' : 'Nuevo crédito'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="nombre">Nombre *</Label>
              <input id="nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className={fieldClass(errors.nombre)} placeholder="Ej: Nu, BBVA Azul, Coppel" />
              {errors.nombre && <p className="text-xs text-rose-500 mt-1">{errors.nombre}</p>}
            </div>
            <div>
              <Label htmlFor="acreedor">Acreedor *</Label>
              <input id="acreedor" value={form.acreedor} onChange={e => setForm(f => ({ ...f, acreedor: e.target.value }))} className={fieldClass(errors.acreedor)} placeholder="Banco o tienda" />
              {errors.acreedor && <p className="text-xs text-rose-500 mt-1">{errors.acreedor}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tipo">Tipo</Label>
              <select id="tipo" value={form.tipoCredito} onChange={e => setForm(f => ({ ...f, tipoCredito: e.target.value }))} className={fieldClass()}>
                {TIPOS_CREDITO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="user">Usuario</Label>
              <select id="user" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} className={fieldClass()}>
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="limite">Límite / original</Label>
              <input id="limite" type="number" value={form.limiteCredito} onChange={e => setForm(f => ({ ...f, limiteCredito: e.target.value, montoOriginal: e.target.value }))} className={fieldClass()} />
            </div>
            <div>
              <Label htmlFor="pagoFijo">Pago fijo</Label>
              <input id="pagoFijo" type="number" value={form.montoPagoFijo} onChange={e => setForm(f => ({ ...f, montoPagoFijo: e.target.value }))} className={fieldClass()} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="corte">Día corte</Label>
              <input id="corte" type="number" min="1" max="31" value={form.diaCorte} onChange={e => setForm(f => ({ ...f, diaCorte: e.target.value }))} className={fieldClass(errors.diaCorte)} />
              {errors.diaCorte && <p className="text-xs text-rose-500 mt-1">{errors.diaCorte}</p>}
            </div>
            <div>
              <Label htmlFor="pago">Día pago</Label>
              <input id="pago" type="number" min="1" max="31" value={form.diaPago} onChange={e => setForm(f => ({ ...f, diaPago: e.target.value }))} className={fieldClass(errors.diaPago)} />
              {errors.diaPago && <p className="text-xs text-rose-500 mt-1">{errors.diaPago}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cuenta">Cuenta de pago</Label>
              <select id="cuenta" value={form.cuentaPagoId} onChange={e => setForm(f => ({ ...f, cuentaPagoId: e.target.value }))} className={fieldClass()}>
                <option value="">Sin especificar</option>
                {cuentas.filter(c => c.activo || c.id.toString() === form.cuentaPagoId).map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}{!c.activo ? ' (inactiva)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="inicio">Fecha inicio</Label>
              <input id="inicio" type="date" value={form.fechaInicio} onChange={e => setForm(f => ({ ...f, fechaInicio: e.target.value }))} className={fieldClass()} />
            </div>
          </div>

          <div>
            <Label htmlFor="notas">Notas</Label>
            <textarea id="notas" rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} className={`${fieldClass()} resize-none`} />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">Cancelar</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      </FormModal>
    </div>
  )
}
