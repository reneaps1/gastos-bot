import type { Metadata } from 'next'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'Milo Gastos',
  description: 'Control de gastos familiar',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-50">
        <Providers>
          <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💰</span>
              <span className="text-xl font-bold text-slate-800">Milo Gastos</span>
            </div>
            <NavBar />
          </header>
          <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
