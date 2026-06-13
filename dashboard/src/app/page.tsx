import { prisma } from '@/lib/prisma'
import { formatMXN } from '@/lib/utils'

async function getDashboardData(quincenaId?: number) {
  const today = new Date()

  const [quincenaActual, todasQuincenas, categorias] = await Promise.all([
    quincenaId
      ? prisma.quincena.findUnique({ where: { id: quincenaId } })
      : prisma.quincena.findFirst({
          where: { fechaInicio: { lte: today }, fechaFin: { gte: today } },
        }),
    prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' } }),
    prisma.categoria.findMany({ where: { activo: true } }),
  ])

  const qId = quincenaActual?.id ?? -1

  const [
    transacciones,
    ultimasTransacciones,
    totalPresupuestado,
    gastosPendientes,
  ] = await Promise.all([
    prisma.transaccion.findMany({
      where: { quincenaId: qId },
      include: { categoria: true, user: true },
    }),
    prisma.transaccion.findMany({
      take: 8,
      orderBy: { fechaRegistro: 'desc' },
      include: { categoria: true, user: true },
    }),
    prisma.presupuesto.aggregate({
      where: { quincenaId: qId },
      _sum: { montoPresupuestado: true },
    }),
    prisma.transaccion.findMany({
      where: { quincenaId: qId, tipo: 'Gasto', estatus: 'Pendiente' },
      include: { categoria: true, user: true },
      orderBy: { fecha: 'desc' },
    }),
  ])

  const ingresos = transacciones
    .filter(t => t.tipo === 'Ingreso')
    .reduce((s, t) => s + Number(t.monto), 0)
  const gastos = transacciones
    .filter(t => t.tipo === 'Gasto')
    .reduce((s, t) => s + Number(t.monto), 0)
  const ahorros = transacciones
    .filter(t => t.tipo === 'Ahorro')
    .reduce((s, t) => s + Number(t.monto), 0)

  const gastosPagados = transacciones
    .filter(t => t.tipo === 'Gasto' && t.estatus === 'Pagado')
    .reduce((s, t) => s + Number(t.monto), 0)
  const pendientePorPagar = gastos - gastosPagados

  const presupTotal = Number(totalPresupuestado._sum.montoPresupuestado ?? 0)
  const margen = ingresos - gastos

  const gastosPorCategoria = transacciones
    .filter(t => t.tipo === 'Gasto')
    .reduce((acc, t) => {
      const cat = t.categoria.nombre
      acc[cat] = (acc[cat] ?? 0) + Number(t.monto)
      return acc
    }, {} as Record<string, number>)

  const gastosPorCategoriaArr = Object.entries(gastosPorCategoria)
    .map(([nombre, monto]) => ({ nombre, monto, pct: gastos > 0 ? (monto / gastos) * 100 : 0 }))
    .sort((a, b) => b.monto - a.monto)

  const totalGastosPendientes = gastosPendientes.reduce((s, t) => s + Number(t.monto), 0)

  return {
    quincenaActual,
    todasQuincenas,
    categorias,
    ultimasTransacciones,
    gastosPendientes,
    gastosPorCategoriaArr,
    metricas: {
      ingresos,
      gastos,
      ahorros,
      balance: ingresos - gastos - ahorros,
      margen,
      presupTotal,
      pendientePorPagar,
      totalGastosPendientes,
      pctPresup: presupTotal > 0 ? (gastos / presupTotal) * 100 : 0,
    },
  }
}

