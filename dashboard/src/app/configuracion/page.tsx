import { Droplets, Tag, Users, Zap, ClipboardList, CalendarRange } from 'lucide-react'

const sections = [
  {
    href: '/configuracion/quincenas',
    title: 'Períodos de pago',
    description: 'Agrega, edita o corrige las fechas de cada quincena y la frecuencia de pago predeterminada.',
    icon: CalendarRange,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
  },
  {
    href: '/configuracion/liquidez',
    title: 'Liquidez',
    description: 'Snapshots de caja por quincena. Registra el estado de tus cuentas y vales.',
    icon: Droplets,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    href: '/configuracion/entradas-rapidas',
    title: 'Conceptos Recurrentes',
    description: 'Gastos e ingresos frecuentes que se repiten cada quincena.',
    icon: Zap,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    href: '/configuracion/categorias',
    title: 'Categorías',
    description: 'Las 9 categorías oficiales del sistema. Editar clasificación y ejemplos.',
    icon: Tag,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    href: '/configuracion/usuarios',
    title: 'Usuarios',
    description: 'Administrar usuarios del sistema, teléfonos WhatsApp y estado.',
    icon: Users,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    href: '/configuracion/audit-log',
    title: 'Audit Log',
    description: 'Historial de cambios en el sistema. Quién hizo qué y cuándo.',
    icon: ClipboardList,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
  },
]

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Configuración</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Administra los catálogos y datos del sistema</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map(s => (
          <a
            key={s.href}
            href={s.href}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 hover:border-indigo-300 hover:shadow-md transition-all group"
          >
            <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
              <s.icon size={22} className={s.color} />
            </div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg mb-1">{s.title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{s.description}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
