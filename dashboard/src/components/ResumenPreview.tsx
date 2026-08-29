'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileDown, FileSpreadsheet, Image as ImageIcon, FileText, Loader2 } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { formatQuincenaRange, getMexicoDateString } from '@/lib/quincena-selection'
import { sumLiquidez, normalizeMontos } from '@/lib/liquidez'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'
import { downloadResumenExcel } from '@/lib/reporte-excel'
import { downloadElementAsImage, downloadElementAsPdf } from '@/lib/capture-export'
import { toCsv, downloadCsv } from '@/lib/csv'
import { useToast } from '@/components/Toast'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface PresupuestoRow {
  id: number
  descripcion: string
  montoEfectivo: number
  real: number
  pendiente: number
  categoria: { nombre: string; tipo: string }
}
interface Fila extends PresupuestoRow {
  pagado: number
  falta: number
  estado: 'Cubierto' | 'Parcial' | 'Pendiente'
}

// Hex explicito (no clases Tailwind) para todo lo que vive dentro de
// captureRef: html2canvas no soporta oklch()/lab(), que es como Tailwind v4
// resuelve el color de sus clases en el navegador -- usarlas ahi cuelga la
// captura de PDF/Imagen en silencio. Ver capture-export.ts.
const C = {
  white: '#ffffff', slate900: '#0f172a', slate800: '#1e293b', slate700: '#334155',
  slate600: '#475569', slate500: '#64748b', slate400: '#94a3b8', slate300: '#cbd5e1',
  slate200: '#e2e8f0', slate100: '#f1f5f9', slate50: '#f8fafc',
  emerald600: '#059669', emerald50: '#ecfdf5',
  amber600: '#d97706', amber50: '#fffbeb',
  rose600: '#e11d48', rose50: '#fff1f2',
  indigo600: '#4f46e5', indigo50: '#eef2ff',
  blue600: '#2563eb', blue50: '#eff6ff',
}

function estadoColor(estado: Fila['estado']) {
  if (estado === 'Cubierto') return C.emerald600
  if (estado === 'Parcial') return C.amber600
  return C.rose600
}
function estadoBg(estado: Fila['estado']) {
  if (estado === 'Cubierto') return C.emerald50
  if (estado === 'Parcial') return C.amber50
  return C.rose50
}

type ExportKind = 'pdf' | 'excel' | 'imagen' | 'csv'

