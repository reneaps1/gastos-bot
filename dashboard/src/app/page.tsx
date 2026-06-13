import { prisma } from '@/lib/prisma'
import { formatMXN } from '@/lib/utils'

async function getDashboardData() {
  const today = new Date()

  const [quincenaActual, todasQuincenas, categorias, ultimasTransacciones, totalesPorCategoria] = await Promise.all([
    prisma.quincena.findFirst({
      where: {
        fechaInicio: { lte: today },
        fechaFin: { gte: today },
      },
    }),
    prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' }, take: 5 }),
    prisma.categoria.findMany({ where: { activo: true } }),
    prisma.transaccion.findMany({
      take: 10,
      orderBy: { fechaRegistro: 'desc' },
      include: { categoria: true, user: true },
    }),
    prisma.transaccion.groupBy({
      by: ['categoriaId'],
      _sum: { monto: true },
      _count: true,
    }),
  ])

  const ingresos = await prisma.transaccion.aggregate({
    where: quincenaActual ? { quincenaId: quincenaActual.id, tipo: 'Ingreso' } : { id: -1 },
    _sum: { monto: true },
  })
  const gastos = await prisma.transaccion.aggregate({
    where: quincenaActual ? { quincenaId: quincenaActual.id, tipo: 'Gasto' } : { id: -1 },
    _sum: { monto: true },
  })

  return { quincenaActual, todasQuincenas, categorias, ultimasTransacciones, totalesPorCategoria, ingresos, gastos }
}

export default async function DashboardPage() {
  const { quincenaActual, todasQuincenas, categorias, ultimasTransacciones, ingresos, gastos } = await getDashboardData()

  const totalIngresos = Number(ingresos._sum.monto ?? 0)
  const totalGastos = Number(gastos._sum.monto ?? 0)
  const balance = totalIngresos - totalGastos

  return (
    <div className="space-y-6">
      {/* Header quincena */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {quincenaActual ? quincenaActual.codigo : 'Sin quincena activa'}
          </h2>
          {quincenaActual && (
            <p className="text-sm text-slate-500 mt-1">
              {new Date(quincenaActual.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
              {' — '}
              {new Date(quincenaActual.fechaFin).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {todasQuincenas.map(q => (
            <option key={q.id} value={q.id}>{q.codigo}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Ingresos"
          value={formatMXN(totalIngresos)}
          icon="💵"
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <KpiCard
          label="Gastos"
          value={formatMXN(totalGastos)}
          icon="💸"
          color="text-rose-600"
          bg="bg-rose-50"
        />
        <KpiCard
          label="Balance"
          value={formatMXN(balance)}
          icon={balance >= 0 ? '📈' : '📉'}
          color={balance >= 0 ? 'text-indigo-600' : 'text-orange-600'}
          bg={balance >= 0 ? 'bg-indigo-50' : 'bg-orange-50'}
        />
      </div>

      {/* Categorías + Transacciones recientes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Categorías */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Categorías del sistema</h3>
          <div className="space-y-2">
            {categorias.map(cat => (
              <div key={cat.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-base">{getCatEmoji(cat.nombre)}</span>
                  <span className="text-sm font-medium text-slate-700">{cat.nombre}</span>
                </div>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    cat.tipo === 'Gasto' ? 'bg-rose-100 text-rose-700' :
                    cat.tipo === 'Ingreso' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {cat.tipo}
                  </span>
                  {cat.clasificacion && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {cat.clasificacion}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Últimas transacciones */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Últimas transacciones</h3>
          {ultimasTransacciones.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm">Sin transacciones aún</p>
              <p className="text-xs mt-1">Envía un gasto por WhatsApp para verlo aquí</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ultimasTransacciones.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{getCatEmoji(tx.categoria.nombre)}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-700">{tx.descripcion}</p>
                      <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? 'Rene'}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${tx.tipo === 'Ingreso' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quincenas */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Próximas quincenas</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {todasQuincenas.slice(0, 10).map(q => {
            const isActual = quincenaActual?.id === q.id
            return (
              <div key={q.id} className={`rounded-xl p-3 text-center border ${
                isActual ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}>
                <p className={`font-bold text-lg ${isActual ? 'text-white' : 'text-slate-800'}`}>{q.codigo}</p>
                <p className={`text-xs mt-1 ${isActual ? 'text-indigo-200' : 'text-slate-400'}`}>
                  {new Date(q.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, icon, color, bg }: {
  label: string; value: string; icon: string; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center text-2xl`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  )
}

function getCatEmoji(nombre: string): string {
  const map: Record<string, string> = {
    Hogar: '🏠', Salud: '💊', Familia: '👨‍👩‍👧', Transporte: '🚗',
    Suscripciones: '📱', Deudas: '💳', Personal: '🎯',
    Ingresos: '💵', Ahorro: '🏦',
  }
  return map[nombre] ?? '📦'
}
