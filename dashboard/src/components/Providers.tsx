'use client'
import { ToastProvider } from './Toast'
import { ThemeProvider } from './ThemeProvider'
import { CalculatorWidget } from './CalculatorWidget'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {children}
        <CalculatorWidget />
      </ToastProvider>
    </ThemeProvider>
  )
}