export function ResumenPreview({ quincena, onBack }: { quincena: Quincena; onBack: () => void }) {
  const { toast } = useToast()
  const captureRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Fila[]>([])
  const [liquidezDisponible, setLiquidezDisponible] = useState<number | null>(null)
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [presupuestos, liqData]: [PresupuestoRow[], unknown[]] = await Promise.all([
          fetch(`/api/presupuestos?quincenaId=${quincena.id}`).then(r => r.json()),
          fetch(`/api/liquidez?quincenaId=${quincena.id}`).then(r => r.json()),
        ])
        if (cancelled) return
        setRows(presupuestos.map(p => {
          const pagado = p.real - p.pendiente
          const falta = calcularFaltaPorPagar([p])
          const estado: Fila['estado'] = falta <= 0 ? 'Cubierto' : pagado > 0 ? 'Parcial' : 'Pendiente'
          return { ...p, pagado, falta, estado }
        }))
        const raw = Array.isArray(liqData) && liqData.length > 0 ? liqData[0] : null
        setLiquidezDisponible(raw ? sumLiquidez(normalizeMontos(raw as Parameters<typeof normalizeMontos>[0])) : null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [quincena.id])

  // Los 4 totales de arriba son de la quincena completa (para que no cambien
  // segun lo que se muestre en la tabla), pero la tabla en si solo lista lo
  // que todavia no esta cubierto -- lo ya pagado al 100% no aporta nada a un
  // reporte que existe para ver que falta.
  const totalPresupuestado = rows.reduce((s, r) => s + Number(r.montoEfectivo), 0)
  const totalPagado = rows.reduce((s, r) => s + r.pagado, 0)
  const totalFalta = calcularFaltaPorPagar(rows)
  const filasPorCubrir = rows.filter(r => r.estado !== 'Cubierto')
  // El pie de la tabla suma solo lo que se ve en la tabla (lo pendiente), no
  // la quincena completa -- si no, no cuadraria con las filas visibles.
  const totalPresupuestadoPendiente = filasPorCubrir.reduce((s, r) => s + Number(r.montoEfectivo), 0)
  const totalPagadoPendiente = filasPorCubrir.reduce((s, r) => s + r.pagado, 0)
  const totalFaltaPendiente = calcularFaltaPorPagar(filasPorCubrir)

  async function handleExport(kind: ExportKind) {
    setExportingKind(kind)
    try {
      const base = `resumen-presupuesto-${quincena.codigo}-${getMexicoDateString()}`
      if (kind === 'imagen' && captureRef.current) {
        await downloadElementAsImage(captureRef.current, `${base}.png`)
      } else if (kind === 'pdf' && captureRef.current) {
        await downloadElementAsPdf(captureRef.current, `${base}.pdf`)
      } else if (kind === 'excel') {
        await downloadResumenExcel({
          quincena,
          liquidezDisponible,
          totalPresupuestado, totalPagado, totalFalta,
          totalPresupuestadoPendiente, totalPagadoPendiente, totalFaltaPendiente,
          rows: filasPorCubrir.map(r => ({
            categoria: r.categoria.nombre, descripcion: r.descripcion,
            presupuestado: Number(r.montoEfectivo), pagado: r.pagado, falta: r.falta, estado: r.estado,
          })),
        })
      } else if (kind === 'csv') {
        const csv = toCsv([
          ...filasPorCubrir,
          {
            id: -1, descripcion: 'TOTAL PENDIENTE', categoria: { nombre: '', tipo: '' },
            montoEfectivo: totalPresupuestadoPendiente, real: 0, pendiente: 0,
            pagado: totalPagadoPendiente, falta: totalFaltaPendiente, estado: 'Cubierto' as const,
          },
        ], [
          { key: 'categoria', label: 'Categoría', value: r => r.categoria.nombre },
          { key: 'descripcion', label: 'Descripción', value: r => r.descripcion },
          { key: 'presupuestado', label: 'Presupuestado', value: r => Number(r.montoEfectivo).toFixed(2) },
          { key: 'pagado', label: 'Pagado', value: r => r.pagado.toFixed(2) },
          { key: 'falta', label: 'Falta por pagar', value: r => r.falta.toFixed(2) },
          { key: 'estado', label: 'Estado', value: r => r.estado },
        ])
        downloadCsv(`${base}.csv`, csv)
      }
    } catch {
      toast('Error al generar el archivo', 'error')
    } finally {
      setExportingKind(null)
    }
  }

  if (loading) {
    return (
      <div className="py-16 flex justify-center items-center text-slate-400 dark:text-slate-500 text-sm gap-2">
        <Loader2 size={16} className="animate-spin" /> Cargando resumen...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
        <ArrowLeft size={14} /> Volver
      </button>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        {/* Colores en hex/inline a proposito en toda esta sub-arbol: html2canvas
            no entiende oklch()/lab(), que es como Tailwind v4 resuelve sus
            clases de color (text-slate-600, etc.) en getComputedStyle. Si se
            usan esas clases aqui, la captura para PDF/Imagen se cuelga en
            silencio. Ver capture-export.ts. */}
        <div ref={captureRef} className="p-5 space-y-4" style={{ width: 760, backgroundColor: C.white, color: C.slate800 }}>
          <div className="flex items-center gap-3 pb-3" style={{ borderBottom: `2px solid ${C.slate800}` }}>
            <img src="/icon-192.png" alt="Milo" className="h-9 w-9 rounded-lg" />
            <div>
              <p className="text-base font-bold tracking-tight" style={{ color: C.slate900 }}>Milo Gastos</p>
              <p className="text-xs font-medium" style={{ color: C.slate600 }}>Resumen de quincena · {quincena.codigo}</p>
            </div>
            <p className="ml-auto text-xs" style={{ color: C.slate500 }}>{formatQuincenaRange(quincena)}</p>
          </div>

          {/* Bloques de texto centrado, sin icono ni flexbox con gap a proposito:
              html2canvas duplica/desalinea el contenido cuando el layout usa
              `gap` de flex o elementos con fondo propio dentro de una fila --
              ya paso una vez con la version con icono. Este patron simple es
              el que ya se sabe que captura bien. */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: 'Liquidez disponible', value: liquidezDisponible },
              { label: 'Presupuestado', value: totalPresupuestado },
              { label: 'Pagado', value: totalPagado },
              { label: 'Falta por cubrir', value: totalFalta },
            ].map(k => (
              <div key={k.label} className="rounded-lg p-2.5 text-center" style={{ border: `1px solid ${C.slate300}` }}>
                <p className="text-[10px]" style={{ color: C.slate500 }}>{k.label}</p>
                <p className="text-sm font-bold tabular-nums" style={{ color: C.slate900 }}>{k.value != null ? formatMXN(k.value) : '—'}</p>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: C.slate400 }}>Sin presupuesto capturado para esta quincena.</p>
          ) : filasPorCubrir.length === 0 ? (
            <p className="text-sm font-medium" style={{ color: C.emerald600 }}>✓ Todo cubierto — no queda ninguna partida pendiente.</p>
          ) : (
            <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${C.slate300}` }}>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr style={{ backgroundColor: C.slate100, color: C.slate600 }}>
                    <th className="text-left py-1.5 px-2.5 font-semibold">Categoría</th>
                    <th className="text-left py-1.5 px-2.5 font-semibold">Descripción</th>
                    <th className="text-right py-1.5 px-2.5 font-semibold">Presup.</th>
                    <th className="text-right py-1.5 px-2.5 font-semibold">Pagado</th>
                    <th className="text-right py-1.5 px-2.5 font-semibold">Falta</th>
                    <th className="text-left py-1.5 px-2.5 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filasPorCubrir.map((r, i) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.slate200}`, backgroundColor: i % 2 === 1 ? C.slate50 : C.white }}>
                      <td className="py-1 px-2.5" style={{ color: C.slate700 }}>{r.categoria.nombre}</td>
                      <td className="py-1 px-2.5" style={{ color: C.slate700 }}>{r.descripcion}</td>
                      <td className="py-1 px-2.5 text-right tabular-nums" style={{ color: C.slate700 }}>{formatMXN(Number(r.montoEfectivo))}</td>
                      <td className="py-1 px-2.5 text-right tabular-nums" style={{ color: C.slate700 }}>{formatMXN(r.pagado)}</td>
                      <td className="py-1 px-2.5 text-right tabular-nums" style={{ color: C.slate700 }}>{formatMXN(r.falta)}</td>
                      <td className="py-1 px-2.5">
                        <span className="inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ color: estadoColor(r.estado), backgroundColor: estadoBg(r.estado) }}>
                          {r.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold" style={{ borderTop: `2px solid ${C.slate300}`, backgroundColor: C.slate50 }}>
                    <td className="py-1.5 px-2.5" style={{ color: C.slate800 }} colSpan={2}>TOTAL PENDIENTE</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums" style={{ color: C.slate800 }}>{formatMXN(totalPresupuestadoPendiente)}</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums" style={{ color: C.slate800 }}>{formatMXN(totalPagadoPendiente)}</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums" style={{ color: C.slate800 }}>{formatMXN(totalFaltaPendiente)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-[9px] text-center pt-1.5" style={{ color: C.slate400, borderTop: `1px solid ${C.slate200}` }}>
            Documento generado automáticamente por Milo Gastos
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button onClick={() => handleExport('pdf')} disabled={exportingKind !== null}
          className="flex items-center justify-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
          <FileDown size={14} /> {exportingKind === 'pdf' ? '...' : 'PDF'}
        </button>
        <button onClick={() => handleExport('excel')} disabled={exportingKind !== null}
          className="flex items-center justify-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
          <FileSpreadsheet size={14} /> {exportingKind === 'excel' ? '...' : 'Excel'}
        </button>
        <button onClick={() => handleExport('imagen')} disabled={exportingKind !== null}
          className="flex items-center justify-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
          <ImageIcon size={14} /> {exportingKind === 'imagen' ? '...' : 'Imagen'}
        </button>
        <button onClick={() => handleExport('csv')} disabled={exportingKind !== null}
          className="flex items-center justify-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
          <FileText size={14} /> {exportingKind === 'csv' ? '...' : 'CSV'}
        </button>
      </div>
    </div>
  )
}
