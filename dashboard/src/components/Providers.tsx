'use client'
import { ToastProvider } from './Toast'
import { ThemeProvider } from './ThemeProvider'
import { CalculatorWidget } from './CalculatorWidget'
import { MiloChat } from './MiloChat'
import { AislarFallas } from './AislarFallas'

// Los widgets globales van aislados: estan en TODAS las paginas, asi que una
// falla suya no debe tumbar el dashboard (ver AislarFallas).
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {children}
        <AislarFallas nombre="calculadora">
          <CalculatorWidget />
        </AislarFallas>
        <AislarFallas nombre="milo-chat">
          <MiloChat />
        </AislarFallas>
      </ToastProvider>
    </ThemeProvider>
  )
}