function getSemaforo(margen: number, ingresos: number) {
  if (ingresos === 0) return { color: 'bg-slate-300', label: 'Sin datos', text: 'text-slate-600' }
  const ratio = margen / ingresos
  if (ratio >= 0.15) return { color: 'bg-emerald-500', label: 'Saludable', text: 'text-emerald-700' }
  if (ratio >= 0) return { color: 'bg-amber-500', label: 'Ajustado', text: 'text-amber-700' }
  return { color: 'bg-rose-500', label: 'En rojo', text: 'text-rose-700' }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ quincena?: string }>
}) {
  const params = await searchParams
  const quincenaId = params.quincena ? parseInt(params.quincena) : undefined
  const data = await getDashboardData(quincenaId)
  const { quincenaActual, todasQuincenas, categorias, ultimasTransacciones, gastosPendientes, gastosPorCategoriaArr, metricas } = data
  const sem = getSemaforo(metricas.margen, metricas.ingresos)

  return (
    <div className="space-y-6">
      {/* Header quincena */}
      <div className="flex items-center justify-between flex-wrap gap-4">
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${sem.color}`} />
            <span className={`text-sm font-semibold ${sem.text}`}>{sem.label}</span>
          </div>
          <select
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onChange={undefined}
            defaultValue={quincenaActual?.id?.toString() ?? ''}
          >
            {todasQuincenas.map(q => (
              <option key={q.id} value={q.id}>{q.codigo}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Ingresos" value={formatMXN(metricas.ingresos)} icon="💵" color="text-emerald-600" bg="bg-emerald-50" />
        <KpiCard label="Gastos" value={formatMXN(metricas.gastos)} icon="💸" color="text-rose-600" bg="bg-rose-50" />
        <KpiCard label="Ahorros" value={formatMXN(metricas.ahorros)} icon="🏦" color="text-blue-600" bg="bg-blue-50" />
        <KpiCard label="Margen" value={formatMXN(metricas.margen)} icon={metricas.margen >= 0 ? '📈' : '📉'} color={metricas.margen >= 0 ? 'text-indigo-600' : 'text-orange-600'} bg={metricas.margen >= 0 ? 'bg-indigo-50' : 'bg-orange-50'} />
        <KpiCard label="Pendiente" value={formatMXN(metricas.pendientePorPagar)} icon="⏳" color="text-amber-600" bg="bg-amber-50" />
        <KpiCard label="Presupuesto" value={`${metricas.pctPresup.toFixed(0)}%`} icon="📊" color={metricas.pctPresup > 90 ? 'text-rose-600' : metricas.pctPresup > 70 ? 'text-amber-600' : 'text-emerald-600'} bg={metricas.pctPresup > 90 ? 'bg-rose-50' : metricas.pctPresup > 70 ? 'bg-amber-50' : 'bg-emerald-50'} />
      </div>

      {/* Gastos por categoría + Gastos pendientes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gastos por categoría */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Gastos por categoría</h3>
          {gastosPorCategoriaArr.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <p className="text-3xl mb-2">📊</p>
              <p className="text-sm">Sin gastos en esta quincena</p>
            </div>
          ) : (
            <div className="space-y-3">
              {gastosPorCategoriaArr.map(cat => (
                <div key={cat.nombre}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-700 flex items-center gap-1.5">
                      <span>{getCatEmoji(cat.nombre)}</span>
                      {cat.nombre}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{formatMXN(cat.monto)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${cat.pct > 50 ? 'bg-rose-500' : cat.pct > 25 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                      style={{ width: `${cat.pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{cat.pct.toFixed(1)}% del total</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gastos pendientes */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-700">Gastos pendientes</h3>
            {metricas.totalGastosPendientes > 0 && (
              <span className="text-sm font-bold text-amber-600">{formatMXN(metricas.totalGastosPendientes)}</span>
            )}
          </div>
          {gastosPendientes.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm">Todo pagado en esta quincena</p>
            </div>
          ) : (
            <div className="space-y-2">
              {gastosPendientes.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{getCatEmoji(tx.categoria.nombre)}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-700">{tx.descripcion}</p>
                      <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? '—'}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-rose-600">-{formatMXN(Number(tx.monto))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Últimas transacciones */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Últimos movimientos</h3>
        {ultimasTransacciones.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <p className="text-4xl mb-2">📭</p>
            <p className="text-sm">Sin transacciones aún</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ultimasTransacciones.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{getCatEmoji(tx.categoria.nombre)}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-700">{tx.descripcion}</p>
                    <p className="text-xs text-slate-400">{tx.categoria.nombre} · {tx.user?.nombre ?? 'Rene'}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${tx.tipo === 'Ingreso' ? 'text-emerald-600' : tx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'}`}>
                  {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quincenas */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Quincenas</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
          {todasQuincenas.slice(0, 14).map(q => {
            const isActual = quincenaActual?.id === q.id
            return (
              <a
                key={q.id}
                href={`/?quincena=${q.id}`}
                className={`rounded-xl p-3 text-center border transition-all ${
                  isActual ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300'
                }`}
              >
                <p className={`font-bold text-sm ${isActual ? 'text-white' : 'text-slate-800'}`}>{q.codigo}</p>
                <p className={`text-xs mt-1 ${isActual ? 'text-indigo-200' : 'text-slate-400'}`}>
                  {new Date(q.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                </p>
              </a>
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
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center text-xl shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className={`text-lg font-bold ${color} truncate`}>{value}</p>
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
