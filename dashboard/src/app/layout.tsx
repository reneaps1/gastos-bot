import type { Metadata } from 'next'
import Image from 'next/image'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'Milo Gastos',
  description: 'Control de gastos familiar',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'Milo Gastos',
    statusBarStyle: 'default',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.theme==='dark'||(!('theme' in localStorage)&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}` }} />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
        <Providers>
          <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 md:px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <Image src="/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg shadow-sm" priority />
              <span className="text-xl font-bold text-slate-800 dark:text-slate-100">Milo Gastos</span>
            </div>
            <NavBar />
          </header>
          <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6 max-w-7xl mx-auto w-full">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
