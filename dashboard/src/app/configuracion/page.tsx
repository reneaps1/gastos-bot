import { Droplets, Tag, Users } from 'lucide-react'

const sections = [
  {
    href: '/configuracion/liquidez',
    title: 'Liquidez',
    description: 'Snapshots de caja por quincena. Registra el estado de tus cuentas y vales.',
    icon: Droplets,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
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
]

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Configuración</h2>
        <p className="text-sm text-slate-500 mt-1">Administra los catálogos y datos del sistema</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sections.map(s => (
          <a
            key={s.href}
            href={s.href}
            className="bg-white rounded-2xl border border-slate-200 p-6 hover:border-indigo-300 hover:shadow-md transition-all group"
          >
            <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
              <s.icon size={22} className={s.color} />
            </div>
            <h3 className="font-semibold text-slate-800 text-lg mb-1">{s.title}</h3>
            <p className="text-sm text-slate-500">{s.description}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
