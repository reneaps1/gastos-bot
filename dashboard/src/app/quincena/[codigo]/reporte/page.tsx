'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer, FileSpreadsheet, SearchX } from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatMXN, formatDate } from '@/lib/utils'
import { formatQuincenaRange } from '@/lib/quincena-selection'
import { sumLiquidez, normalizeMontos, type LiquidezMontos } from '@/lib/liquidez'
import { downloadReporteExcel } from '@/lib/reporte-excel'
import { colorForCategoria } from '@/lib/category-colors'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface PresupuestoRow {
  id: number
  descripcion: string
  tipo: string
  montoPresupuestado: number | string
  real: number
  pendiente: number
  categoria: { nombre: string; tipo: string }
}
interface TransaccionRow {
  id: number
  fecha: string
  tipo: string
  descripcion: string
  monto: number | string
  estatus: string
  categoria: { nombre: string } | null
  metodoPago: { nombre: string } | null
  user: { nombre: string } | null
  presupuesto: { descripcion: string } | null
}
interface Snapshot extends LiquidezMontos {
  otrosNota: string | null
  faltaPagar: number
  validado: boolean
  fechaCorte: string
}

const TIPOS = ['Gasto', 'Ingreso', 'Ahorro'] as const

// Presupuesto.tipo es un campo casi sin uso real -- la clasificacion que ya
// usa el resto del dashboard (ver presupuesto/page.tsx) es categoria.tipo.
// Sin este fallback, categorias como "Ahorro" o "Ingresos" quedaban
// agrupadas (y sumadas) dentro de "Gasto".
function tipoDe(p: PresupuestoRow) {
  return p.categoria?.tipo ?? p.tipo
}

