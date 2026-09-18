'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Search, X, ArrowUpRight, ArrowDownRight, Wallet, Calendar, User, CreditCard, StickyNote, Check, AlertCircle, Download, Unlink } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormModal } from '@/components/ui/FormModal'
import { formatQuincenaRange, getInitialQuincenaId, getMexicoDateString, getQuincenaIdForDate, isDateInQuincenaGap, persistQuincenaId } from '@/lib/quincena-selection'
import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { toCsv, downloadCsv } from '@/lib/csv'
import { QuincenaChips, ALL_QUINCENAS } from '@/components/ui/QuincenaChips'
import { FilterChip } from '@/components/ui/FilterChip'
import { ColumnsMenu } from '@/components/ui/ColumnsMenu'
import { useColumnVisibility } from '@/lib/use-column-visibility'
import { useSearchShortcut } from '@/lib/use-search-shortcut'
import { InlineSelectCell, type InlineOption } from '@/components/ui/InlineSelectCell'
import { usePresupuestoLineas, etiquetaLinea, grupoLinea, type PresupuestoLinea } from './usePresupuestoLineas'
import {
  runBulk, planMoverQuincena, agruparPorQuincenaYTipo, leerClaveGrupoTipo, resumenBulk,
  type PlanMoverQuincena,
} from '@/lib/transacciones-bulk'
import { BulkActionsBar } from './BulkActionsBar'
import { MoverQuincenaDialog } from './MoverQuincenaDialog'
import { AsignarLineaDialog, type DecisionCategoria } from './AsignarLineaDialog'

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
// fechaCierre ya viene en la respuesta de /api/quincenas (devuelve la fila
// completa); solo faltaba declararlo para poder avisar al mover algo a una
// quincena ya cerrada.
interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string; fechaCierre?: string | null }
interface MetodoPago { id: number; nombre: string }
interface Credito { id: number; nombre: string; tipoCredito: string; acreedor: string; activo: boolean; diaPago: number | null }
interface Transaccion {
  id: number; fecha: string; descripcion: string; tipo: 'Gasto' | 'Ingreso' | 'Ahorro'
  direccion: 'Aporte' | 'Retiro' | null
  monto: number; estatus: 'Pagado' | 'Pendiente'; notas: string | null
  categoria: Categoria; user: User | null; quincena: Quincena; metodoPago: MetodoPago | null
  presupuesto: { id: number; descripcion: string } | null
  quincenaId: number; categoriaId: number; userId: number | null; metodoPagoId: number | null; creditoId: number | null
  presupuestoId: number | null
}

// Campos que se pueden editar desde la tabla. Se usan para decidir si una
// escritura necesita refetch (ver requiereRefetch).
type CampoEditable = 'quincena' | 'categoria' | 'usuario' | 'metodoPago' | 'presupuesto' | 'estatus'

// Estado de los dialogos que confirman antes de escribir. Todos llevan las
// filas completas y no solo ids: describir la consecuencia (que enlace se
// suelta, que tipo cambia) no debe costar otra ida al servidor.
interface MoverPlanState {
  plan: PlanMoverQuincena<Transaccion>
  destino: Quincena
  /** categoriaId -> presupuestoId elegido en la quincena destino ('' = dejar
   *  sin asignar). Por categoria y no por fila porque es la unica agrupacion
   *  en la que una sola linea es legal para todas las filas que abarca. */
  reasignar: Record<number, string>
}

interface CategoriaPlanState {
  filas: Transaccion[]
  categoria: Categoria
  pierdenEnlace: Transaccion[]
  cambianTipo: Transaccion[]
  /** Solo se usa cuando la categoria destino es de tipo Ahorro. */
  direccion: 'Aporte' | 'Retiro'
}

interface AsignarPlanState {
  grupos: Array<{ clave: string; quincenaId: number; tipo: string; filas: Transaccion[] }>
  /** clave de grupo -> presupuestoId ('' = ese grupo no se toca). */
  elegidas: Record<string, string>
  /** clave de grupo -> que hacer con las filas que queden cruzadas de categoria. */
  decisiones: Record<string, DecisionCategoria>
}

const EMPTY_FORM = {
  fecha: getMexicoDateString(), descripcion: '', categoriaId: '',
  tipo: 'Gasto', direccion: 'Aporte', monto: '', quincenaId: '', userId: '', metodoPagoId: '',
  creditoId: '', totalPagos: '', fechaPagoProgramada: '',
  estatus: 'Pendiente', notas: '', presupuestoId: '',
}

const LIMIT = 25
// Tope de quincenas distintas en pantalla para las que se precargan lineas.
const MAX_QUINCENAS_PRECARGA = 8
// El value vacio lo ocupa la opcion-placeholder del select de accion.
const SIN_USUARIO = '__sin_usuario__'

