'use client'
import { useState, useEffect, useRef, Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, Dot, type DotItemDotProps } from 'recharts'
import { ChevronUp, ChevronDown, ChevronRight, Target, AlertTriangle, Activity, Sparkles, RefreshCw, FlaskConical, Plus, X, CopyPlus } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { KpiCard } from '@/components/ui/KpiCard'
import { FilterChip } from '@/components/ui/FilterChip'
import { QuincenaChips } from '@/components/ui/QuincenaChips'
import { resolveReferencia, normalizeReferencia, type ReferenciaValores } from '@/lib/referencia'
import { colorForCategoria } from '@/lib/category-colors'
import type { Presupuesto } from './page'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string; ingresoReferencia: number | null; limiteGastoReferencia: number | null }
interface Categoria { id: number; nombre: string; tipo: string }
// Alias del tipo completo de page.tsx: en runtime `presupuestos` ya trae las
// filas completas (mismo /api/presupuestos sin filtrar), asi que se necesita
// el shape completo para poder pasar una fila a openEdit sin cast.
type PresupuestoRow = Presupuesto

interface Props {
  quincenas: Quincena[]
  categorias: Categoria[]
  today: string
  presupuestos: PresupuestoRow[]
  loading: boolean
  configGlobal: ReferenciaValores
  desdeId: string
  setDesdeId: (v: string) => void
  hastaId: string
  setHastaId: (v: string) => void
  categoriaId: string
  setCategoriaId: (v: string) => void
  onQuincenaUpdated: (updated: Quincena) => void
  openEdit: (p: Presupuesto) => void
}

interface BalancePorQ {
  quincenaId: number; codigo: string; fechaInicio: string
  ingresos: number; ingresosReales: number; gastos: number; gastosReales: number; balance: number
  esCerrada: boolean
  ingresoRef: number | null; limiteRef: number | null; tieneOverride: boolean
}

// Series fijas disponibles en la grafica -- cada una es un dataKey que ya
// vive (o se deriva) en BalancePorQ/chartData. "Ingresos"/"Gastos" son las
// unicas activas por default; el resto es opt-in para no saturar la grafica.
interface SerieConfig { key: string; label: string; color: string; dashed?: boolean; tipo?: 'monotone' | 'stepAfter' }
const SERIES_BASE: SerieConfig[] = [
  { key: 'ingresos', label: 'Ingresos (presupuestado)', color: '#10b981' },
  { key: 'ingresosReales', label: 'Ingresos (real)', color: '#047857', dashed: true },
  { key: 'gastos', label: 'Gastos (presupuestado)', color: '#f43f5e' },
  { key: 'gastosReales', label: 'Gastos (real)', color: '#be123c', dashed: true },
  { key: 'ma3Gastos', label: 'Tendencia (prom. móvil 3)', color: '#6366f1', dashed: true },
  { key: 'ingresoRef', label: 'Meta ingreso', color: '#10b981', dashed: true, tipo: 'stepAfter' },
  { key: 'limiteRef', label: 'Límite gasto', color: '#f43f5e', dashed: true, tipo: 'stepAfter' },
]
const DEFAULT_SERIES = new Set(['ingresos', 'gastos'])

type SortKey = 'quincena' | 'ingresos' | 'gastos' | 'balance'

// Rango contiguo entre dos quincenas elegidas (inclusive en ambos extremos).
// Si vienen invertidas se auto-corrige, para no dejar la vista en un estado
// vacio confuso.
function quincenasEnRango(quincenas: Quincena[], desdeId: string, hastaId: string): Quincena[] {
  const ordenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const iDesde = ordenadas.findIndex(q => q.id.toString() === desdeId)
  const iHasta = ordenadas.findIndex(q => q.id.toString() === hastaId)
  if (iDesde === -1 || iHasta === -1) return ordenadas
  const [lo, hi] = iDesde <= iHasta ? [iDesde, iHasta] : [iHasta, iDesde]
  return ordenadas.slice(lo, hi + 1)
}

// Ultimas hasta-6 quincenas ya iniciadas, mismo criterio que usaba el preset
// "Ultimas 6" -- sirve de default inicial para Desde/Hasta.
function defaultDesdeHasta(quincenas: Quincena[], today: string): { desde: string; hasta: string } | null {
  const ordenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const empezadas = ordenadas.filter(q => q.fechaInicio <= today)
  if (empezadas.length === 0) return null
  const ultimas = empezadas.slice(-6)
  return { desde: ultimas[0].id.toString(), hasta: ultimas[ultimas.length - 1].id.toString() }
}

function buildBalancePorQ(rows: PresupuestoRow[], quincenas: Quincena[], global: ReferenciaValores, today: string): BalancePorQ[] {
  const byQ = new Map<number, { ingresos: number; ingresosReales: number; gastos: number; gastosReales: number }>()
  for (const p of rows) {
    const acc = byQ.get(p.quincenaId) ?? { ingresos: 0, ingresosReales: 0, gastos: 0, gastosReales: 0 }
    if (p.categoria.tipo === 'Ingreso') { acc.ingresos += Number(p.montoPresupuestado); acc.ingresosReales += p.real }
    if (p.categoria.tipo === 'Gasto') { acc.gastos += Number(p.montoPresupuestado); acc.gastosReales += p.real }
    byQ.set(p.quincenaId, acc)
  }
  return quincenas
    .filter(q => byQ.has(q.id))
    .map(q => {
      const acc = byQ.get(q.id)!
      const ref = resolveReferencia(q, global)
      return {
        quincenaId: q.id, codigo: q.codigo, fechaInicio: q.fechaInicio,
        ingresos: acc.ingresos, ingresosReales: acc.ingresosReales, gastos: acc.gastos, gastosReales: acc.gastosReales,
        balance: acc.ingresos - acc.gastos,
        esCerrada: q.fechaFin < today,
        ingresoRef: ref.ingresoReferencia, limiteRef: ref.limiteGastoReferencia,
        tieneOverride: ref.ingresoEsOverride || ref.limiteEsOverride,
      }
    })
}