function groupByCategoria(rows: PresupuestoRow[]) {
  const map = new Map<string, PresupuestoRow[]>()
  for (const r of rows) {
    const key = r.categoria?.nombre ?? 'Sin categoría'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export default function ReporteQuincenaPage() {
  const { codigo } = useParams<{ codigo: string }>()

  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<Quincena | null>(null)
  const [presupuestos, setPresupuestos] = useState<PresupuestoRow[]>([])
  const [transacciones, setTransacciones] = useState<TransaccionRow[]>([])
  const [totales, setTotales] = useState({ Ingreso: 0, Gasto: 0, GastoPagado: 0 })
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const quincenas: Quincena[] = await fetch('/api/quincenas').then(r => r.json())
        const found = quincenas.find(q => q.codigo.toLowerCase() === codigo.toLowerCase()) ?? null
        setTarget(found)
        if (!found) return

        const [presupRes, txRes, liqRes] = await Promise.all([
          fetch(`/api/presupuestos?quincenaId=${found.id}`),
          fetch(`/api/transacciones?quincenaId=${found.id}&limit=1000`),
          fetch(`/api/liquidez?quincenaId=${found.id}`),
        ])
        const presupData: PresupuestoRow[] = await presupRes.json()
        const txJson = await txRes.json()
        const liqData = await liqRes.json()

        setPresupuestos(presupData)
        setTransacciones(txJson.data ?? [])
        setTotales({
          Ingreso: Number(txJson.totales?.Ingreso ?? 0),
          Gasto: Number(txJson.totales?.Gasto ?? 0),
          GastoPagado: Number(txJson.totales?.GastoPagado ?? 0),
        })
        const raw = Array.isArray(liqData) && liqData.length > 0 ? liqData[0] : null
        setSnapshot(raw ? { ...raw, ...normalizeMontos(raw), faltaPagar: Number(raw.faltaPagar) || 0 } : null)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [codigo])

  if (loading) {
    return (
      <div className="py-24 flex justify-center text-slate-400 text-sm gap-2 print:hidden">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Cargando...
      </div>
    )
  }

  if (!target) {
    return (
      <div className="text-center py-24 text-slate-400 print:hidden">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
          <SearchX size={28} className="text-slate-400" />
        </div>
        <p className="font-medium text-slate-600">Quincena &quot;{codigo}&quot; no encontrada</p>
        <Link href="/" className="inline-flex items-center gap-1.5 mt-4 text-sm text-indigo-600 hover:underline">
          <ArrowLeft size={14} /> Volver al inicio
        </Link>
      </div>
    )
  }

  const pendiente = totales.Gasto - totales.GastoPagado
  const totalLiquido = snapshot ? sumLiquidez(snapshot) : 0
  const faltaPagar = snapshot?.faltaPagar ?? 0
  const delta = totalLiquido - faltaPagar
  const deltaColor = delta < 0 ? 'text-rose-600' : delta > 0 ? 'text-emerald-600' : 'text-slate-700'
  const fechaReporte = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date())

  // Datos para las graficas del resumen
  const gastoRows = presupuestos.filter(p => tipoDe(p) === 'Gasto')
  const gastoPorCategoriaRaw = groupByCategoria(gastoRows)
    .map(([nombre, rows]) => ({ nombre, real: rows.reduce((s, p) => s + p.real, 0) }))
    .filter(c => c.real > 0)
    .sort((a, b) => b.real - a.real)
  const TOP_CATS = 6
  const gastoPorCategoria = gastoPorCategoriaRaw.length > TOP_CATS + 1
    ? [
        ...gastoPorCategoriaRaw.slice(0, TOP_CATS),
        { nombre: 'Otros', real: gastoPorCategoriaRaw.slice(TOP_CATS).reduce((s, c) => s + c.real, 0) },
      ]
    : gastoPorCategoriaRaw

  const tipoComparativo = TIPOS.map(tipo => {
    const rows = presupuestos.filter(p => tipoDe(p) === tipo)
    return {
      tipo,
      Presupuestado: rows.reduce((s, p) => s + Number(p.montoPresupuestado), 0),
      Real: rows.reduce((s, p) => s + p.real, 0),
    }
  }).filter(t => t.Presupuestado > 0 || t.Real > 0)

  async function handleExportExcel() {
    if (!target) return
    setExporting(true)
    try {
      await downloadReporteExcel({
        quincena: target,
        totales: { ingreso: totales.Ingreso, gasto: totales.Gasto, pagado: totales.GastoPagado, pendiente },
        presupuesto: presupuestos.map(p => ({
          tipo: tipoDe(p),
          categoria: p.categoria?.nombre ?? 'Sin categoría',
          descripcion: p.descripcion,
          montoPresupuestado: Number(p.montoPresupuestado),
          real: p.real,
          pendiente: p.pendiente,
        })),
        transacciones: transacciones.map(t => ({
          fecha: t.fecha,
          tipo: t.tipo,
          categoria: t.categoria?.nombre ?? '—',
          partida: t.presupuesto?.descripcion ?? '—',
          descripcion: t.descripcion,
          monto: Number(t.monto),
          estatus: t.estatus,
          metodoPago: t.metodoPago?.nombre ?? '—',
          usuario: t.user?.nombre ?? '—',
        })),
        liquidez: snapshot ? {
          fechaCorte: snapshot.fechaCorte,
          validado: snapshot.validado,
          bbva: snapshot.bbva, banamex: snapshot.banamex, uala: snapshot.uala, ualaInversion: snapshot.ualaInversion,
          efectivo: snapshot.efectivo, valesDespensa: snapshot.valesDespensa, valesGasolina: snapshot.valesGasolina,
          otros: snapshot.otros, otrosNota: snapshot.otrosNota,
          totalLiquido, faltaPagar, delta,
        } : null,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 bg-white text-slate-800">
      {/* Barra de acciones — no se imprime */}
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/quincena/${target.codigo}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors">
          <ArrowLeft size={14} /> Volver a {target.codigo}
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="flex items-center gap-2 text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
          >
            <FileSpreadsheet size={14} /> {exporting ? 'Generando...' : 'Exportar Excel'}
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors"
          >
            <Printer size={14} /> Imprimir / Guardar PDF
          </button>
        </div>
      </div>

      {/* Encabezado del reporte */}
      <div className="flex items-center gap-4 border-b-2 border-slate-800 pb-4">
        <img src="/icon-192.png" alt="Milo" className="h-12 w-12 rounded-lg" />
        <div>
          <p className="text-xl font-bold tracking-tight text-slate-900">Milo Gastos</p>
          <p className="text-sm font-medium text-slate-600">Reporte de quincena · {target.codigo}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs uppercase tracking-wide text-slate-400">Periodo</p>
          <p className="text-sm font-medium text-slate-700">{formatQuincenaRange(target)}</p>
          <p className="text-xs text-slate-400 mt-1">Fecha del reporte: {fechaReporte}</p>
        </div>
      </div>

      {/* ── Página 1: Resumen ── */}
      <div className="break-after-page space-y-6 pt-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 border-b border-slate-300 pb-1.5">Resumen</h2>

        {/* Liquidez primero: es la pregunta que más importa — cuánto hay disponible de verdad */}
        <section className="space-y-3 break-inside-avoid">
          <h3 className="text-sm font-bold text-slate-800">Liquidez</h3>
          {snapshot ? (
            <>
              <p className="text-xs text-slate-500">
                Corte del {formatDate(snapshot.fechaCorte)}{snapshot.validado && <span className="ml-1.5 text-emerald-600 font-medium">· Validado</span>}
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-slate-300 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Total líquido</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{formatMXN(totalLiquido)}</p>
                </div>
                <div className="border border-slate-300 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Falta por pagar</p>
                  <p className="text-lg font-bold text-amber-600 tabular-nums">{formatMXN(faltaPagar)}</p>
                </div>
                <div className="border border-slate-300 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Delta (líquido neto)</p>
                  <p className={`text-lg font-bold tabular-nums ${deltaColor}`}>{formatMXN(delta)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {[
                  { label: 'BBVA', value: snapshot.bbva },
                  { label: 'Banamex', value: snapshot.banamex },
                  { label: 'Ualá', value: snapshot.uala },
                  { label: 'Efectivo', value: snapshot.efectivo },
                  ...(snapshot.otros > 0 ? [{ label: snapshot.otrosNota ?? 'Otros', value: snapshot.otros }] : []),
                ].map(c => (
                  <div key={c.label} className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">{c.label}</p>
                    <p className="text-xs font-bold text-slate-800 tabular-nums">{formatMXN(c.value)}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Sin corte de liquidez capturado para esta quincena.</p>
          )}
        </section>

        {/* KPIs de presupuesto */}
        <section className="space-y-3 break-inside-avoid">
          <h3 className="text-sm font-bold text-slate-800">Presupuesto</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Ingresos', value: totales.Ingreso },
              { label: 'Gastos', value: totales.Gasto },
              { label: 'Pagado', value: totales.GastoPagado },
              { label: 'Pendiente', value: pendiente },
            ].map(k => (
              <div key={k.label} className="border border-slate-300 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">{k.label}</p>
                <p className="text-lg font-bold text-slate-900 tabular-nums">{formatMXN(k.value)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Graficas */}
        {(gastoPorCategoria.length > 0 || tipoComparativo.length > 0) && (
          <section className="space-y-3 break-inside-avoid">
            <h3 className="text-sm font-bold text-slate-800">Graficas</h3>
            <div className="grid grid-cols-2 gap-4">
              {gastoPorCategoria.length > 0 && (
                <div className="border border-slate-300 rounded-lg p-3">
                  <p className="text-xs font-medium text-slate-500 text-center mb-1">Gasto real por categoría</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={gastoPorCategoria} dataKey="real" nameKey="nombre" cx="50%" cy="50%" outerRadius={75} label={{ fontSize: 10 }} isAnimationActive={false}>
                        {gastoPorCategoria.map((c, i) => (
                          <Cell key={c.nombre} fill={colorForCategoria(c.nombre, i)} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatMXN(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {tipoComparativo.length > 0 && (
                <div className="border border-slate-300 rounded-lg p-3">
                  <p className="text-xs font-medium text-slate-500 text-center mb-1">Presupuestado vs. real</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={tipoComparativo} margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} width={45} />
                      <Tooltip formatter={(v) => formatMXN(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="Presupuestado" fill="#94a3b8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="Real" fill="#4f46e5" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ── Página 2+: Detalle ── */}
      <div className="space-y-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 border-b border-slate-300 pb-1.5">Detalle</h2>

        {/* Presupuesto detallado */}
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Presupuesto por categoría</h3>
          {TIPOS.map(tipo => {
            const rows = presupuestos.filter(p => tipoDe(p) === tipo)
            if (rows.length === 0) return null
            const totalPresup = rows.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
            const totalRealTipo = rows.reduce((s, p) => s + p.real, 0)
            return (
              <div key={tipo}>
                <p className="text-sm font-semibold text-slate-700 mb-2 break-after-avoid-page">
                  {tipo} <span className="font-normal text-slate-400">— presupuestado {formatMXN(totalPresup)} · real {formatMXN(totalRealTipo)}</span>
                </p>
                {groupByCategoria(rows).map(([catNombre, catRows]) => (
                  <div key={catNombre} className="mb-3 break-inside-avoid">
                    <p className="text-xs font-semibold text-slate-600 mb-1">{catNombre}</p>
                    <div className="overflow-hidden rounded-lg border border-slate-300">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600">
                            <th className="text-left py-2 px-3 font-semibold">Descripción</th>
                            <th className="text-right py-2 px-3 font-semibold">Presupuestado</th>
                            <th className="text-right py-2 px-3 font-semibold">Real</th>
                            <th className="text-right py-2 px-3 font-semibold">Pendiente</th>
                            <th className="text-right py-2 px-3 font-semibold">Restante</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catRows.map(p => (
                            <tr key={p.id} className="border-t border-slate-200 even:bg-slate-50/70 break-inside-avoid">
                              <td className="py-1.5 px-3 text-slate-700">{p.descripcion}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatMXN(p.montoPresupuestado)}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatMXN(p.real)}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-amber-600">{formatMXN(p.pendiente)}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatMXN(Number(p.montoPresupuestado) - p.real)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          {presupuestos.length === 0 && <p className="text-sm text-slate-400">Sin presupuesto capturado para esta quincena.</p>}
        </section>

        {/* Detalle de transacciones */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-800">Detalle de transacciones</h3>
          {transacciones.length === 0 ? (
            <p className="text-sm text-slate-400">Sin transacciones registradas.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-300">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="text-left py-2 px-3 font-semibold">Fecha</th>
                    <th className="text-left py-2 px-3 font-semibold">Tipo</th>
                    <th className="text-left py-2 px-3 font-semibold">Categoría</th>
                    <th className="text-left py-2 px-3 font-semibold">Descripción</th>
                    <th className="text-right py-2 px-3 font-semibold">Monto</th>
                    <th className="text-left py-2 px-3 font-semibold">Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {transacciones.map(t => (
                    <tr key={t.id} className="border-t border-slate-200 even:bg-slate-50/70 break-inside-avoid">
                      <td className="py-1.5 px-3 text-slate-700">{formatDate(t.fecha)}</td>
                      <td className="py-1.5 px-3 text-slate-700">{t.tipo}</td>
                      <td className="py-1.5 px-3 text-slate-700">{t.categoria?.nombre ?? '—'}</td>
                      <td className="py-1.5 px-3 text-slate-700">{t.descripcion}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatMXN(t.monto)}</td>
                      <td className="py-1.5 px-3 text-slate-700">{t.estatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="text-[10px] text-slate-400 border-t border-slate-200 pt-2 text-center">
        Documento generado automáticamente por Milo Gastos · {fechaReporte}
      </p>
    </div>
  )
}
