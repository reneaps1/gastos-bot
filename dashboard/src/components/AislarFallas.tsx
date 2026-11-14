'use client'
import { Component, type ReactNode } from 'react'

// Aisla un widget global (montado en Providers.tsx, presente en TODAS las
// paginas) para que una falla suya no tumbe el dashboard entero. Sin esto, un
// error en el chat de Milo dejaba cualquier pagina, incluso /login, en la
// pantalla "This page couldn't load" (2026-11-14). Con esto, el widget
// desaparece y el resto sigue funcionando; el error queda en la consola.
export class AislarFallas extends Component<{ nombre: string; children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError() {
    return { fallo: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`WIDGET_FALLO ${this.props.nombre}:`, error)
  }

  render() {
    return this.state.fallo ? null : this.props.children
  }
}
