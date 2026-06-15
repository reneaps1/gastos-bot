'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, Settings, Sun, Moon } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/transacciones', label: 'Transacciones' },
  { href: '/presupuesto', label: 'Presupuesto' },
  { href: '/deudas', label: 'Deudas' },
  { href: '/creditos', label: 'Créditos' },
]

const configLinks = [
  { href: '/configuracion/liquidez', label: 'Liquidez' },
  { href: '/configuracion/entradas-rapidas', label: 'Conceptos Recurrentes' },
  { href: '/configuracion/categorias', label: 'Categorías' },
  { href: '/configuracion/usuarios', label: 'Usuarios' },
  { href: '/configuracion/audit-log', label: 'Audit Log' },
  { href: '/admin/categorias', label: 'Admin Categorías' },
]

export function NavBar() {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const isConfigActive = pathname.startsWith('/configuracion')

  return (
    <>
      <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
        {links.map(l => (
          <a key={l.href} href={l.href}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              isActive(l.href)
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            {l.label}
          </a>
        ))}

        <div className="relative">
          <button onClick={() => setConfigOpen(v => !v)}
            onBlur={() => setTimeout(() => setConfigOpen(false), 150)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              isConfigActive
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            <Settings size={14} />
            Configuración
          </button>
          {configOpen && (
            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 min-w-[180px] z-50">
              {configLinks.map(l => (
                <a key={l.href} href={l.href}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    isActive(l.href)
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}>
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <button onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </nav>

      <div className="flex items-center gap-2 md:hidden">
        <button onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          onClick={() => setOpen(v => !v)} aria-label="Abrir menú">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20 bg-black/20 dark:bg-black/50" onClick={() => setOpen(false)} />
          <div className="fixed top-[57px] left-0 right-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-lg md:hidden">
            <nav className="flex flex-col p-3 gap-1">
              {links.map(l => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(l.href)
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}>
                  {l.label}
                </a>
              ))}
              <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
              <a href="/configuracion" onClick={() => setOpen(false)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  isConfigActive
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}>
                <Settings size={14} />
                Configuración
              </a>
            </nav>
          </div>
        </>
      )}
    </>
  )
}
