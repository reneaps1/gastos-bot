'use client'
import { useState } from 'react'
import Link from 'next/link'
import { FileText, Printer, ListChecks } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import { useToast } from '@/components/Toast'
import { toCsv, downloadCsv } from '@/lib/csv'
import { calcularFaltaPorPagar } from '@/lib/presupuesto-totales'
import { getMexicoDateString } from '@/lib/quincena-selection'

interface PresupuestoRow {
  descripcion: string
  montoPresupuestado: number | string
  real: number
  pendiente: number
  categoria: { nombre: string; tipo: string }
}

function optionCardClass() {
  return 'flex items-start gap-3 w-full text-left border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
}

export function ReporteButton({ quincenaId, quincenaCodigo }: { quincenaId: number; quincenaCodigo: string }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [descargando, setDescargando] = useState(false)

  async function handleResumido() {
    setDescargando(true)
    try {
      const presupuestos: PresupuestoRow[] = await fetch(`/api/presupuestos?quincenaId=${quincenaId}`).then(r => r.json())

      const rows = presupuestos.map(p => {
        const pagado = p.real - p.pendiente
        const falta = calcularFaltaPorPagar([p])
        return { ...p, pagado, falta }
      })

      const csv = toCsv([
        ...rows,
        {
          descripcion: 'TOTAL', categoria: { nombre: '', tipo: '' },
          montoPresupuestado: rows.reduce((s, r) => s + Number(r.montoPresupuestado), 0),
          real: 0,
          pendiente: 0,
          pagado: rows.reduce((s, r) => s + r.pagado, 0),
          falta: rows.reduce((s, r) => s + r.falta, 0),
        },
      ], [
        { key: 'categoria', label: 'Categoría', value: r => r.categoria.nombre },
        { key: 'descripcion', label: 'Descripción', value: r => r.descripcion },
        { key: 'presupuestado', label: 'Presupuestado', value: r => Number(r.montoPresupuestado).toFixed(2) },
        { key: 'pagado', label: 'Pagado', value: r => r.pagado.toFixed(2) },
        { key: 'falta', label: 'Falta por pagar', value: r => r.falta.toFixed(2) },
        { key: 'estado', label: 'Estado', value: r => r.falta <= 0 ? 'Cubierto' : r.pagado > 0 ? 'Parcial' : 'Pendiente' },
      ])
      downloadCsv(`resumen-presupuesto-${quincenaCodigo}-${getMexicoDateString()}.csv`, csv)
      setOpen(false)
    } catch {
      toast('Error al generar el resumen', 'error')
    } finally {
      setDescargando(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer transition-colors">
        <FileText size={14} /> Reporte
      </button>

      <FormModal open={open} onOpenChange={setOpen} title="Descargar reporte">
        <div className="space-y-3">
          <Link href={`/quincena/${quincenaCodigo}/reporte`} onClick={() => setOpen(false)} className={optionCardClass()}>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center shrink-0">
              <Printer size={18} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Detallado</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Reporte completo con gráficas, presupuesto por categoría y todas las transacciones — imprimible o exportable a Excel.</p>
            </div>
          </Link>

          <button onClick={handleResumido} disabled={descargando} className={optionCardClass()}>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center shrink-0">
              <ListChecks size={18} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{descargando ? 'Generando...' : 'Resumido'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Una lista rápida por partida de presupuesto: qué está pagado y qué falta. Se descarga como CSV.</p>
            </div>
          </button>
        </div>
      </FormModal>
    </>
  )
}
