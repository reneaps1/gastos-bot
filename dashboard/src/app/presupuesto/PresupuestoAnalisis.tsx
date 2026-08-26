'use client'
import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { ChevronUp, ChevronDown, Target, AlertTriangle, Activity, Sparkles, RefreshCw } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { KpiCard } from '@/components/ui/KpiCard'
import { FilterChip } from '@/components/ui/FilterChip'
import { QuincenaChips } from '@/components/ui/QuincenaChips'
import { resolveReferencia, normalizeReferencia, type ReferenciaValores } from '@/lib/referencia'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string; ingresoReferencia: number | null; limiteGastoReferencia: number | null }
interface Categoria { id: number; nombre: string; tipo: string }
interface PresupuestoRow {
  id: number; quincenaId: number; categoriaId: number
  montoPresupuestado: number | string; real: number
  categoria: { nombre: string; tipo: string }
}

interface Props {
  quincenas: Quincena[]
  categorias: Categoria[]
  today: string
  presupuestos: PresupuestoRow[]
  loading: boolean
  configGlobal: ReferenciaValores
  rango: string
  setRango: (v: string) => void
  categoriaId: string
  setCategoriaId: (v: string) => void
  onQuincenaUpdated: (updated: Quincena) => void
}

interface BalancePorQ {
  quincenaId: number; codigo: string; fechaInicio: string
  ingresos: number; gastos: number; gastosReales: number; balance: number
  esCerrada: boolean
  ingresoRef: number | null; limiteRef: number | null; tieneOverride: boolean
}

type SortKey = 'quincena' | 'ingresos' | 'gastos' | 'balance'

function quincenasEnRango(quincenas: Quincena[], rango: string, today: string): Quincena[] {
  const ordenadas = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  if (rango === 'año') return ordenadas.filter(q => q.fechaInicio.slice(0, 4) === today.slice(0, 4))
  if (rango === 'todas') return ordenadas
  const empezadas = ordenadas.filter(q => q.fechaInicio <= today)
  const n = rango === 'ultimas12' ? 12 : 6
  return empezadas.slice(-n)
}

function buildBalancePorQ(rows: PresupuestoRow[], quincenas: Quincena[], global: ReferenciaValores, today: string): BalancePorQ[] {
  const byQ = new Map<number, { ingresos: number; gastos: number; gastosReales: number }>()
  for (const p of rows) {
    const acc = byQ.get(p.quincenaId) ?? { ingresos: 0, gastos: 0, gastosReales: 0 }
    if (p.categoria.tipo === 'Ingreso') acc.ingresos += Number(p.montoPresupuestado)
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
        ingresos: acc.ingresos, gastos: acc.gastos, gastosReales: acc.gastosReales,
        balance: acc.ingresos - acc.gastos,
        esCerrada: q.fechaFin < today,
        ingresoRef: ref.ingresoReferencia, limiteRef: ref.limiteGastoReferencia,
        tieneOverride: ref.ingresoEsOverride || ref.limiteEsOverride,
      }
    })
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
  rango, setRango, categoriaId, setCategoriaId, onQuincenaUpdated,
}: Props) {
  const { toast } = useToast()

  const filasFiltradas = categoriaId ? presupuestos.filter(p => p.categoriaId.toString() === categoriaId) : presupuestos
  const quincenasFiltradas = quincenasEnRango(quincenas, rango, today)
  const balancePorQ = buildBalancePorQ(filasFiltradas, quincenasFiltradas, configGlobal, today)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))

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

  // Grafica: promedio movil de 3 sobre el gasto presupuestado, en el mismo
  // orden cronologico que la tabla (sin el sort del usuario).
  const chartData = balancePorQ.map((q, i, arr) => {
    const ventana = arr.slice(Math.max(0, i - 2), i + 1)
    const ma3Gastos = ventana.length >= 3 ? ventana.reduce((s, x) => s + x.gastos, 0) / ventana.length : null
    return { ...q, ma3Gastos }
  })

  // Analitica: siempre sobre TODAS las quincenas (sin el filtro de Categoria/
  // Rango de la tabla/grafica) y solo las ya cerradas -- necesita una muestra
  // estable, no la que el usuario este mirando en ese momento.
  const todasCerradas = buildBalancePorQ(presupuestos, quincenas, configGlobal, today)
    .filter(q => q.esCerrada)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const proy = proyeccion(todasCerradas)
  const cons = consistencia(todasCerradas)
  const excesos = categoriasQueExceden(presupuestos, todasCerradas)

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

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center gap-2">
        <FilterChip value={rango} onChange={setRango} onClear={() => setRango('ultimas6')} placeholder="Rango">
          <option value="ultimas6">Últimas 6</option>
          <option value="ultimas12">Últimas 12</option>
          <option value="año">Este año</option>
          <option value="todas">Todas</option>
        </FilterChip>
        <FilterChip value={categoriaId} onChange={setCategoriaId} onClear={() => setCategoriaId('')} placeholder="Categoría">
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </FilterChip>
      </div>

      {/* Balance por Q: tabla */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
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
                {filasOrdenadas.map(q => (
                  <tr key={q.quincenaId} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <td className="px-4 py-3">
                      <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold px-2 py-0.5 rounded-full">
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gráfica */}
      {chartData.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Ingresos y gastos presupuestados por quincena</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="codigo" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748b' }} width={44} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => formatMXN(Number(v ?? 0))} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3, fill: '#f43f5e' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="ma3Gastos" name="Tendencia (prom. móvil 3)" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 3" dot={false} />
              <Line type="stepAfter" dataKey="ingresoRef" name="Meta ingreso" stroke="#10b981" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
              <Line type="stepAfter" dataKey="limiteRef" name="Límite gasto" stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

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
          />
          <KpiCard
            label="Consistencia del gasto"
            value={cons ? (cons.cv < 0.10 ? 'Muy consistente' : cons.cv < 0.25 ? 'Moderada' : 'Muy variable') : '—'}
            subtitle={cons ? `variación ${(cons.cv * 100).toFixed(0)}% (${cons.n} quincenas)` : 'Historial insuficiente'}
            icon={<Activity size={20} className="text-sky-600 dark:text-sky-300" />}
            color="text-sky-600 dark:text-sky-400" bg="bg-sky-50 dark:bg-sky-950/50 dark:ring-1 dark:ring-sky-800/50"
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
