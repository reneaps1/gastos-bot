'use client'
import { useCallback, useState } from 'react'

type Operator = '+' | '-' | '×' | '÷'

interface CalculatorState {
  display: string
  // Linea superior con la operacion en curso/ultima (ej. "12 +" mientras se
  // captura el segundo numero, "12 + 8 =" tras el resultado) -- igual que la
  // calculadora del iPhone, para que se vea que se fue tecleando.
  expression: string
  previousValue: number | null
  operator: Operator | null
  // Tras un operador o "=", el siguiente digito reemplaza la pantalla en vez
  // de concatenarse -- sin esto "5 + 3" se leeria "53" al teclear el 3.
  overwrite: boolean
  error: boolean
}

const INITIAL: CalculatorState = {
  display: '0', expression: '', previousValue: null, operator: null, overwrite: true, error: false,
}

// Redondea antes de mostrar para evitar artefactos de punto flotante
// (0.1 + 0.2 -> "0.30000000000000004").
function formatNumber(n: number): string {
  if (!isFinite(n)) return 'Error'
  return String(Math.round(n * 1e10) / 1e10)
}

function compute(a: number, b: number, op: Operator): number | null {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '×': return a * b
    case '÷': return b === 0 ? null : a / b
  }
}

export function useCalculator() {
  const [state, setState] = useState<CalculatorState>(INITIAL)

  const inputDigit = useCallback((digit: string) => {
    setState(s => {
      if (s.error) return { ...INITIAL, display: digit === '.' ? '0.' : digit, overwrite: false }
      if (s.overwrite) {
        // Si no hay operacion pendiente (recien se calculo un "=" o se limpio),
        // el siguiente digito arranca una cuenta nueva -- se borra el historial.
        const startingFresh = s.previousValue == null && s.operator == null
        return { ...s, display: digit === '.' ? '0.' : digit, overwrite: false, expression: startingFresh ? '' : s.expression }
      }
      if (digit === '.' && s.display.includes('.')) return s
      if (s.display === '0') return { ...s, display: digit }
      return { ...s, display: s.display + digit }
    })
  }, [])

  const backspace = useCallback(() => {
    setState(s => {
      if (s.error || s.overwrite) return s
      const next = s.display.length > 1 ? s.display.slice(0, -1) : '0'
      return { ...s, display: next }
    })
  }, [])

  const clear = useCallback(() => setState(INITIAL), [])

  const percent = useCallback(() => {
    setState(s => {
      if (s.error) return s
      return { ...s, display: formatNumber(parseFloat(s.display) / 100), overwrite: true }
    })
  }, [])

  const operate = useCallback((nextOp: Operator) => {
    setState(s => {
      if (s.error) return s
      const current = parseFloat(s.display)
      if (s.previousValue == null) {
        return { ...s, previousValue: current, operator: nextOp, overwrite: true, expression: `${formatNumber(current)} ${nextOp}` }
      }
      if (s.overwrite) {
        // Cambio de operador sin haber capturado un numero nuevo -- solo se
        // actualiza el operador pendiente (ej. "5 +" -> "5 -").
        return { ...s, operator: nextOp, expression: `${formatNumber(s.previousValue)} ${nextOp}` }
      }
      const result = s.operator ? compute(s.previousValue, current, s.operator) : current
      if (result === null) return { ...INITIAL, display: 'Error', error: true }
      return {
        previousValue: result, operator: nextOp, overwrite: true, error: false,
        display: formatNumber(result), expression: `${formatNumber(result)} ${nextOp}`,
      }
    })
  }, [])

  const equals = useCallback(() => {
    setState(s => {
      if (s.error || s.operator == null || s.previousValue == null) return s
      const current = parseFloat(s.display)
      const result = compute(s.previousValue, current, s.operator)
      if (result === null) return { ...INITIAL, display: 'Error', error: true }
      return {
        display: formatNumber(result),
        expression: `${formatNumber(s.previousValue)} ${s.operator} ${formatNumber(current)} =`,
        previousValue: null, operator: null, overwrite: true, error: false,
      }
    })
  }, [])

  return {
    display: state.display,
    expression: state.expression,
    error: state.error,
    inputDigit,
    operate,
    percent,
    equals,
    clear,
    backspace,
  }
}