// Descripción y Monto son las columnas núcleo (no se pueden ocultar) --
// el resto es opcional, elegible desde el menú "Columnas". Método de pago
// va visible por default junto con las demás.
const TX_COLUMNS = [
  { key: 'categoria', label: 'Categoría' },
  { key: 'presupuesto', label: 'Presupuesto' },
  { key: 'quincena', label: 'Quincena' },
  { key: 'fecha', label: 'Fecha' },
  { key: 'usuario', label: 'Usuario' },
  { key: 'metodoPago', label: 'Método de pago' },
  { key: 'tipo', label: 'Tipo' },
  { key: 'estatus', label: 'Estatus' },
]
const TX_COLUMNS_DEFAULT = TX_COLUMNS.map(c => c.key)

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

  // Seleccion multiple. Alcance: la pagina visible (LIMIT filas) -- lo que el
  // usuario alcanza a ver antes de actuar sobre ello.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Filas con una escritura en vuelo. Generaliza el togglingId de siempre, que
  // solo sabia de una fila y de un solo campo.
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [bulkProgress, setBulkProgress] = useState<{ hechas: number; total: number } | null>(null)

  const [moverPlan, setMoverPlan] = useState<MoverPlanState | null>(null)
  const [categoriaPlan, setCategoriaPlan] = useState<CategoriaPlanState | null>(null)
  const [asignarPlan, setAsignarPlan] = useState<AsignarPlanState | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  // Unico punto de edicion inline en movil: el chip de asignacion de la
  // tarjeta. La tabla y sus dropdowns son solo de escritorio (ver mas abajo).
  const [lineaMovilTx, setLineaMovilTx] = useState<Transaccion | null>(null)

  const [quincenaId, setQuincenaId] = useState('')
  // Quincenas extra combinadas via Ctrl/Cmd+clic (mismo patron que en
  // Presupuesto). Sin efecto si quincenaId === ALL_QUINCENAS.
  const [extraQuincenaIds, setExtraQuincenaIds] = useState<Set<string>>(new Set())
  const [tipo, setTipo] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [userId, setUserId] = useState('')
  const [estatus, setEstatus] = useState('')
  const [asignacion, setAsignacion] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const busquedaInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(busquedaInputRef)

  const [quincenas, setQuincenas] = useState<Quincena[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([])
  const [creditos, setCreditos] = useState<Credito[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [detailTx, setDetailTx] = useState<Transaccion | null>(null)
  const [pendingDateChange, setPendingDateChange] = useState<{ fecha: string; suggestedQuincenaId: string } | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const { visible: colVisible, toggle: toggleCol } = useColumnVisibility('milo:columns:transacciones', TX_COLUMNS_DEFAULT)
  const { ensure: ensureLineas, estadoDe: estadoLineas, lineasDe, invalidar: invalidarLineas } = usePresupuestoLineas()

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
    setExtraQuincenaIds(new Set())
    setPage(1)
    if (id !== ALL_QUINCENAS) persistQuincenaId(id)
  }

  function toggleExtraQuincena(id: string) {
    if (id === quincenaId || quincenaId === ALL_QUINCENAS) return
    setExtraQuincenaIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPage(1)
  }

  // Todas las quincenas combinadas: la primaria mas las agregadas via
  // Ctrl/Cmd+clic. Si la primaria es "Todas" (ALL_QUINCENAS), no hay nada
  // que combinar -- ya trae todo.
  const selectedQuincenaIds = useMemo(() => {
    if (quincenaId === ALL_QUINCENAS) return []
    return Array.from(new Set([quincenaId, ...extraQuincenaIds].filter(Boolean)))
  }, [quincenaId, extraQuincenaIds])

  const fetchTxs = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    const params = new URLSearchParams()
    for (const id of selectedQuincenaIds) params.append('quincenaId', id)
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
  }, [quincenaId, selectedQuincenaIds, tipo, categoriaId, userId, estatus, asignacion, debouncedSearch, page])

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchTxs() }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchTxs])

  // La seleccion solo alcanza a la pagina visible, asi que al cambiar de pagina
  // o de filtro hay que soltarla: arrastrar ids de una vista anterior dejaria al
  // usuario actuando sobre filas que ya no ve.
  //
  // Se ajusta durante el render -- el patron que documenta react.dev para
  // resetear estado cuando cambia una entrada -- y no en un efecto, que
  // dispararia un render en cascada. La identidad de fetchTxs sirve de llave de
  // la vista porque sus deps son exactamente los filtros mas la pagina, asi que
  // agregar un filtro nuevo manana no requiere acordarse de nada.
  const [vistaDeLaSeleccion, setVistaDeLaSeleccion] = useState(() => fetchTxs)
  if (vistaDeLaSeleccion !== fetchTxs) {
    setVistaDeLaSeleccion(() => fetchTxs)
    setSelected(new Set())
  }

  // Precarga de las lineas de presupuesto de las quincenas que aparecen en la
  // pagina, para que el dropdown de "Presup." abra sin espera. Un <select>
  // nativo no avisa cuando lo abren, asi que las opciones tienen que estar
  // listas de antemano. El tope existe por si alguien ve "Todas": mas alla de
  // eso la celda se deshabilita y lo dice, en vez de disparar 25 peticiones.
  const quincenasEnPagina = useMemo(
    () => Array.from(new Set(txs.map(t => t.quincenaId))),
    [txs],
  )
  const demasiadasQuincenas = quincenasEnPagina.length > MAX_QUINCENAS_PRECARGA

  useEffect(() => {
    if (quincenasEnPagina.length === 0 || quincenasEnPagina.length > MAX_QUINCENAS_PRECARGA) return
    ensureLineas(quincenasEnPagina)
  }, [quincenasEnPagina, ensureLineas])

  // El modal usa el MISMO cache que la tabla (ensureLineas) en vez de su propio
  // fetch. Antes pedia `?quincenaId=X&categoriaId=Y` cada vez que cambiabas de
  // categoria, para quedarse con un pedazo de lo que el cache ya tenia entero:
  // GET /api/presupuestos con solo quincenaId devuelve las lineas de TODAS las
  // categorias de esa quincena (ver el encabezado de usePresupuestoLineas).
  useEffect(() => {
    if (!modalOpen || !form.quincenaId) return
    ensureLineas([form.quincenaId])
  }, [modalOpen, form.quincenaId, ensureLineas])

  // Lineas ofrecidas en el modal: toda la quincena, agrupadas por categoria.
  // El tipo sale de la categoria elegida (una categoria de Ahorro fuerza
  // tipo Ahorro, ver resolverTipoYDireccion), no del campo `tipo` del form.
  const tipoDelForm = categorias.find(c => c.id.toString() === form.categoriaId)?.tipo ?? form.tipo
  const lineasDelModal = form.quincenaId ? lineasDe(form.quincenaId, { tipo: tipoDelForm }) : []

  // La linea elegida es de otra categoria que la del form. Se AVISA, no se
  // bloquea: en el dashboard la categoria de cada linea esta a la vista (es el
  // encabezado del <optgroup>), asi que un modal de confirmacion seria ruido.
  // Lo que no puede pasar es que cambie la categoria sin que nadie lo pida.
  const lineaElegidaCruzada = form.presupuestoId && form.categoriaId
    ? lineasDelModal.find(l => String(l.id) === form.presupuestoId && String(l.categoriaId) !== form.categoriaId) ?? null
    : null

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
      categoriaId: tx.categoriaId.toString(), tipo: tx.tipo, direccion: tx.direccion ?? 'Aporte',
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
        tipo: form.tipo, direccion: esAhorro ? form.direccion : null,
        monto: form.monto, quincenaId: form.quincenaId, quincenaConsumoId: form.quincenaId,
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
    const next = tx.estatus === 'Pagado' ? 'Pendiente' : 'Pagado'
    setTogglingId(tx.id)
    try {
      // Pasa por updateTx para que el filtro de Estatus mande el refetch: antes
      // se parcheaba siempre en local y una fila marcada como Pagada seguia
      // visible bajo el filtro "Pendiente", con el contador sin corregir.
      await updateTx(tx.id, { estatus: next }, { campos: ['estatus'] })
    } finally { setTogglingId(null) }
  }

  // --- Seleccion -----------------------------------------------------------

  const allSelected = txs.length > 0 && txs.every(t => selected.has(t.id))
  const someSelected = selected.size > 0
  const selectedTxs = useMemo(() => txs.filter(t => selected.has(t.id)), [txs, selected])

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(prev =>
      txs.length > 0 && txs.every(t => prev.has(t.id)) ? new Set() : new Set(txs.map(t => t.id)),
    )
  }

  // --- Escritura de una fila -----------------------------------------------

  function putTx(id: number, body: Record<string, unknown>) {
    return fetch(`/api/transacciones/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  function patchTx(id: number, cambios: Partial<Transaccion>) {
    setTxs(prev => prev.map(t => (t.id === id ? { ...t, ...cambios } : t)))
    setDetailTx(prev => (prev?.id === id ? { ...prev, ...cambios } : prev))
  }

  function marcarOcupada(id: number, ocupada: boolean) {
    setBusyIds(prev => {
      const next = new Set(prev)
      if (ocupada) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Los totales de las tarjetas los calcula el servidor sobre TODAS las filas
  // filtradas, no sobre la pagina, asi que una escritura que cambie el tipo o
  // saque a la fila del filtro activo los descuadra si solo se parchea local.
  // Una sola regla en un solo lugar, en vez de decidirlo en cada handler.
  const filtroActivo: Record<CampoEditable, boolean> = {
    quincena: quincenaId !== ALL_QUINCENAS,
    categoria: !!categoriaId,
    usuario: !!userId,
    metodoPago: false, // no hay filtro de metodo de pago en esta vista
    presupuesto: !!asignacion,
    estatus: !!estatus,
  }

  function requiereRefetch(campos: CampoEditable[]) {
    if (campos.includes('categoria')) return true // puede voltear el tipo -> mueve los totales
    return campos.some(c => filtroActivo[c])
  }

  async function updateTx(
    id: number,
    body: Record<string, unknown>,
    opts: { campos: CampoEditable[]; okMsg?: string; invalidarQ?: Array<number | null | undefined> },
  ) {
    marcarOcupada(id, true)
    try {
      const res = await putTx(id, body)
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || 'Error al guardar')
      }
      const actualizada: Transaccion = await res.json()
      invalidarLineas(...(opts.invalidarQ ?? []))
      if (requiereRefetch(opts.campos)) await fetchTxs()
      else patchTx(id, actualizada)
      if (opts.okMsg) toast(opts.okMsg)
      return actualizada
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al guardar', 'error')
      return null
    } finally {
      marcarOcupada(id, false)
    }
  }

  // --- Acciones masivas ----------------------------------------------------

  async function ejecutarBulk(
    filas: Transaccion[],
    cuerpo: (tx: Transaccion) => Record<string, unknown> | null,
    opts: {
      uno: string; varias: string; extra?: string[]
      omitidas?: number; invalidarQ?: Array<number | null | undefined>
      metodo?: 'PUT' | 'DELETE'
    },
  ) {
    if (filas.length === 0) {
      toast('No hay nada que cambiar en la selección')
      return
    }
    const porId = new Map(filas.map(t => [t.id, t]))
    setBulkProgress({ hechas: 0, total: filas.length })
    try {
      const report = await runBulk(
        filas.map(t => t.id),
        id => {
          if (opts.metodo === 'DELETE') {
            return fetch(`/api/transacciones/${id}`, { method: 'DELETE' })
          }
          return putTx(id, cuerpo(porId.get(id)!) ?? {})
        },
        { onProgress: (hechas, total) => setBulkProgress({ hechas, total }) },
      )
      invalidarLineas(...(opts.invalidarQ ?? []))
      // Las que fallaron se quedan seleccionadas para poder reintentarlas de un
      // clic; las que salieron bien se desmarcan.
      const fallidas = new Set(report.failed.map(r => r.id))
      setSelected(prev => new Set([...prev].filter(id => fallidas.has(id))))
      await fetchTxs()
      toast(
        resumenBulk(report, { uno: opts.uno, varias: opts.varias, extra: opts.extra }, opts.omitidas ?? 0),
        report.failed.length > 0 ? 'error' : 'success',
      )
    } finally {
      setBulkProgress(null)
    }
  }

  function bulkEstatus(nuevo: 'Pagado' | 'Pendiente') {
    const filas = selectedTxs.filter(t => t.estatus !== nuevo)
    void ejecutarBulk(filas, () => ({ estatus: nuevo }), {
      uno: nuevo === 'Pagado' ? 'marcada como pagada' : 'marcada como pendiente',
      varias: nuevo === 'Pagado' ? 'marcadas como pagadas' : 'marcadas como pendientes',
      omitidas: selectedTxs.length - filas.length,
    })
  }

  function bulkUsuario(valor: string) {
    const nuevo = valor === '' ? null : parseInt(valor)
    const filas = selectedTxs.filter(t => (t.userId ?? null) !== nuevo)
    void ejecutarBulk(filas, () => ({ userId: nuevo }), {
      uno: 'reasignada', varias: 'reasignadas',
      omitidas: selectedTxs.length - filas.length,
    })
  }

  // Quitar la asignacion es legal para cualquier fila sin importar quincena ni
  // categoria, asi que no necesita agrupar nada -- y es el deshacer mas rapido
  // de una asignacion masiva equivocada.
  function bulkQuitarAsignacion() {
    const filas = selectedTxs.filter(t => t.presupuestoId != null)
    void ejecutarBulk(filas, () => ({ presupuestoId: null }), {
      uno: 'sin asignar', varias: 'sin asignar',
      omitidas: selectedTxs.length - filas.length,
      invalidarQ: Array.from(new Set(filas.map(t => t.quincenaId))),
    })
  }

  // --- Mover de quincena ---------------------------------------------------

  function abrirMoverQuincena(filas: Transaccion[], destinoId: number) {
    const destino = quincenas.find(q => q.id === destinoId)
    if (!destino) return
    const plan = planMoverQuincena(filas, destino.id)
    if (plan.aEscribir.length === 0) {
      toast(`Ya ${filas.length === 1 ? 'está' : 'están'} en ${destino.codigo}`)
      return
    }
    ensureLineas([destino.id])
    setMoverPlan({ plan, destino, reasignar: {} })
  }

  function cambiarQuincenaFila(tx: Transaccion, valor: string) {
    const destino = quincenas.find(q => q.id.toString() === valor)
    if (!destino || destino.id === tx.quincenaId) return
    // Camino directo solo cuando no hay nada que advertir: sin enlace que
    // soltar, sin credito cuyos pagos programados se queden atras, y con la
    // quincena destino abierta.
    if (tx.presupuestoId == null && tx.creditoId == null && !destino.fechaCierre) {
      void updateTx(tx.id, { quincenaId: destino.id }, {
        campos: ['quincena'],
        okMsg: `Movida a ${destino.codigo}`,
        invalidarQ: [tx.quincenaId, destino.id],
      })
      return
    }
    abrirMoverQuincena([tx], destino.id)
  }

  async function confirmarMover() {
    if (!moverPlan) return
    const { plan, destino, reasignar } = moverPlan
    const origenes = Array.from(new Set(plan.aEscribir.map(t => t.quincenaId)))
    const reasignadas = plan.aEscribir.filter(t => !!reasignar[t.categoriaId]).length
    setMoverPlan(null)
    await ejecutarBulk(
      plan.aEscribir,
      tx => {
        const linea = reasignar[tx.categoriaId]
        // Un solo PUT con los dos campos: el handler resuelve la quincena final
        // mirando el body antes de validar el enlace, asi que nunca existe un
        // instante con la fila ya en la quincena nueva y el enlace viejo.
        return linea
          ? { quincenaId: destino.id, presupuestoId: linea }
          : { quincenaId: destino.id }
      },
      {
        uno: `movida a ${destino.codigo}`, varias: `movidas a ${destino.codigo}`,
        extra: reasignadas > 0 ? [`${reasignadas} reasignada${reasignadas > 1 ? 's' : ''}`] : undefined,
        omitidas: plan.omitidas.length,
        invalidarQ: [...origenes, destino.id],
      },
    )
  }

  // --- Cambiar de categoria ------------------------------------------------

  // Espejo de la regla del servidor (ver api/transacciones/[id]/route.ts): el
  // enlace solo se suelta cuando el cambio de categoria cambia tambien el TIPO,
  // porque ahi el monto desaparece de los agregados. Un cruce de categoria
  // dentro del mismo tipo se conserva: es legal, se marca en la tabla y lo mide
  // el check 21 de la auditoria.
  //
  // Si el cache todavia no tiene las lineas de esa quincena no se puede saber,
  // y se avisa de mas: es preferible una advertencia que sobra a un enlace que
  // desaparece sin que nadie lo dijera.
  function perderaEnlace(tx: Transaccion, categoriaDestinoId: number) {
    if (tx.presupuestoId == null || tx.categoriaId === categoriaDestinoId) return false
    if (estadoLineas(tx.quincenaId) !== 'ready') return true
    const linea = lineasDe(tx.quincenaId).find(l => l.id === tx.presupuestoId)
    if (!linea) return true
    const tipoDestino = categorias.find(c => c.id === categoriaDestinoId)?.tipo
    return !!tipoDestino && linea.categoria?.tipo !== tipoDestino
  }

  function abrirCambiarCategoria(filas: Transaccion[], valor: string) {
    const categoria = categorias.find(c => c.id.toString() === valor)
    if (!categoria) return
    const aCambiar = filas.filter(t => t.categoriaId !== categoria.id)
    if (aCambiar.length === 0) return
    // Toda categoria de tipo Ahorro fuerza tipo:'Ahorro'; el resto hereda el
    // tipo de la categoria (ver @/lib/transaccion-ahorro).
    const tipoDestino = categoria.tipo
    setCategoriaPlan({
      filas: aCambiar,
      categoria,
      pierdenEnlace: aCambiar.filter(t => perderaEnlace(t, categoria.id)),
      cambianTipo: aCambiar.filter(t => t.tipo !== tipoDestino),
      direccion: 'Aporte',
    })
  }

  async function confirmarCategoria() {
    if (!categoriaPlan) return
    const { filas, categoria, direccion } = categoriaPlan
    const esAhorroDestino = categoria.tipo === 'Ahorro'
    setCategoriaPlan(null)
    await ejecutarBulk(
      filas,
      // La direccion viaja solo hacia Ahorro: sin ella toda fila convertida
      // caeria en 'Aporte' y un retiro quedaria mal firmado en el neteo de
      // calcularRealPorLinea.
      () => (esAhorroDestino ? { categoriaId: categoria.id, direccion } : { categoriaId: categoria.id }),
      {
        uno: `movida a ${categoria.nombre}`, varias: `movidas a ${categoria.nombre}`,
        invalidarQ: Array.from(new Set(filas.map(t => t.quincenaId))),
      },
    )
  }

  // --- Asignar linea en lote -----------------------------------------------

  function abrirAsignarLinea() {
    const grupos = Array.from(agruparPorQuincenaYTipo(selectedTxs).entries()).map(([clave, filas]) => ({
      clave, ...leerClaveGrupoTipo(clave), filas,
    }))
    ensureLineas(grupos.map(g => g.quincenaId))
    setAsignarPlan({ grupos, elegidas: {}, decisiones: {} })
  }

  async function confirmarAsignar() {
    if (!asignarPlan) return
    const { grupos, elegidas, decisiones } = asignarPlan

    // Por fila: la linea destino y, si el usuario eligio alinear, la categoria
    // a la que se mueve. `categoriaId` solo viaja cuando alguien lo pidio: el
    // servidor no la toca por su cuenta y este dialogo tampoco.
    const porFila = new Map<number, { presupuestoId: string; categoriaId?: number }>()
    for (const g of grupos) {
      const elegida = elegidas[g.clave]
      if (!elegida) continue // grupo sin linea elegida: no se toca
      const linea = lineasDe(g.quincenaId).find(l => l.id.toString() === elegida)
      const alinea = decisiones[g.clave] === 'alinear' && linea
      for (const f of g.filas) {
        porFila.set(f.id, {
          presupuestoId: elegida,
          categoriaId: alinea && f.categoriaId !== linea.categoriaId ? linea.categoriaId : undefined,
        })
      }
    }

    // Una fila se escribe si le cambia la linea O la categoria. Antes solo se
    // miraba la linea, lo que dejaba fuera a las que ya estaban en la linea
    // correcta pero cuya categoria si habia que mover.
    const filas = selectedTxs.filter(t => {
      const destino = porFila.get(t.id)
      if (!destino) return false
      return (t.presupuestoId?.toString() ?? '') !== destino.presupuestoId
        || destino.categoriaId !== undefined
    })
    setAsignarPlan(null)
    await ejecutarBulk(filas, tx => {
      const destino = porFila.get(tx.id)!
      return destino.categoriaId === undefined
        ? { presupuestoId: destino.presupuestoId }
        : { presupuestoId: destino.presupuestoId, categoriaId: destino.categoriaId }
    }, {
      uno: 'asignada', varias: 'asignadas',
      omitidas: selectedTxs.length - filas.length,
      invalidarQ: Array.from(new Set(filas.map(t => t.quincenaId))),
    })
  }

  // --- Borrado masivo ------------------------------------------------------

  // Las compras a credito se excluyen: CreditoPago.transaccionId es
  // onDelete:SetNull, asi que borrar la compra deja sus pagos programados
  // colgando sin transaccion detras, visibles en /creditos y sin rastro de
  // donde salieron. Borrar una desde ahi tiene contexto; borrar veinte de
  // golpe desde aca, no.
  const bulkDeleteExcluidas = useMemo(() => selectedTxs.filter(t => t.creditoId != null), [selectedTxs])
  const bulkDeleteFilas = useMemo(() => selectedTxs.filter(t => t.creditoId == null), [selectedTxs])

  async function confirmarBulkDelete() {
    setConfirmBulkDelete(false)
    await ejecutarBulk(bulkDeleteFilas, () => ({}), {
      uno: 'eliminada', varias: 'eliminadas',
      omitidas: bulkDeleteExcluidas.length,
      invalidarQ: Array.from(new Set(bulkDeleteFilas.map(t => t.quincenaId))),
      metodo: 'DELETE',
    })
  }

  async function handleExportCsv() {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      for (const id of selectedQuincenaIds) params.append('quincenaId', id)
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
  // Categoria "Ahorro" siempre implica tipo:'Ahorro' -- la direccion
  // (aporte/retiro) sustituye al select de Tipo. Ver @/lib/transaccion-ahorro.
  const categoriaSeleccionada = categorias.find(c => c.id.toString() === form.categoriaId)
  const esAhorro = categoriaSeleccionada?.tipo === 'Ahorro'
  const bulkRunning = bulkProgress !== null

  // --- Opciones de los dropdowns de la tabla -------------------------------

  const opcionesQuincena: InlineOption[] = useMemo(
    () => quincenas.map(q => ({
      value: q.id.toString(),
      // Nada impide escribir en una quincena cerrada (cerrarSiCorresponde solo
      // corre desde /resolver y /transferir), pero que se vea antes de elegir.
      label: q.fechaCierre ? `${q.codigo} · cerrada` : q.codigo,
    })),
    [quincenas],
  )

  const opcionesCategoria: InlineOption[] = useMemo(
    () => categorias.map(c => ({
      value: c.id.toString(),
      // Las de Ingreso/Ahorro llevan su tipo pegado: cambiar a una de ellas
      // voltea el tipo de la transaccion (@/lib/transaccion-ahorro) y eso no
      // deberia descubrirse hasta la confirmacion.
      label: c.tipo === 'Gasto' ? c.nombre : `${c.nombre} · ${c.tipo}`,
    })),
    [categorias],
  )

  const opcionesUsuario: InlineOption[] = useMemo(
    () => users.map(u => ({ value: u.id.toString(), label: u.nombre })),
    [users],
  )

  const opcionesMetodo: InlineOption[] = useMemo(
    () => metodosPago.map(m => ({ value: m.id.toString(), label: m.nombre })),
    [metodosPago],
  )

  // Sin `categoriaId`: se ofrecen las lineas de TODA la quincena, agrupadas por
  // categoria (`group` -> <optgroup>). Antes habia que acordarse de en que
  // categoria vivia la linea que uno buscaba antes de poder verla; ahora la
  // categoria es el encabezado del grupo, no la reja de entrada.
  //
  // El filtro por `tipo` si se queda, y no es cosmetico: ver el comentario de
  // lineasDe en usePresupuestoLineas.ts.
  // Tramos contiguos por categoria, para los <optgroup>. No reordena: se apoya
  // en que lineasDe ya devuelve las lineas ordenadas por categoria.
  function agruparPorCategoria(lineas: PresupuestoLinea[]): Array<[string, PresupuestoLinea[]]> {
    const grupos = new Map<string, PresupuestoLinea[]>()
    for (const l of lineas) {
      const clave = grupoLinea(l)
      const actual = grupos.get(clave)
      if (actual) actual.push(l)
      else grupos.set(clave, [l])
    }
    return [...grupos]
  }

  function opcionesLineaPara(tx: Transaccion): InlineOption[] {
    const lineas = lineasDe(tx.quincenaId, { tipo: tx.tipo })
    if (lineas.length === 0 && estadoLineas(tx.quincenaId) === 'ready') {
      return [{
        value: '__vacio__', disabled: true,
        label: `Sin líneas de ${tx.tipo} en ${tx.quincena.codigo}`,
      }]
    }
    return lineas.map(l => ({ value: l.id.toString(), label: etiquetaLinea(l), group: grupoLinea(l) }))
  }

  /** La linea asignada es de otra categoria que la transaccion. Estado legal
   *  (una partida comodin) pero que conviene ver: el `real` de esa linea se
   *  reporta en la categoria de la LINEA, no en la de la transaccion. */
  function enlaceCruzado(tx: Transaccion): PresupuestoLinea | null {
    if (tx.presupuestoId == null) return null
    const linea = lineasDe(tx.quincenaId).find(l => l.id === tx.presupuestoId)
    return linea && linea.categoriaId !== tx.categoriaId ? linea : null
  }

  // La fecha no se reescribe al mover de quincena -- seria reescribir un dato
  // financiero en silencio, y el esquema soporta a proposito que difieran (ver
  // quincenaConsumoId). Pero si se marca, para que no pase inadvertido.
  function fechaFueraDeQ(tx: Transaccion) {
    const sugerida = getQuincenaIdForDate(quincenas, tx.fecha.split('T')[0])
    return !!sugerida && sugerida !== tx.quincenaId.toString()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Transacciones</h2>
        <div className="flex items-center gap-2">
          <ColumnsMenu columns={TX_COLUMNS} visible={colVisible} onToggle={toggleCol} />
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
        <div className="flex items-center flex-wrap gap-2">
          <QuincenaChips quincenas={quincenas} quincenaId={quincenaId} today={today} onSelect={selectQuincena} showAll
            extraSelectedIds={extraQuincenaIds} onToggleExtra={toggleExtraQuincena} />
          {extraQuincenaIds.size > 0 ? (
            <button onClick={() => { setExtraQuincenaIds(new Set()); setPage(1) }}
              className="flex-none text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer whitespace-nowrap">
              Quitar combinación
            </button>
          ) : quincenaId !== ALL_QUINCENAS ? (
            <span className="flex-none text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Ctrl/Cmd+clic para combinar quincenas
            </span>
          ) : null}
        </div>
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
            <input ref={busquedaInputRef} type="text" placeholder="Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
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

      {(someSelected || bulkRunning) && (
        <BulkActionsBar
          count={selected.size}
          progress={bulkProgress}
          quincenas={opcionesQuincena}
          categorias={opcionesCategoria}
          users={[{ value: SIN_USUARIO, label: 'Sin asignar' }, ...opcionesUsuario]}
          onMoverQuincena={v => abrirMoverQuincena(selectedTxs, parseInt(v))}
          onCambiarCategoria={v => abrirCambiarCategoria(selectedTxs, v)}
          onCambiarUsuario={v => bulkUsuario(v === SIN_USUARIO ? '' : v)}
          onAsignarLinea={abrirAsignarLinea}
          onQuitarAsignacion={bulkQuitarAsignacion}
          onEstatus={bulkEstatus}
          onEliminar={() => {
            // Si todo lo seleccionado son compras a credito no hay nada que
            // borrar, y un dialogo que dice "Eliminar 0" no explica por que.
            if (bulkDeleteFilas.length === 0) {
              toast('Todas las seleccionadas son compras a crédito. Bórralas desde Créditos.', 'error')
              return
            }
            setConfirmBulkDelete(true)
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

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
                    {/* role=button y no <button>: la tarjeta entera ya es un
                        <button>, y anidar uno dentro de otro es HTML invalido. */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Cambiar línea de presupuesto de ${tx.descripcion}`}
                      onClick={e => { e.stopPropagation(); setLineaMovilTx(tx) }}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault(); e.stopPropagation(); setLineaMovilTx(tx)
                      }}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full cursor-pointer ${
                        tx.presupuestoId
                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {tx.presupuestoId ? <><Check size={11} /> Asignada</> : <><AlertCircle size={11} /> Sin asignar</>}
                    </span>
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
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      disabled={bulkRunning}
                      aria-label="Seleccionar todas las de esta página"
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer disabled:cursor-default" />
                  </th>
                  <th className="text-left px-5 py-3 text-slate-500 dark:text-slate-400 font-medium">Descripción</th>
                  {colVisible.has('categoria') && <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Categoría</th>}
                  {colVisible.has('presupuesto') && <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Presup.</th>}
                  {colVisible.has('quincena') && <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Quincena</th>}
                  {colVisible.has('fecha') && <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Fecha</th>}
                  {colVisible.has('usuario') && <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden lg:table-cell">Usuario</th>}
                  {colVisible.has('metodoPago') && <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium hidden lg:table-cell">Método de pago</th>}
                  {colVisible.has('tipo') && <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Tipo</th>}
                  {colVisible.has('estatus') && <th className="text-center px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Estatus</th>}
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {txs.map(tx => {
                  const catColor = CAT_COLORS[tx.categoria?.nombre] ?? DEFAULT_CAT_COLOR
                  return (
                    <tr key={tx.id} onClick={() => setDetailTx(tx)}
                      className={`cursor-pointer transition-colors group ${
                        selected.has(tx.id)
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/40'
                          : 'hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20'
                      }`}>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSelect(tx.id)}
                          disabled={bulkRunning}
                          aria-label={`Seleccionar ${tx.descripcion}`}
                          className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer disabled:cursor-default" />
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-slate-800 dark:text-slate-100 group-hover:text-indigo-700 transition-colors max-w-[200px] block truncate">{tx.descripcion}</span>
                      </td>
                      {colVisible.has('categoria') && (
                        <td className="px-4 py-3.5">
                          <InlineSelectCell
                            ariaLabel={`Categoría de ${tx.descripcion}`}
                            value={tx.categoriaId.toString()}
                            options={opcionesCategoria}
                            onChange={v => abrirCambiarCategoria([tx], v)}
                            busy={busyIds.has(tx.id)}
                            disabled={bulkRunning}
                          >
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${catColor.bg} ${catColor.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${catColor.dot}`} />
                              {tx.categoria?.nombre}
                            </span>
                          </InlineSelectCell>
                        </td>
                      )}
                      {colVisible.has('presupuesto') && (
                        <td className="px-4 py-3.5 text-center">
                          <InlineSelectCell
                            ariaLabel={`Línea de presupuesto de ${tx.descripcion}`}
                            value={tx.presupuestoId?.toString() ?? ''}
                            emptyLabel="Sin asignar"
                            options={opcionesLineaPara(tx)}
                            loading={estadoLineas(tx.quincenaId) === 'loading'}
                            disabled={bulkRunning || demasiadasQuincenas}
                            busy={busyIds.has(tx.id)}
                            title={demasiadasQuincenas
                              ? 'Filtra por quincena para asignar líneas desde la tabla'
                              : tx.presupuesto?.descripcion}
                            onChange={v => void updateTx(tx.id, { presupuestoId: v || null }, {
                              campos: ['presupuesto'],
                              okMsg: v ? 'Asignada' : 'Asignación quitada',
                              invalidarQ: [tx.quincenaId],
                            })}
                          >
                            {tx.presupuestoId ? (
                              // Un enlace cruzado se marca, no se prohibe: es legal
                              // (una partida comodin), pero el `real` de esa linea se
                              // reporta en la categoria de la LINEA y no en la de la
                              // transaccion, y eso no se nota en ningun otro lado.
                              // Lo mide el check 21 de scripts/audit-datos.sql.
                              enlaceCruzado(tx) ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400"
                                  title={`Línea de ${enlaceCruzado(tx)?.categoria?.nombre}, movimiento en ${tx.categoria?.nombre}`}
                                >
                                  <Check size={10} /> {enlaceCruzado(tx)?.categoria?.nombre}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                                  <Check size={10} /> Asignada
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                <AlertCircle size={10} /> Sin asignar
                              </span>
                            )}
                          </InlineSelectCell>
                        </td>
                      )}
                      {colVisible.has('quincena') && (
                        <td className="px-4 py-3.5">
                          <InlineSelectCell
                            ariaLabel={`Quincena de ${tx.descripcion}`}
                            value={tx.quincenaId.toString()}
                            options={opcionesQuincena}
                            onChange={v => cambiarQuincenaFila(tx, v)}
                            busy={busyIds.has(tx.id)}
                            disabled={bulkRunning}
                            title={fechaFueraDeQ(tx)
                              ? `La fecha (${formatDate(tx.fecha)}) no cae dentro de ${tx.quincena.codigo}`
                              : undefined}
                          >
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              fechaFueraDeQ(tx)
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                            }`}>{tx.quincena.codigo}</span>
                          </InlineSelectCell>
                        </td>
                      )}
                      {colVisible.has('fecha') && <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">{formatDate(tx.fecha)}</td>}
                      {colVisible.has('usuario') && (
                        <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                          <InlineSelectCell
                            ariaLabel={`Usuario de ${tx.descripcion}`}
                            value={tx.userId?.toString() ?? ''}
                            emptyLabel="Sin asignar"
                            options={opcionesUsuario}
                            busy={busyIds.has(tx.id)}
                            disabled={bulkRunning}
                            onChange={v => void updateTx(tx.id, { userId: v || null }, { campos: ['usuario'] })}
                          >
                            <span>{tx.user?.nombre ?? '—'}</span>
                          </InlineSelectCell>
                        </td>
                      )}
                      {colVisible.has('metodoPago') && (
                        <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                          <InlineSelectCell
                            ariaLabel={`Método de pago de ${tx.descripcion}`}
                            value={tx.metodoPagoId?.toString() ?? ''}
                            emptyLabel="Sin especificar"
                            options={opcionesMetodo}
                            busy={busyIds.has(tx.id)}
                            disabled={bulkRunning}
                            onChange={v => void updateTx(tx.id, { metodoPagoId: v || null }, { campos: ['metodoPago'] })}
                          >
                            <span>{tx.metodoPago?.nombre ?? '—'}</span>
                          </InlineSelectCell>
                        </td>
                      )}
                      {colVisible.has('tipo') && (
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                            tx.tipo === 'Ingreso' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                          }`}>
                            {tx.tipo === 'Ingreso' ? <ArrowUpRight size={11} /> : tx.tipo === 'Ahorro' ? <Wallet size={11} /> : <ArrowDownRight size={11} />}
                            {tx.tipo}
                          </span>
                        </td>
                      )}
                      {colVisible.has('estatus') && (
                        <td className="px-4 py-3.5 text-center">
                          <button onClick={e => { e.stopPropagation(); toggleEstatus(tx) }} disabled={togglingId === tx.id || busyIds.has(tx.id) || bulkRunning}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                              tx.estatus === 'Pagado' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                            } disabled:opacity-50`}>
                            {togglingId === tx.id ? '...' : tx.estatus}
                          </button>
                        </td>
                      )}
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
              <select id="tx-categoria" value={form.categoriaId} onChange={e => {
                const catId = e.target.value
                const cat = categorias.find(c => c.id.toString() === catId)
                const lineaActual = lineasDelModal.find(l => String(l.id) === form.presupuestoId)
                setForm(f => ({
                  ...f,
                  categoriaId: catId,
                  // Cambiar de categoria ya NO borra la linea: un enlace cruzado
                  // es legal y borrarlo en silencio seria justo la sobrescritura
                  // que este cambio evita. Solo se suelta si el TIPO deja de
                  // coincidir, que es el unico cruce que hace desaparecer el
                  // monto de los agregados.
                  presupuestoId: lineaActual && cat && lineaActual.categoria?.tipo !== cat.tipo ? '' : f.presupuestoId,
                  tipo: cat?.tipo === 'Ahorro' ? 'Ahorro' : (f.tipo === 'Ahorro' ? 'Gasto' : f.tipo),
                }))
              }} className={fieldClass(formErrors.categoriaId)}>
                <option value="">Seleccionar...</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              {formErrors.categoriaId && <p className="text-xs text-rose-500 mt-1">{formErrors.categoriaId}</p>}
            </div>
            <div>
              {esAhorro ? (
                <>
                  <Label htmlFor="tx-direccion">Dirección *</Label>
                  <select id="tx-direccion" value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} className={fieldClass()}>
                    <option value="Aporte">Aporte (suma al ahorro)</option>
                    <option value="Retiro">Retiro (resta del ahorro)</option>
                  </select>
                </>
              ) : (
                <>
                  <Label htmlFor="tx-tipo">Tipo *</Label>
                  <select id="tx-tipo" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} className={fieldClass(formErrors.tipo)}>
                    <option value="Gasto">Gasto</option>
                    <option value="Ingreso">Ingreso</option>
                  </select>
                </>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="tx-presupuesto">Línea de presupuesto</Label>
            {/* Ya NO depende de que elijas categoria: el selector se habilita en
                cuanto hay quincena. Ese `disabled={!form.categoriaId}` era la
                version de escritorio del mismo problema que el bot tenia en
                Telegram -- para ver la linea habia que adivinar primero su
                categoria. */}
            <select id="tx-presupuesto" value={form.presupuestoId} onChange={e => setForm(f => ({ ...f, presupuestoId: e.target.value }))} className={fieldClass()} disabled={!form.quincenaId}>
              <option value="">Sin asignar</option>
              {agruparPorCategoria(lineasDelModal).map(([categoria, lineas]) => (
                <optgroup key={categoria} label={categoria}>
                  {lineas.map(l => (
                    <option key={l.id} value={l.id}>{etiquetaLinea(l)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {form.quincenaId && lineasDelModal.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Esta quincena no tiene partidas de presupuesto de este tipo.</p>
            )}
            {lineaElegidaCruzada && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Esa línea es de <strong>{lineaElegidaCruzada.categoria?.nombre}</strong> y el movimiento queda en{' '}
                <strong>{categorias.find(c => c.id.toString() === form.categoriaId)?.nombre}</strong>. Se guarda así,
                pero el gasto se reportará en la categoría de la línea.{' '}
                <button
                  type="button"
                  className="underline font-medium"
                  onClick={() => setForm(f => ({ ...f, categoriaId: String(lineaElegidaCruzada.categoriaId) }))}
                >
                  Mover también la categoría
                </button>
              </p>
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

      {lineaMovilTx && (() => {
        const tx = lineaMovilTx
        const opciones = opcionesLineaPara(tx)
        const cargando = estadoLineas(tx.quincenaId) === 'loading'
        return (
          <FormModal open onOpenChange={open => { if (!open) setLineaMovilTx(null) }}
            title="Línea de presupuesto"
            subtitle={<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {tx.descripcion} · {tx.categoria?.nombre} · {tx.quincena.codigo}
            </p>}>
            <div className="space-y-4">
              <select
                aria-label="Línea de presupuesto"
                value={tx.presupuestoId?.toString() ?? ''}
                disabled={cargando}
                onChange={e => {
                  const v = e.target.value
                  setLineaMovilTx(null)
                  void updateTx(tx.id, { presupuestoId: v || null }, {
                    campos: ['presupuesto'],
                    okMsg: v ? 'Asignada' : 'Asignación quitada',
                    invalidarQ: [tx.quincenaId],
                  })
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
              >
                <option value="">{cargando ? 'Cargando líneas...' : 'Sin asignar'}</option>
                {opciones.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
              </select>
              <div className="flex justify-end">
                <button type="button" onClick={() => setLineaMovilTx(null)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                  Cerrar
                </button>
              </div>
            </div>
          </FormModal>
        )
      })()}

      {moverPlan && (
        <MoverQuincenaDialog
          plan={moverPlan.plan}
          destino={moverPlan.destino}
          categorias={categorias}
          reasignar={moverPlan.reasignar}
          cargandoLineas={estadoLineas(moverPlan.destino.id) === 'loading'}
          lineasPara={catId =>
            lineasDe(moverPlan.destino.id, { categoriaId: catId })
              .map(l => ({ value: l.id.toString(), label: etiquetaLinea(l) }))}
          onReasignar={(catId, presupuestoId) =>
            setMoverPlan(prev => prev && ({ ...prev, reasignar: { ...prev.reasignar, [catId]: presupuestoId } }))}
          onConfirm={() => void confirmarMover()}
          onCancel={() => setMoverPlan(null)}
        />
      )}

      {asignarPlan && (
        <AsignarLineaDialog
          grupos={asignarPlan.grupos}
          elegidas={asignarPlan.elegidas}
          decisiones={asignarPlan.decisiones}
          nombreQuincena={id => quincenas.find(q => q.id === id)?.codigo ?? `Q${id}`}
          nombreCategoria={id => categorias.find(c => c.id === id)?.nombre ?? 'Sin categoría'}
          cargando={id => estadoLineas(id) === 'loading'}
          lineasPara={(quincenaId, tipo) =>
            lineasDe(quincenaId, { tipo })
              .map(l => ({ value: l.id.toString(), label: etiquetaLinea(l), group: grupoLinea(l), categoriaId: l.categoriaId }))}
          onElegir={(clave, presupuestoId) =>
            // Cambiar de linea invalida la decision anterior: la pregunta es
            // sobre ESA linea, y arrastrarla seria contestar por el usuario.
            setAsignarPlan(prev => prev && ({
              ...prev,
              elegidas: { ...prev.elegidas, [clave]: presupuestoId },
              decisiones: { ...prev.decisiones, [clave]: '' },
            }))}
          onDecidir={(clave, decision) =>
            setAsignarPlan(prev => prev && ({ ...prev, decisiones: { ...prev.decisiones, [clave]: decision } }))}
          onConfirm={() => void confirmarAsignar()}
          onCancel={() => setAsignarPlan(null)}
        />
      )}

      {categoriaPlan && (
        <FormModal open onOpenChange={open => { if (!open) setCategoriaPlan(null) }}
          title={`Cambiar categoría a «${categoriaPlan.categoria.nombre}»`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {categoriaPlan.filas.length === 1
                ? `«${categoriaPlan.filas[0].descripcion}» pasará a ${categoriaPlan.categoria.nombre}.`
                : `${categoriaPlan.filas.length} transacciones pasarán a ${categoriaPlan.categoria.nombre}.`}
            </p>

            {categoriaPlan.pierdenEnlace.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 px-3 py-2">
                <Unlink size={14} className="mt-0.5 shrink-0" />
                <span>
                  {categoriaPlan.pierdenEnlace.length === 1
                    ? 'Perderá su línea de presupuesto'
                    : `${categoriaPlan.pierdenEnlace.length} perderán su línea de presupuesto`}
                  {' '}— una línea pertenece a su categoría.
                </span>
              </p>
            )}

            {categoriaPlan.cambianTipo.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {categoriaPlan.cambianTipo.length === 1 ? 'Cambiará' : `${categoriaPlan.cambianTipo.length} cambiarán`}
                  {' '}de tipo a <strong>{categoriaPlan.categoria.tipo}</strong>, así que se mueven de las
                  tarjetas de Ingresos/Gastos.
                </span>
              </p>
            )}

            {categoriaPlan.categoria.tipo === 'Ahorro' && (
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Dirección del ahorro
                </p>
                <div className="flex gap-4">
                  {(['Aporte', 'Retiro'] as const).map(d => (
                    <label key={d} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input type="radio" name="direccion-ahorro" value={d}
                        checked={categoriaPlan.direccion === d}
                        onChange={() => setCategoriaPlan(prev => prev && ({ ...prev, direccion: d }))}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                      {d === 'Aporte' ? 'Aporte (suma al ahorro)' : 'Retiro (resta del ahorro)'}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                  Sin esto todas caerían en Aporte, y un retiro quedaría sumando en vez de restando.
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button type="button" onClick={() => setCategoriaPlan(null)}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                Cancelar
              </button>
              <button type="button" onClick={() => void confirmarCategoria()}
                className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer font-medium">
                Cambiar {categoriaPlan.filas.length > 1 ? categoriaPlan.filas.length : ''}
              </button>
            </div>
          </div>
        </FormModal>
      )}

      <ConfirmDialog open={confirmBulkDelete} onOpenChange={open => !open && setConfirmBulkDelete(false)}
        title={`Eliminar ${bulkDeleteFilas.length} transacci${bulkDeleteFilas.length === 1 ? 'ón' : 'ones'}`}
        description={
          `Se eliminarán ${bulkDeleteFilas.length} por un total de ${formatMXN(
            bulkDeleteFilas.reduce((sum, t) => sum + Number(t.monto), 0),
          )}. Esta acción no se puede deshacer.`
          + (bulkDeleteExcluidas.length > 0
            ? ` ${bulkDeleteExcluidas.length} de las seleccionadas ${bulkDeleteExcluidas.length === 1 ? 'es una compra' : 'son compras'} a crédito y no se ${bulkDeleteExcluidas.length === 1 ? 'elimina' : 'eliminan'}: sus pagos programados quedarían sin transacción detrás. Bórralas desde Créditos.`
            : '')
        }
        confirmLabel={`Eliminar ${bulkDeleteFilas.length}`}
        onConfirm={() => void confirmarBulkDelete()} />

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
