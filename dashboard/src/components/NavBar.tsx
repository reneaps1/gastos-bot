'use client'
import { usePathname, useRouter } from 'next/navigation'
import { Settings, Sun, Moon, LayoutDashboard, ArrowLeftRight, Target, AlertCircle, Landmark, PiggyBank, LogOut } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transacciones', label: 'Transacciones', icon: ArrowLeftRight },
  { href: '/presupuesto', label: 'Presupuesto', icon: Target },
  { href: '/ahorro', label: 'Ahorro', icon: PiggyBank },
  { href: '/deudas', label: 'Deudas', icon: AlertCircle },
  { href: '/creditos', label: 'Créditos', icon: Landmark },
]

const configLinks = [
  { href: '/configuracion/quincenas', label: 'Períodos de pago' },
  { href: '/configuracion/liquidez', label: 'Liquidez' },
  { href: '/configuracion/categorias', label: 'Categorías' },
  { href: '/configuracion/usuarios', label: 'Usuarios' },
  { href: '/configuracion/audit-log', label: 'Audit Log' },
  { href: '/admin/categorias', label: 'Admin Categorías' },
  { href: '/configuracion/cuenta', label: 'Mi cuenta' },
]

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  if (pathname === '/login') return null

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  const isConfigActive = pathname.startsWith('/configuracion')

  return (
    <>
      {/* ── Desktop nav ── */}
      <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
        {links.map(l => (
          <a key={l.href} href={l.href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
              isActive(l.href)
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            <l.icon size={15} />
            {l.label}
          </a>
        ))}

        <div className="relative group">
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              isConfigActive
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}>
            <Settings size={14} />
            Configuración
          </button>
          <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 min-w-[180px] z-50 hidden group-hover:block">
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
        </div>

        <button onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button onClick={handleLogout}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 cursor-pointer transition-colors"
          aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={16} />
        </button>
      </nav>

      {/* ── Mobile header actions ── */}
      <div className="flex items-center gap-1 md:hidden">
        <button onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button onClick={handleLogout}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 cursor-pointer transition-colors"
          aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={18} />
        </button>
        <a href="/configuracion"
          className={`p-2 rounded-lg transition-colors ${
            isConfigActive
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          aria-label="Configuración">
          <Settings size={18} />
        </a>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="print:hidden fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[0_-1px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_-1px_12px_rgba(0,0,0,0.3)]">
        <div className="flex items-stretch justify-around"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
          {links.map(l => {
            const active = isActive(l.href)
            return (
              <a key={l.href} href={l.href}
                aria-label={l.label}
                className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 pt-2 pb-3 min-h-[56px] transition-colors ${
                  active
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                }`}>
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />
                )}
                <l.icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                <span className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                  {l.label}
                </span>
              </a>
            )
          })}
        </div>
      </nav>
    </>
  )
}
