'use client'
import { useEffect } from 'react'
import type { RefObject } from 'react'

// Intercepta Ctrl/Cmd+F para enfocar el campo de busqueda de la pagina en vez
// de abrir el buscador nativo del navegador. Si hay varios inputs de busqueda
// activos (ej. dos tablas en la misma vista), solo actua el que este visible
// (offsetParent !== null); si ninguno esta visible no hace nada.
export function useSearchShortcut(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return
      const el = inputRef.current
      if (!el || el.offsetParent === null) return
      e.preventDefault()
      el.focus()
      el.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef])
}
