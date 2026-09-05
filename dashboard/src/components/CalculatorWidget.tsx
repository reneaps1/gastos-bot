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

// Id "canonico" de cada tecla/boton (independiente del label que se muestra),
// para poder resaltar el boton correcto sin importar si vino de un clic o del
// atajo de teclado -- ver CalculatorWidget.
type KeyId = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | '×' | '÷' | '=' | 'C' | '⌫' | '%'

function CalcButton({ id, label, onClick, activeId, variant = 'default', className = '' }: {
  id: KeyId; label: string; onClick: () => void; activeId: KeyId | null; variant?: Variant; className?: string
}) {
  const pressed = activeId === id
  return (
    <button onClick={onClick}
      className={`h-9 rounded-lg text-sm font-medium cursor-pointer transition-all active:scale-95 ${VARIANT_CLASS[variant]} ${
        pressed ? 'ring-2 ring-indigo-400 dark:ring-indigo-500 scale-95' : ''
      } ${className}`}>
      {label}
    </button>
  )
}

// Widget global de calculadora, montado una sola vez en Providers.tsx (ver ahi
// el porque) para que sobreviva a la navegacion entre paginas. Solo escritorio
// -- en movil no hay espacio para un panel anclado al lateral.
export function CalculatorWidget() {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<KeyId | null>(null)
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const { display, expression, error, inputDigit, operate, percent, equals, clear, backspace } = useCalculator()

  // Resalta brevemente el boton correspondiente -- asi se ve que tecla se
  // registro tambien cuando se usa el teclado, no solo al hacer clic.
  function flash(id: KeyId) {
    if (flashTimeout.current) clearTimeout(flashTimeout.current)
    setActiveId(id)
    flashTimeout.current = setTimeout(() => setActiveId(null), 150)
  }

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

  // Soporte de teclado clasico de calculadora, solo mientras el panel esta
  // abierto. Si el foco esta en un campo editable (ej. escribiendo en Monto
  // con el panel abierto encima), se deja pasar sin tocar -- de lo contrario
  // "5" en el campo tambien le pegaria a la calculadora.
  useEffect(() => {
    if (!open) return
    function isEditing(el: Element | null) {
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isEditing(document.activeElement)) return
      const key = e.key
      if (key >= '0' && key <= '9') { e.preventDefault(); flash(key as KeyId); inputDigit(key); return }
      if (key === '.' || key === ',') { e.preventDefault(); flash('.'); inputDigit('.'); return }
      if (key === '+') { e.preventDefault(); flash('+'); operate('+'); return }
      if (key === '-') { e.preventDefault(); flash('-'); operate('-'); return }
      if (key === '*' || key.toLowerCase() === 'x') { e.preventDefault(); flash('×'); operate('×'); return }
      if (key === '/') { e.preventDefault(); flash('÷'); operate('÷'); return }
      if (key === '%') { e.preventDefault(); flash('%'); percent(); return }
      if (key === 'Enter' || key === '=') { e.preventDefault(); flash('='); equals(); return }
      if (key === 'Backspace') { e.preventDefault(); flash('⌫'); backspace(); return }
      if (key.toLowerCase() === 'c') { e.preventDefault(); flash('C'); clear(); return }
      if (key === 'Escape') { e.preventDefault(); setOpen(false); return }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, inputDigit, operate, percent, equals, clear, backspace])

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
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-right overflow-hidden min-h-[68px] flex flex-col justify-end">
              <span className="h-4 text-xs text-slate-400 dark:text-slate-500 tabular-nums truncate">
                {expression || ' '}
              </span>
              <span className={`text-2xl font-semibold tabular-nums break-all ${error ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {display}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 px-4 pb-3">
            <CalcButton id="C" label="C" onClick={clear} activeId={activeId} variant="muted" />
            <CalcButton id="⌫" label="⌫" onClick={backspace} activeId={activeId} variant="muted" />
            <CalcButton id="%" label="%" onClick={percent} activeId={activeId} variant="muted" />
            <CalcButton id="÷" label="÷" onClick={() => operate('÷')} activeId={activeId} variant="operator" />

            <CalcButton id="7" label="7" onClick={() => inputDigit('7')} activeId={activeId} />
            <CalcButton id="8" label="8" onClick={() => inputDigit('8')} activeId={activeId} />
            <CalcButton id="9" label="9" onClick={() => inputDigit('9')} activeId={activeId} />
            <CalcButton id="×" label="×" onClick={() => operate('×')} activeId={activeId} variant="operator" />

            <CalcButton id="4" label="4" onClick={() => inputDigit('4')} activeId={activeId} />
            <CalcButton id="5" label="5" onClick={() => inputDigit('5')} activeId={activeId} />
            <CalcButton id="6" label="6" onClick={() => inputDigit('6')} activeId={activeId} />
            <CalcButton id="-" label="−" onClick={() => operate('-')} activeId={activeId} variant="operator" />

            <CalcButton id="1" label="1" onClick={() => inputDigit('1')} activeId={activeId} />
            <CalcButton id="2" label="2" onClick={() => inputDigit('2')} activeId={activeId} />
            <CalcButton id="3" label="3" onClick={() => inputDigit('3')} activeId={activeId} />
            <CalcButton id="+" label="+" onClick={() => operate('+')} activeId={activeId} variant="operator" />

            <CalcButton id="0" label="0" onClick={() => inputDigit('0')} activeId={activeId} className="col-span-2" />
            <CalcButton id="." label="." onClick={() => inputDigit('.')} activeId={activeId} />
            <CalcButton id="=" label="=" onClick={equals} activeId={activeId} variant="primary" />
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
