import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Milo Gastos',
  description: 'Control de gastos familiar',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💰</span>
            <span className="text-xl font-bold text-slate-800">Milo Gastos</span>
          </div>
          <nav className="flex gap-6 text-sm font-medium text-slate-500">
            <a href="/" className="hover:text-indigo-600 transition-colors">Dashboard</a>
            <a href="/transacciones" className="hover:text-indigo-600 transition-colors">Transacciones</a>
            <a href="/presupuesto" className="hover:text-indigo-600 transition-colors">Presupuesto</a>
            <a href="/deudas" className="hover:text-indigo-600 transition-colors">Deudas</a>
          </nav>
        </header>
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </body>
    </html>
  )
}
