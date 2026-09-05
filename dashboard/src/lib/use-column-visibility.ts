'use client'
import { useCallback, useEffect, useState } from 'react'

// Persiste que columnas opcionales de una tabla estan visibles, por tabla
// (storageKey distinto por tabla). Arranca con defaultVisible (mismo shape
// en servidor y cliente) y solo aplica lo guardado en localStorage despues
// del mount -- mismo patron que ThemeProvider, evita mismatch de hidratacion.
export function useColumnVisibility(storageKey: string, defaultVisible: string[]) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(defaultVisible))

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return
    try {
      const parsed: unknown = JSON.parse(stored)
      if (Array.isArray(parsed)) setVisible(new Set(parsed))
    } catch { /* localStorage corrupto o de otra version -- se ignora, queda el default */ }
  }, [storageKey])

  const toggle = useCallback((key: string) => {
    setVisible(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      window.localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }, [storageKey])

  return { visible, toggle }
}
