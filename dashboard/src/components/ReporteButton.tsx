'use client'
import { useState } from 'react'
import Link from 'next/link'
import { FileText, Printer, ListChecks } from 'lucide-react'
import { FormModal } from '@/components/ui/FormModal'
import { ResumenPreview } from '@/components/ResumenPreview'

export function ReporteButton({ quincenaId, quincenaCodigo, fechaInicio, fechaFin }: {
  quincenaId: number; quincenaCodigo: string; fechaInicio: string; fechaFin: string
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'menu' | 'resumen'>('menu')

  function close() {
    setOpen(false)
    setTimeout(() => setStep('menu'), 200) // evita el flash del menu al cerrar
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 rounded-lg cursor-pointer transition-colors">
        <FileText size={14} /> Reporte
      </button>

      <FormModal open={open} onOpenChange={v => v ? setOpen(true) : close()} title={step === 'menu' ? 'Descargar reporte' : 'Resumen de quincena'}
        maxWidthClass={step === 'menu' ? 'max-w-lg' : 'max-w-2xl'}>
        {step === 'menu' ? (
          <div className="space-y-3">
            <Link href={`/quincena/${quincenaCodigo}/reporte`} onClick={close} className="flex items-start gap-3 w-full text-left border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center shrink-0">
                <Printer size={18} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Detallado</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Reporte completo con gráficas, presupuesto por categoría y todas las transacciones — imprimible o exportable a Excel.</p>
              </div>
            </Link>

            <button onClick={() => setStep('resumen')} className="flex items-start gap-3 w-full text-left border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center shrink-0">
                <ListChecks size={18} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Resumido</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Vista previa de una página: liquidez, qué está pagado y qué falta. Descargable en PDF, Excel, imagen o CSV.</p>
              </div>
            </button>
          </div>
        ) : (
          <ResumenPreview
            quincena={{ id: quincenaId, codigo: quincenaCodigo, fechaInicio, fechaFin }}
            onBack={() => setStep('menu')}
          />
        )}
      </FormModal>
    </>
  )
}
