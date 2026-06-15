'use client'
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  loading?: boolean
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Eliminar', onConfirm, loading,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-sm"
          aria-describedby="confirm-desc"
        >
          <Dialog.Title className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
            {title}
          </Dialog.Title>
          <Dialog.Description id="confirm-desc" className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            {description}
          </Dialog.Description>
          <div className="flex gap-3 justify-end">
            <Dialog.Close disabled={loading}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer transition-colors">
              Cancelar
            </Dialog.Close>
            <button onClick={onConfirm} disabled={loading}
              className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-60 cursor-pointer min-w-[90px] transition-colors">
              {loading ? 'Eliminando...' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
