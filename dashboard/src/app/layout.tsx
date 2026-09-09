import type { Metadata, Viewport } from 'next'
import Image from 'next/image'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { Providers } from '@/components/Providers'
import { ReconciliationBanner } from '@/components/ReconciliationBanner'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Milo Gastos',
  description: 'Control de gastos familiar',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'Milo Gastos',
    statusBarStyle: 'black-translucent',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('theme')}catch(e){}if(t!=='light'&&t!=='dark'&&t!=='github-dark')t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';var r=document.documentElement;r.classList.toggle('dark',t!=='light');r.dataset.theme=t;r.style.colorScheme=t==='light'?'light':'dark'})()` }} />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
        <Providers>
          <header className="print:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 md:px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg shadow-sm" priority />
              <span className="text-xl font-bold text-slate-800 dark:text-slate-100">Milo Gastos</span>
            </div>
            <NavBar />
          </header>
          <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6 max-w-7xl mx-auto w-full">
            <ReconciliationBanner />
            {children}
          </main>
          <footer className="print:hidden text-center py-4 text-xs text-slate-400 dark:text-slate-600">
            <a href="/privacy" className="hover:text-slate-600 dark:hover:text-slate-400 transition-colors">
              Politica de Privacidad
            </a>
          </footer>
        </Providers>
      </body>
    </html>
  )
}