// Categoria/linea agregada puede mostrar su monto real o su presupuestado --
// se alterna con un toggle en el chip ya agregado, en vez de que el
// desplegable ofrezca 2 entradas por cada categoria/linea (saturaria el
// menu). Real por default: es lo que ya mostraban categoria/linea antes de
// que existiera esta opcion.
type UnidadSerie = 'real' | 'presupuestado'
function valorSerie(p: PresupuestoRow, unidad: UnidadSerie): number {
  return unidad === 'real' ? p.real : Number(p.montoPresupuestado)
}
function otraUnidad(u: UnidadSerie): UnidadSerie {
  return u === 'real' ? 'presupuestado' : 'real'
}

// Monto (real o presupuestado, segun unidad) por quincena de una categoria
// especifica -- para las series opcionales "+ Agregar categoria o linea".
// Usa TODAS las filas (no filasFiltradas), a proposito: el filtro de
// Categoria de arriba acota tabla/agregados, pero una serie agregada aqui
// debe poder compararse sin importar ese filtro.
function serieCategoria(rows: PresupuestoRow[], categoriaId: number, unidad: UnidadSerie): Map<number, number> {
  const map = new Map<number, number>()
  for (const p of rows) {
    if (p.categoriaId !== categoriaId) continue
    map.set(p.quincenaId, (map.get(p.quincenaId) ?? 0) + valorSerie(p, unidad))
  }
  return map
}

interface LineaPresupuesto { categoriaId: number; descripcion: string }

// Normaliza descripcion antes de comparar (trim + minusculas) para que dos
// filas que representan la "misma" linea recurrente pero se tipearon con
// distinto case/espacios (ej. "Renta" vs "renta ") se fusionen en una sola
// serie en vez de partirse en dos series con datos incompletos cada una.
function normalizarDescripcion(s: string) {
  return s.trim().toLowerCase()
}

// Monto (real o presupuestado) por quincena de una linea de presupuesto
// especifica (ej. solo "Renta" dentro de Hogar, no toda la categoria). Un
// Presupuesto vive en una sola quincena -- no hay un id estable de la linea
// a traves del tiempo, asi que se identifica por categoria+descripcion,
// igual nombre cada Q (normalizada).
function serieLinea(rows: PresupuestoRow[], linea: LineaPresupuesto, unidad: UnidadSerie): Map<number, number> {
  const map = new Map<number, number>()
  const descripcionNormalizada = normalizarDescripcion(linea.descripcion)
  for (const p of rows) {
    if (p.categoriaId !== linea.categoriaId || normalizarDescripcion(p.descripcion) !== descripcionNormalizada) continue
    map.set(p.quincenaId, (map.get(p.quincenaId) ?? 0) + valorSerie(p, unidad))
  }
  return map
}

function lineaDataKey(l: LineaPresupuesto) {
  return `lin_${l.categoriaId}_${l.descripcion}`
}

// Todas las combinaciones categoria+descripcion ya usadas alguna vez (en
// TODAS las quincenas, mismo criterio que serieCategoria) -- son las
// opciones que puede elegir el selector "+ Agregar categoria o linea".
// Deduplica por descripcion normalizada (ver normalizarDescripcion) pero
// muestra la primera grafia tal cual se encontro, sin inventar una version
// "canonica".
function lineasDisponibles(rows: PresupuestoRow[]): LineaPresupuesto[] {
  const vistos = new Set<string>()
  const result: LineaPresupuesto[] = []
  for (const p of rows) {
    const key = `${p.categoriaId}_${normalizarDescripcion(p.descripcion)}`
    if (vistos.has(key)) continue
    vistos.add(key)
    result.push({ categoriaId: p.categoriaId, descripcion: p.descripcion })
  }
  return result.sort((a, b) => a.descripcion.localeCompare(b.descripcion))
}

// Paleta propia para lineas especificas, deliberadamente distinta de
// CAT_COLOR -- una linea siempre se dibuja punteada (ver <Line> mas abajo),
// asi que el patron solido/punteado ya la distingue de una categoria
// agregada aunque el color rote y coincida por casualidad.
const LINEA_COLORS = ['#a855f7', '#0891b2', '#ca8a04', '#be185d', '#65a30d', '#c026d3']
function colorForLinea(index: number) {
  return LINEA_COLORS[index % LINEA_COLORS.length]
}

// Claves por INSTANCIA para la grafica (distintas de lineaDataKey, que es
// por identidad categoria+descripcion y solo la usa lineasDisponibles para
// deduplicar filas crudas). Cada categoria/linea agregada o duplicada tiene
// su propio dataKey, aunque comparta categoria/descripcion con otra
// instancia ya agregada -- asi "renta (real)" y "renta (ppto)" pueden
// coexistir como dos series independientes.
function categoriaInstanceKey(instanceId: number) {
  return `cat_${instanceId}`
}
function lineaInstanceKey(instanceId: number) {
  return `lin_${instanceId}`
}

