'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/transacciones', label: 'Transacciones' },
  { href: '/presupuesto', label: 'Presupuesto' },
  { href: '/deudas', label: 'Deudas' },
]

export function NavBar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden md:flex gap-1 text-sm font-medium">
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
            </nav>
          </div>
        </>
      )}
    </>
  )
}
