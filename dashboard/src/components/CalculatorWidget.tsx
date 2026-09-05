'use client'
import { useEffect, useRef, useState } from 'react'
import { Calculator, Copy, X } from 'lucide-react'
import { useCalculator } from '@/lib/use-calculator'
import { useToast } from './Toast'

type Variant = 'default' | 'operator' | 'muted' | 'primary'

const VARIANT_CLASS: Record<Variant, string> = {
  default: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600',
  operator: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
  muted: 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700',
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
}

function CalcButton({ label, onClick, variant = 'default', className = '' }: {
  label: string; onClick: () => void; variant?: Variant; className?: string
}) {
  return (
    <button onClick={onClick}
      className={`h-9 rounded-lg text-sm font-medium cursor-pointer transition-colors ${VARIANT_CLASS[variant]} ${className}`}>
      {label}
    </button>
  )
}

// Widget global de calculadora, montado una sola vez en Providers.tsx (ver ahi
// el porque) para que sobreviva a la navegacion entre paginas. Solo escritorio
// -- en movil no hay espacio para un panel anclado al lateral.
export function CalculatorWidget() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const { display, error, inputDigit, operate, percent, equals, clear, backspace } = useCalculator()

  // Recuerda el ultimo input numerico enfocado en CUALQUIER parte de la app
  // (incluyendo dentro de un FormModal abierto) para que "Usar aqui" sepa
  // donde escribir. Ignora el foco dentro del propio panel para no perder la
  // referencia al hacer clic en los botones de la calculadora.
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const target = e.target
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return
      if (panelRef.current?.contains(target)) return
      lastInputRef.current = target
    }
    window.addEventListener('focusin', onFocusIn)
    return () => window.removeEventListener('focusin', onFocusIn)
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(display)
      .then(() => toast('Copiado al portapapeles'))
      .catch(() => toast('No se pudo copiar', 'error'))
  }

  function handleInsert() {
    const el = lastInputRef.current
    if (!el || !document.contains(el)) {
      toast('Ningún campo activo -- copia el valor y pégalo', 'error')
      return
    }
    // input.value = x NO dispara el onChange de React (React trackea el
    // valor por dentro) -- hay que pasar por el setter nativo y despachar el
    // evento a mano para que el input controlado se entere del cambio.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, display)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  return (
    <div className="hidden md:block">
      <button onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Cerrar calculadora' : 'Abrir calculadora'}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-[60] flex items-center justify-center w-9 h-14 rounded-l-xl border border-r-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 shadow-lg hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer transition-colors">
        <Calculator size={18} />
      </button>

      {open && (
        <div ref={panelRef}
          className="fixed right-9 top-1/2 -translate-y-1/2 z-[60] w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-l-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Calculadora</span>
            <button onClick={() => setOpen(false)} aria-label="Cerrar"
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
              <X size={16} />
            </button>
          </div>

          <div className="px-4 pt-3 pb-2">
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-3 text-right overflow-hidden">
              <span className={`text-2xl font-semibold tabular-nums break-all ${error ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {display}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 px-4 pb-3">
            <CalcButton label="C" onClick={clear} variant="muted" />
            <CalcButton label="⌫" onClick={backspace} variant="muted" />
            <CalcButton label="%" onClick={percent} variant="muted" />
            <CalcButton label="÷" onClick={() => operate('÷')} variant="operator" />

            <CalcButton label="7" onClick={() => inputDigit('7')} />
            <CalcButton label="8" onClick={() => inputDigit('8')} />
            <CalcButton label="9" onClick={() => inputDigit('9')} />
            <CalcButton label="×" onClick={() => operate('×')} variant="operator" />

            <CalcButton label="4" onClick={() => inputDigit('4')} />
            <CalcButton label="5" onClick={() => inputDigit('5')} />
            <CalcButton label="6" onClick={() => inputDigit('6')} />
            <CalcButton label="−" onClick={() => operate('-')} variant="operator" />

            <CalcButton label="1" onClick={() => inputDigit('1')} />
            <CalcButton label="2" onClick={() => inputDigit('2')} />
            <CalcButton label="3" onClick={() => inputDigit('3')} />
            <CalcButton label="+" onClick={() => operate('+')} variant="operator" />

            <CalcButton label="0" onClick={() => inputDigit('0')} className="col-span-2" />
            <CalcButton label="." onClick={() => inputDigit('.')} />
            <CalcButton label="=" onClick={equals} variant="primary" />
          </div>

          <div className="flex gap-2 px-4 pb-4">
            <button onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors">
              <Copy size={13} /> Copiar
            </button>
            <button onClick={handleInsert}
              className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer transition-colors">
              Usar aquí
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
