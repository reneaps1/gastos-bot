'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, Settings } from 'lucide-react'

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/transacciones', label: 'Transacciones' },
  { href: '/presupuesto', label: 'Presupuesto' },
  { href: '/deudas', label: 'Deudas' },
]

const configLinks = [
  { href: '/configuracion/liquidez', label: 'Liquidez' },
  { href: '/configuracion/categorias', label: 'Categorías' },
  { href: '/configuracion/usuarios', label: 'Usuarios' },
]

export function NavBar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const isConfigActive = pathname.startsWith('/configuracion')

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
        {links.map(l => (
          <a
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              isActive(l.href)
                ? 'text-indigo-600 bg-indigo-50 font-semibold'
                : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
            }`}
          >
            {l.label}
          </a>
        ))}

        {/* Configuración dropdown */}
        <div className="relative">
          <button
            onClick={() => setConfigOpen(v => !v)}
            onBlur={() => setTimeout(() => setConfigOpen(false), 150)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              isConfigActive
                ? 'text-indigo-600 bg-indigo-50 font-semibold'
                : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
            }`}
          >
            <Settings size={14} />
            Configuración
          </button>
          {configOpen && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px] z-50">
              {configLinks.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    isActive(l.href)
                      ? 'text-indigo-600 bg-indigo-50 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Mobile hamburger */}
      <button
        className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
        onClick={() => setOpen(v => !v)}
        aria-label="Abrir menú"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-20 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="fixed top-[57px] left-0 right-0 z-30 bg-white border-b border-slate-200 shadow-lg md:hidden">
            <nav className="flex flex-col p-3 gap-1">
              {links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(l.href)
                      ? 'text-indigo-600 bg-indigo-50 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l.label}
                </a>
              ))}
              <div className="border-t border-slate-100 my-1" />
              <a
                href="/configuracion"
                onClick={() => setOpen(false)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  isConfigActive
                    ? 'text-indigo-600 bg-indigo-50 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
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
