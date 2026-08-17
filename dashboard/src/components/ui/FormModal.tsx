'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  /** Ancho maximo del modal. Default `max-w-lg` (formularios); usar uno mayor
   *  para contenido tabular, como el detalle de gasto de una partida. */
  maxWidthClass?: string
  /** Contenido opcional bajo el titulo, dentro del encabezado sticky. */
  subtitle?: React.ReactNode
}

export function FormModal({ open, onOpenChange, title, children, maxWidthClass = 'max-w-lg', subtitle }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40" />
        <Dialog.Content
          className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto`}
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-2xl z-10">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {title}
              </Dialog.Title>
              {subtitle}
            </div>
            <Dialog.Close className="shrink-0 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="p-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