function getSortValue(q: BalancePorQ, key: SortKey): string | number {
  switch (key) {
    case 'quincena': return q.fechaInicio
    case 'ingresos': return q.ingresos
    case 'gastos': return q.gastos
    case 'balance': return q.balance
  }
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

function fieldClass() {
  return 'w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 border-slate-200 dark:border-slate-700'
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

// Sustituye el gasto real de una quincena por un valor hipotetico -- usado
// por el modo Simulacion para recalcular proyeccion/consistencia "que tal
// si". No muta el arreglo original.
function conSimulacion(cerradas: BalancePorQ[], sim: { quincenaId: number; gastoHipotetico: number } | null): BalancePorQ[] {
  if (!sim) return cerradas
  return cerradas.map(q => q.quincenaId === sim.quincenaId ? { ...q, gastosReales: sim.gastoHipotetico } : q)
}

// Analitica: promedio +- desviacion del gasto real de las ultimas hasta-3
// quincenas ya cerradas (fechaFin < hoy) -- una quincena en curso todavia no
// tiene un gasto real final, incluirla sesgaria la proyeccion a la baja.
function proyeccion(cerradas: BalancePorQ[]) {
  const ultimas = cerradas.slice(-3)
  if (ultimas.length === 0) return null
  const valores = ultimas.map(q => q.gastosReales)
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length
  const varianza = valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length
  return { promedio, desviacion: Math.sqrt(varianza), n: ultimas.length }
}

// Coeficiente de variacion del gasto real de las ultimas hasta-6 quincenas
// cerradas: que tan predecible es tu gasto de un periodo a otro.
function consistencia(cerradas: BalancePorQ[]) {
  const ultimas = cerradas.slice(-6)
  if (ultimas.length < 2) return null
  const valores = ultimas.map(q => q.gastosReales)
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length
  if (promedio === 0) return { cv: 0, n: ultimas.length }
  const varianza = valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length
  return { cv: Math.sqrt(varianza) / promedio, n: ultimas.length }
}

interface CategoriaExceso { nombre: string; tasa: number; promedioExceso: number; consideradas: number }

// Por categoria de Gasto, en cuantas de las ultimas hasta-6 quincenas cerradas
// el real supero lo presupuestado -- usa las filas SIN filtrar (todas las
// categorias, sin el filtro de Categoria de la tabla/grafica) porque el punto
// es justamente comparar entre categorias.
function categoriasQueExceden(rows: PresupuestoRow[], cerradasRecientes: BalancePorQ[]): CategoriaExceso[] {
  const idsRecientes = new Set(cerradasRecientes.slice(-6).map(q => q.quincenaId))
  const porCategoria = new Map<string, Map<number, { real: number; presupuestado: number }>>()
  for (const p of rows) {
    if (p.categoria.tipo !== 'Gasto' || !idsRecientes.has(p.quincenaId)) continue
    if (!porCategoria.has(p.categoria.nombre)) porCategoria.set(p.categoria.nombre, new Map())
    const porQ = porCategoria.get(p.categoria.nombre)!
    const acc = porQ.get(p.quincenaId) ?? { real: 0, presupuestado: 0 }
    acc.real += p.real
    acc.presupuestado += Number(p.montoPresupuestado)
    porQ.set(p.quincenaId, acc)
  }
  const result: CategoriaExceso[] = []
  for (const [nombre, porQ] of porCategoria) {
    const consideradas = porQ.size
    if (consideradas < 2) continue
    let excedidas = 0
    let sumaExceso = 0
    for (const { real, presupuestado } of porQ.values()) {
      if (real > presupuestado) { excedidas++; sumaExceso += real - presupuestado }
    }
    const tasa = excedidas / consideradas
    if (tasa >= 0.5) result.push({ nombre, tasa, promedioExceso: excedidas > 0 ? sumaExceso / excedidas : 0, consideradas })
  }
  return result.sort((a, b) => b.tasa - a.tasa || b.promedioExceso - a.promedioExceso).slice(0, 5)
}

export function PresupuestoAnalisis({
  quincenas, categorias, today, presupuestos, loading, configGlobal,
  desdeId, setDesdeId, hastaId, setHastaId, categoriaId, setCategoriaId, onQuincenaUpdated,
  openEdit,
}: Props) {
  const { toast } = useToast()

  // Default inicial de Desde/Hasta (ultimas 6 quincenas iniciadas), una sola
  // vez que la lista de quincenas ya cargo -- mismo patron que refQuincenaId
  // mas abajo.
  useEffect(() => {
    if (!desdeId && !hastaId && quincenas.length > 0) {
      const def = defaultDesdeHasta(quincenas, today)
      if (def) { setDesdeId(def.desde); setHastaId(def.hasta) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quincenas])

  const filasFiltradas = categoriaId ? presupuestos.filter(p => p.categoriaId.toString() === categoriaId) : presupuestos
  const quincenasFiltradas = quincenasEnRango(quincenas, desdeId, hastaId)
  const balancePorQ = buildBalancePorQ(filasFiltradas, quincenasFiltradas, configGlobal, today)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))

  const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set())
  function toggleExpand(quincenaId: number) {
    setExpandedQ(prev => {
      const next = new Set(prev)
      next.has(quincenaId) ? next.delete(quincenaId) : next.add(quincenaId)
      return next
    })
  }
  // Colapsar/expandir toda la tabla, sin afectar expandedQ (el detalle por
  // fila que estaba abierto sigue abierto al volver a expandir).
  const [tablaColapsada, setTablaColapsada] = useState(false)

  const [sortKey, setSortKey] = useState<SortKey>('quincena')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const filasOrdenadas = [...balancePorQ].sort((a, b) => {
    const va = getSortValue(a, sortKey), vb = getSortValue(b, sortKey)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sortDir === 'asc' ? cmp : -cmp
  })

  // Series elegibles de la grafica (checkmarks) + categorias agregadas como
  // lineas de comparacion opcionales.
  const [seriesActivas, setSeriesActivas] = useState<Set<string>>(new Set(DEFAULT_SERIES))
  function toggleSerie(key: string) {
    setSeriesActivas(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  // Contador monotono para instanceId, nunca decrementado al quitar una
  // instancia -- a diferencia de .length, un id derivado de .length se
  // reutilizaria despues de quitar+agregar y podria chocar con una
  // instancia que sigue viva. Un solo contador compartido entre categorias
  // y lineas (no dos independientes): ambos chips viven en el mismo
  // contenedor, y si cada arreglo tuviera su propio contador desde 0 una
  // categoria y una linea podrian generar el mismo instanceId y colisionar
  // como key de React.
  const nextInstanceId = useRef(0)
  function mintInstanceId() {
    return nextInstanceId.current++
  }

  const [categoriasAgregadas, setCategoriasAgregadas] = useState<{ instanceId: number; categoriaId: number; unidad: UnidadSerie }[]>([])
  function agregarCategoria(categoriaId: number) {
    if (categoriasAgregadas.some(c => c.categoriaId === categoriaId)) return
    setCategoriasAgregadas(prev => [...prev, { instanceId: mintInstanceId(), categoriaId, unidad: 'real' }])
  }
  // Agrega una segunda (o tercera...) instancia de la MISMA categoria, con
  // la unidad opuesta a la original por default -- un clic te da real+ppto
  // lado a lado, en vez de reabrir el desplegable (que solo ofrece cada
  // categoria/linea una vez, ver gruposAgregar).
  function duplicarCategoria(instanceId: number) {
    const original = categoriasAgregadas.find(c => c.instanceId === instanceId)
    if (!original) return
    setCategoriasAgregadas(prev => [...prev, { instanceId: mintInstanceId(), categoriaId: original.categoriaId, unidad: otraUnidad(original.unidad) }])
  }
  function quitarCategoria(instanceId: number) {
    setCategoriasAgregadas(prev => prev.filter(c => c.instanceId !== instanceId))
  }
  function toggleUnidadCategoria(instanceId: number) {
    setCategoriasAgregadas(prev => prev.map(c => c.instanceId === instanceId ? { ...c, unidad: otraUnidad(c.unidad) } : c))
  }

  const [lineasAgregadas, setLineasAgregadas] = useState<(LineaPresupuesto & { instanceId: number; unidad: UnidadSerie; color: string })[]>([])
  function agregarLinea(linea: LineaPresupuesto) {
    if (lineasAgregadas.some(l => l.categoriaId === linea.categoriaId && l.descripcion === linea.descripcion)) return
    const instanceId = mintInstanceId()
    setLineasAgregadas(prev => [...prev, { ...linea, instanceId, unidad: 'real', color: colorForLinea(instanceId) }])
  }
  function duplicarLinea(instanceId: number) {
    const original = lineasAgregadas.find(l => l.instanceId === instanceId)
    if (!original) return
    const nuevoId = mintInstanceId()
    setLineasAgregadas(prev => [...prev, { categoriaId: original.categoriaId, descripcion: original.descripcion, instanceId: nuevoId, unidad: otraUnidad(original.unidad), color: colorForLinea(nuevoId) }])
  }
  function quitarLinea(instanceId: number) {
    setLineasAgregadas(prev => prev.filter(l => l.instanceId !== instanceId))
  }
  function toggleUnidadLinea(instanceId: number) {
    setLineasAgregadas(prev => prev.map(l => l.instanceId === instanceId ? { ...l, unidad: otraUnidad(l.unidad) } : l))
  }

  // Modo Simulacion: 100% en memoria del navegador, nunca se guarda -- ver
  // guardarReferencia() mas abajo para contraste (ese si hace PUT). Cambiar
  // de quincena o refrescar la pagina la borra sin dejar rastro.
  const [simulando, setSimulando] = useState(false)
  const [simQuincenaId, setSimQuincenaId] = useState('')
  const [simGastoInput, setSimGastoInput] = useState('')
  const simQuincena = quincenasFiltradas.find(q => q.id.toString() === simQuincenaId) ?? null

  // Al activar Simular, o al no haber ninguna quincena elegida todavia,
  // arranca en la mas reciente del rango actual con su gasto real como
  // punto de partida editable.
  useEffect(() => {
    if (!simulando) return
    const objetivo = simQuincenaId ? balancePorQ.find(q => q.quincenaId.toString() === simQuincenaId) : undefined
    if (objetivo) return
    const ultima = balancePorQ[balancePorQ.length - 1]
    if (ultima) { setSimQuincenaId(ultima.quincenaId.toString()); setSimGastoInput(ultima.gastosReales.toString()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulando, quincenasFiltradas])

  function cambiarSimQuincena(id: string) {
    setSimQuincenaId(id)
    const q = balancePorQ.find(x => x.quincenaId.toString() === id)
    setSimGastoInput(q ? q.gastosReales.toString() : '')
  }

  // Grafica: promedio movil de 3 sobre el gasto presupuestado, en el mismo
  // orden cronologico que la tabla (sin el sort del usuario), mas una
  // columna por cada categoria agregada y, si hay simulacion activa, el
  // gasto real hipotetico de esa quincena.
  const seriesCategoriaData = categoriasAgregadas.map(c => ({ instanceId: c.instanceId, serie: serieCategoria(presupuestos, c.categoriaId, c.unidad) }))
  const seriesLineaData = lineasAgregadas.map(l => ({ instanceId: l.instanceId, serie: serieLinea(presupuestos, l, l.unidad) }))
  const simGastoNum = Number(simGastoInput)
  const simGastoHipotetico = simGastoInput !== '' && Number.isFinite(simGastoNum) ? simGastoNum : null
  const chartData = balancePorQ.map((q, i, arr) => {
    const ventana = arr.slice(Math.max(0, i - 2), i + 1)
    const ma3Gastos = ventana.length >= 3 ? ventana.reduce((s, x) => s + x.gastos, 0) / ventana.length : null
    const catValues: Record<string, number | null> = {}
    for (const { instanceId, serie } of seriesCategoriaData) catValues[categoriaInstanceKey(instanceId)] = serie.get(q.quincenaId) ?? null
    for (const { instanceId, serie } of seriesLineaData) catValues[lineaInstanceKey(instanceId)] = serie.get(q.quincenaId) ?? null
    const gastoSimulado = simulando && simGastoHipotetico != null
      ? (q.quincenaId === simQuincena?.id ? simGastoHipotetico : q.gastosReales)
      : null
    return { ...q, ma3Gastos, ...catValues, gastoSimulado }
  })

  // Que series tienen al menos un dato para graficar en el rango actual --
  // si ninguna serie activa tiene ni un solo valor real, el auto-domain de
  // Recharts colapsa y el eje Y se queda sin etiquetas (grafica "rota" en
  // blanco). Se detecta ese caso para mostrar un mensaje en vez de un eje
  // vacio -- el auto-scale en si funciona bien apenas hay algun dato.
  const activeChartKeys = [
    ...SERIES_BASE.filter(s => seriesActivas.has(s.key)).map(s => s.key),
    ...categoriasAgregadas.map(c => categoriaInstanceKey(c.instanceId)),
    ...lineasAgregadas.map(l => lineaInstanceKey(l.instanceId)),
  ]
  const hayDatosParaGraficar = activeChartKeys.length > 0 && chartData.some(row =>
    activeChartKeys.some(k => {
      const v = (row as unknown as Record<string, number | null>)[k]
      return typeof v === 'number' && Number.isFinite(v)
    })
  )

  // Analitica: siempre sobre TODAS las quincenas (sin el filtro de Categoria/
  // Rango de la tabla/grafica) y solo las ya cerradas -- necesita una muestra
  // estable, no la que el usuario este mirando en ese momento.
  const todasCerradas = buildBalancePorQ(presupuestos, quincenas, configGlobal, today)
    .filter(q => q.esCerrada)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const proy = proyeccion(todasCerradas)
  const cons = consistencia(todasCerradas)
  const excesos = categoriasQueExceden(presupuestos, todasCerradas)

  // "Con simulacion": mismas funciones, sustituyendo el gasto real de la
  // quincena simulada. Si esa quincena no esta cerrada (ej. la actual, "en
  // curso"), la sustitucion no cambia nada en proyeccion/consistencia -- en
  // ese caso no se muestra el renglon "con simulacion" para no mostrar un
  // numero identico al real sin explicacion.
  const simSustitucion = simulando && simQuincena && simGastoHipotetico != null
    ? { quincenaId: simQuincena.id, gastoHipotetico: simGastoHipotetico }
    : null
  const simAfectaCerradas = simSustitucion != null && todasCerradas.some(q => q.quincenaId === simSustitucion.quincenaId)
  const cerradasConSim = conSimulacion(todasCerradas, simSustitucion)
  const proySim = simAfectaCerradas ? proyeccion(cerradasConSim) : null
  const consSim = simAfectaCerradas ? consistencia(cerradasConSim) : null

  // Formulario de referencia por quincena
  const [refQuincenaId, setRefQuincenaId] = useState('')
  const [ingresoInput, setIngresoInput] = useState('')
  const [limiteInput, setLimiteInput] = useState('')
  const [refSaving, setRefSaving] = useState(false)

  useEffect(() => {
    if (!refQuincenaId && quincenas.length > 0) {
      const actual = quincenas.find(q => q.fechaInicio <= today && today <= q.fechaFin)
      setRefQuincenaId((actual ?? quincenas[quincenas.length - 1]).id.toString())
    }
  }, [quincenas, today, refQuincenaId])

  const refQuincena = quincenas.find(q => q.id.toString() === refQuincenaId) ?? null
  useEffect(() => {
    setIngresoInput(refQuincena?.ingresoReferencia != null ? refQuincena.ingresoReferencia.toString() : '')
    setLimiteInput(refQuincena?.limiteGastoReferencia != null ? refQuincena.limiteGastoReferencia.toString() : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refQuincenaId])

  async function guardarReferencia(overrides?: { ingresoReferencia: number | null; limiteGastoReferencia: number | null }) {
    if (!refQuincena) return
    setRefSaving(true)
    try {
      const body = overrides ?? {
        ingresoReferencia: ingresoInput === '' ? null : Number(ingresoInput),
        limiteGastoReferencia: limiteInput === '' ? null : Number(limiteInput),
      }
      const res = await fetch(`/api/quincenas/${refQuincena.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      onQuincenaUpdated(normalizeReferencia(updated))
      toast(overrides ? 'Se usará el valor global para esta quincena' : 'Referencia de la quincena actualizada')
    } catch {
      toast('Error al guardar la referencia', 'error')
    } finally {
      setRefSaving(false)
    }
  }

  const quincenasOrdenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))

  // Opciones del selector "+ Agregar categoria o linea": una categoria
  // completa (si no esta ya agregada) mas cada linea individual ya usada en
  // esa categoria (si no esta ya agregada) -- agrupadas por categoria para
  // que el dropdown se lea como un arbol categoria -> sus lineas.
  const disponibles = lineasDisponibles(presupuestos)
  const gruposAgregar = categorias
    .map(cat => {
      const opciones: { value: string; label: string }[] = []
      if (!categoriasAgregadas.some(c => c.categoriaId === cat.id)) opciones.push({ value: `c${cat.id}`, label: 'Toda la categoría' })
      disponibles.forEach((l, idx) => {
        if (l.categoriaId !== cat.id) return
        if (lineasAgregadas.some(la => la.categoriaId === l.categoriaId && la.descripcion === l.descripcion)) return
        opciones.push({ value: `l${idx}`, label: l.descripcion })
      })
      return { cat, opciones }
    })
    .filter(g => g.opciones.length > 0)

  return (
    <div className="space-y-6">
      {/* Analítica */}
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
          <Sparkles size={14} className="text-indigo-500 dark:text-indigo-400" /> Analítica
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            label="Proyección próxima quincena"
            value={proy ? formatMXN(proy.promedio) : '—'}
            subtitle={proy ? `± ${formatMXN(proy.desviacion)} (${proy.n} quincenas)` : 'Historial insuficiente'}
            icon={<Target size={20} className="text-indigo-600 dark:text-indigo-300" />}
            color="text-indigo-600 dark:text-indigo-400" bg="bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50"
            action={proySim && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <FlaskConical size={10} /> con simulación: {formatMXN(proySim.promedio)}
              </p>
            )}
          />
          <KpiCard
            label="Consistencia del gasto"
            value={cons ? (cons.cv < 0.10 ? 'Muy consistente' : cons.cv < 0.25 ? 'Moderada' : 'Muy variable') : '—'}
            subtitle={cons ? `variación ${(cons.cv * 100).toFixed(0)}% (${cons.n} quincenas)` : 'Historial insuficiente'}
            icon={<Activity size={20} className="text-sky-600 dark:text-sky-300" />}
            color="text-sky-600 dark:text-sky-400" bg="bg-sky-50 dark:bg-sky-950/50 dark:ring-1 dark:ring-sky-800/50"
            action={consSim && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <FlaskConical size={10} /> con simulación: {consSim.cv < 0.10 ? 'Muy consistente' : consSim.cv < 0.25 ? 'Moderada' : 'Muy variable'}
              </p>
            )}
          />
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500 dark:text-amber-400" /> Categorías que se exceden seguido
            </p>
            {excesos.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-2">Sin patrones — o historial insuficiente todavía.</p>
            ) : (
              <ul className="space-y-1.5">
                {excesos.map(e => (
                  <li key={e.nombre} className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200">{e.nombre}</span>
                    <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                      {Math.round(e.tasa * e.consideradas)}/{e.consideradas} · +{formatMXN(e.promedioExceso)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="an-desde">Desde</Label>
          <select id="an-desde" value={desdeId} onChange={e => setDesdeId(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            {quincenasOrdenadas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="an-hasta">Hasta</Label>
          <select id="an-hasta" value={hastaId} onChange={e => setHastaId(e.target.value)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            {quincenasOrdenadas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
        </div>
        <FilterChip value={categoriaId} onChange={setCategoriaId} onClear={() => setCategoriaId('')} placeholder="Categoría">
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </FilterChip>
      </div>

      {/* Balance por Q: tabla */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-2 p-4 pb-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Balance por Q</p>
          <button type="button" onClick={() => setTablaColapsada(v => !v)}
            aria-label={tablaColapsada ? 'Mostrar tabla de balance por quincena' : 'Ocultar tabla de balance por quincena'}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border cursor-pointer transition-colors bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-700">
            {tablaColapsada ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {tablaColapsada ? 'Mostrar' : 'Ocultar'}
          </button>
        </div>
        {!tablaColapsada && (loading ? (
          <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Cargando...</div>
        ) : filasOrdenadas.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-slate-500">
            <p className="font-medium text-slate-600 dark:text-slate-400">Sin presupuesto en este rango</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <SortableTh label="Q" sortKeyName="quincena" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Ingresos" sortKeyName="ingresos" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Gastos" sortKeyName="gastos" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Balance" sortKeyName="balance" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filasOrdenadas.map(q => {
                  const expanded = expandedQ.has(q.quincenaId)
                  const gastosDeQ = filasFiltradas.filter(p => p.quincenaId === q.quincenaId && p.categoria.tipo === 'Gasto')
                  return (
                    <Fragment key={q.quincenaId}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleExpand(q.quincenaId)}
                            className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors cursor-pointer align-middle"
                            aria-label={expanded ? 'Ocultar detalle' : 'Ver detalle de gastos'}>
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <span className="ml-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                            {q.codigo}
                          </span>
                          {!q.esCerrada && <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">en curso</span>}
                          {q.tieneOverride && <span className="ml-1.5 text-[10px] text-indigo-500 dark:text-indigo-400" title="Referencia personalizada para esta quincena">·ref</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{formatMXN(q.ingresos)}</td>
                        <td className="px-4 py-3 text-right text-rose-600 dark:text-rose-400 tabular-nums">{formatMXN(q.gastos)}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${q.balance >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatMXN(q.balance)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                          <td colSpan={4} className="px-4 py-3">
                            {gastosDeQ.length === 0 ? (
                              <p className="text-xs text-slate-400 dark:text-slate-500">Sin partidas de gasto en esta quincena.</p>
                            ) : (
                              <div className="space-y-1 max-w-xl">
                                {gastosDeQ.map(p => (
                                  <div key={p.id} className="flex items-center justify-between text-xs">
                                    <span className="text-slate-600 dark:text-slate-300 truncate pr-3">{p.categoria.nombre} · {p.descripcion}</span>
                                    <span className="tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                                      {formatMXN(p.real)} <span className="text-slate-400 dark:text-slate-600">/ {formatMXN(Number(p.montoPresupuestado))}</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Gráfica */}
      {chartData.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Comparativa por quincena</p>
            <button type="button" onClick={() => setSimulando(s => !s)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${simulando ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300 dark:hover:border-amber-700'}`}>
              <FlaskConical size={13} /> Simular
            </button>
          </div>

          {/* Series elegibles */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SERIES_BASE.map(s => {
              const active = seriesActivas.has(s.key)
              return (
                <button key={s.key} type="button" onClick={() => toggleSerie(s.key)}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border cursor-pointer transition-colors ${active ? 'text-white border-transparent' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200'}`}
                  style={active ? { backgroundColor: s.color } : undefined}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: active ? '#fff' : s.color }} />
                  {s.label}
                </button>
              )
            })}
          </div>

          {/* Categorías y líneas agregadas para comparar -- cada chip trae su
              propio toggle real/ppto, en vez de que el desplegable ofrezca
              2 entradas por categoria/linea (saturaria el menu). */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {categoriasAgregadas.map((c, i) => {
              const cat = categorias.find(x => x.id === c.categoriaId)
              if (!cat) return null
              const color = colorForCategoria(cat.nombre, i)
              return (
                <span key={c.instanceId} className="inline-flex items-center gap-1 text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full text-white" style={{ backgroundColor: color }}>
                  {cat.nombre}
                  <button type="button" onClick={() => toggleUnidadCategoria(c.instanceId)}
                    className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 cursor-pointer"
                    title="Cambiar entre real y presupuestado">
                    {c.unidad === 'real' ? 'real' : 'ppto'}
                  </button>
                  <button type="button" onClick={() => duplicarCategoria(c.instanceId)} className="hover:opacity-70 cursor-pointer"
                    aria-label={`Duplicar ${cat.nombre} para comparar real vs. presupuestado`} title="Duplicar (comparar real vs. presupuestado)">
                    <CopyPlus size={12} />
                  </button>
                  <button type="button" onClick={() => quitarCategoria(c.instanceId)} className="hover:opacity-70 cursor-pointer" aria-label={`Quitar ${cat.nombre} de la gráfica`}>
                    <X size={12} />
                  </button>
                </span>
              )
            })}
            {lineasAgregadas.map(l => {
              const cat = categorias.find(c => c.id === l.categoriaId)
              const label = cat ? `${cat.nombre} · ${l.descripcion}` : l.descripcion
              return (
                <span key={l.instanceId}
                  className="inline-flex items-center gap-1 text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full border-2 border-dashed"
                  style={{ borderColor: l.color, color: l.color }}>
                  {label}
                  <button type="button" onClick={() => toggleUnidadLinea(l.instanceId)}
                    className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white hover:opacity-80 cursor-pointer"
                    style={{ backgroundColor: l.color }}
                    title="Cambiar entre real y presupuestado">
                    {l.unidad === 'real' ? 'real' : 'ppto'}
                  </button>
                  <button type="button" onClick={() => duplicarLinea(l.instanceId)} className="hover:opacity-70 cursor-pointer"
                    aria-label={`Duplicar ${label} para comparar real vs. presupuestado`} title="Duplicar (comparar real vs. presupuestado)">
                    <CopyPlus size={12} />
                  </button>
                  <button type="button" onClick={() => quitarLinea(l.instanceId)} className="hover:opacity-70 cursor-pointer" aria-label={`Quitar ${label} de la gráfica`}>
                    <X size={12} />
                  </button>
                </span>
              )
            })}
            {gruposAgregar.length > 0 && (
              <div className="relative inline-flex items-center">
                <Plus size={12} className="absolute left-2.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
                <select value="" onChange={e => {
                    const v = e.target.value
                    if (!v) return
                    if (v[0] === 'c') agregarCategoria(Number(v.slice(1)))
                    else { const l = disponibles[Number(v.slice(1))]; if (l) agregarLinea(l) }
                  }}
                  aria-label="Agregar categoría o línea de presupuesto a la gráfica"
                  className="text-xs rounded-full pl-7 pr-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">Agregar categoría o línea</option>
                  {gruposAgregar.map(({ cat, opciones }) => (
                    <optgroup key={cat.id} label={cat.nombre}>
                      {opciones.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Mini-formulario de simulación -- 100% en memoria, ver conSimulacion() */}
          {simulando && (
            <div className="flex flex-wrap items-end gap-3 mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
              <div>
                <Label htmlFor="an-sim-q">Quincena a simular</Label>
                <select id="an-sim-q" value={simQuincenaId} onChange={e => cambiarSimQuincena(e.target.value)}
                  className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {quincenasFiltradas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="an-sim-gasto">Gasto hipotético</Label>
                <input id="an-sim-gasto" type="number" min="0" step="0.01" value={simGastoInput} onChange={e => setSimGastoInput(e.target.value)} className={fieldClass()} />
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5 pb-2">
                <FlaskConical size={12} /> Solo en esta vista — nada se guarda ni se envía al servidor.
              </p>
              {simSustitucion && !simAfectaCerradas && (
                <p className="text-xs text-amber-700 dark:text-amber-400 basis-full">
                  {simQuincena?.codigo} sigue en curso — se ve reflejado en la gráfica, pero Proyección/Consistencia solo usan quincenas ya cerradas.
                </p>
              )}
            </div>
          )}

          {hayDatosParaGraficar ? (
            <ResponsiveContainer width="100%" height={268}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="codigo" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748b' }} width={44} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => formatMXN(Number(v ?? 0))} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                {SERIES_BASE.filter(s => seriesActivas.has(s.key)).map(s => (
                  <Line key={s.key} type={s.tipo ?? 'monotone'} dataKey={s.key} name={s.label}
                    stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '4 2' : undefined}
                    dot={s.dashed ? false : { r: 3, fill: s.color }} activeDot={s.dashed ? undefined : { r: 5 }}
                    connectNulls={s.tipo === 'stepAfter'} isAnimationActive={false} />
                ))}
                {categoriasAgregadas.map((c, i) => {
                  const cat = categorias.find(x => x.id === c.categoriaId)
                  if (!cat) return null
                  const color = colorForCategoria(cat.nombre, i)
                  const name = `${cat.nombre} (${c.unidad === 'real' ? 'real' : 'ppto'})`
                  return (
                    <Line key={categoriaInstanceKey(c.instanceId)} type="monotone" dataKey={categoriaInstanceKey(c.instanceId)} name={name}
                      stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }}
                      connectNulls isAnimationActive={false} />
                  )
                })}
                {lineasAgregadas.map(l => {
                  const cat = categorias.find(c => c.id === l.categoriaId)
                  const label = cat ? `${cat.nombre} · ${l.descripcion}` : l.descripcion
                  const name = `${label} (${l.unidad === 'real' ? 'real' : 'ppto'})`
                  // Un punto de linea agregada mapea 1:1 a una fila Presupuesto real
                  // (categoria+descripcion normalizada+quincena) -- a diferencia de
                  // categoriasAgregadas/SERIES_BASE, que suman o derivan de varias
                  // filas (o ninguna), por eso solo estas lineas son editables.
                  const editarPunto = (payload: { quincenaId: number }) => {
                    const row = presupuestos.find(p =>
                      p.categoriaId === l.categoriaId &&
                      normalizarDescripcion(p.descripcion) === normalizarDescripcion(l.descripcion) &&
                      p.quincenaId === payload.quincenaId
                    )
                    if (row) openEdit(row)
                  }
                  // Forma-funcion (no objeto) para el dot: es la unica que recharts
                  // tipa con el payload del punto (DotItemDotProps) -- la forma-objeto
                  // no expone payload en sus tipos aunque en runtime si lo reciba.
                  // activeDot=false evita que el punto activo (mas grande, sin click)
                  // quede encima del dot y se trague el click al hacer hover-y-click.
                  const renderDot = (dotProps: DotItemDotProps) => {
                    const { cx, cy, payload } = dotProps
                    if (typeof cx !== 'number' || typeof cy !== 'number') return null
                    return (
                      <Dot cx={cx} cy={cy} r={3} fill={l.color} style={{ cursor: 'pointer' }}
                        onClick={() => editarPunto(payload)} />
                    )
                  }
                  return (
                    <Line key={lineaInstanceKey(l.instanceId)} type="monotone" dataKey={lineaInstanceKey(l.instanceId)} name={name}
                      stroke={l.color} strokeWidth={2} strokeDasharray="4 2"
                      dot={renderDot}
                      activeDot={false}
                      connectNulls isAnimationActive={false} />
                  )
                })}
                {simulando && (
                  <Line type="monotone" dataKey="gastoSimulado" name="Gasto simulado" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2"
                    dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                )}
                <Brush dataKey="codigo" height={24} stroke="#6366f1" fill="#eef2ff" travellerWidth={8} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[268px] flex items-center justify-center text-center px-6">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {activeChartKeys.length === 0
                  ? 'Activa al menos una serie arriba para ver la gráfica.'
                  : 'Sin datos para la selección actual en este rango de quincenas.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Referencia por quincena */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Referencia por quincena</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
          Solo para la quincena elegida — si la dejas vacía, se usa el global de Configuración → Períodos de pago.
        </p>
        <div className="mb-3">
          <QuincenaChips quincenas={quincenas} quincenaId={refQuincenaId} today={today} onSelect={setRefQuincenaId} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Label htmlFor="an-ingreso">Ingreso de referencia</Label>
              {refQuincena?.ingresoReferencia != null && (
                <span className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded-full">personalizado</span>
              )}
            </div>
            <input id="an-ingreso" type="number" min="0" step="0.01"
              placeholder={configGlobal.ingresoReferencia != null ? formatMXN(configGlobal.ingresoReferencia) : 'Ej: 20000'}
              value={ingresoInput} onChange={e => setIngresoInput(e.target.value)} className={fieldClass()} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Label htmlFor="an-limite">Límite de gasto de referencia</Label>
              {refQuincena?.limiteGastoReferencia != null && (
                <span className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded-full">personalizado</span>
              )}
            </div>
            <input id="an-limite" type="number" min="0" step="0.01"
              placeholder={configGlobal.limiteGastoReferencia != null ? formatMXN(configGlobal.limiteGastoReferencia) : 'Ej: 15000'}
              value={limiteInput} onChange={e => setLimiteInput(e.target.value)} className={fieldClass()} />
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-3">
          <button type="button" disabled={refSaving || !refQuincena}
            onClick={() => guardarReferencia({ ingresoReferencia: null, limiteGastoReferencia: null })}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
            <RefreshCw size={13} /> Usar global
          </button>
          <button type="button" disabled={refSaving || !refQuincena} onClick={() => guardarReferencia()}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60 cursor-pointer font-medium min-w-[100px]">
            {refSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
