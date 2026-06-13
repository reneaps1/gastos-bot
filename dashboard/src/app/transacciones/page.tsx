import { prisma } from '@/lib/prisma'
import { formatMXN, formatDate } from '@/lib/utils'

const EMOJI: Record<string, string> = {
  Hogar: '🏠', Salud: '💊', Familia: '👨‍👩‍👧', Transporte: '🚗',
  Suscripciones: '📱', Deudas: '💳', Personal: '🎯', Ingresos: '💵', Ahorro: '🏦',
}

export default async function TransaccionesPage({
  searchParams,
}: {
  searchParams: Promise<{ quincena?: string; tipo?: string }>
}) {
  const params = await searchParams
  const quincenaId = params.quincena ? parseInt(params.quincena) : undefined
  const tipo = params.tipo

  const where: any = {}
  if (quincenaId) where.quincenaId = quincenaId
  if (tipo) where.tipo = tipo

  const [transacciones, quincenas] = await Promise.all([
    prisma.transaccion.findMany({
      where,
      orderBy: { fecha: 'desc' },
      take: 200,
      include: { categoria: true, user: true, quincena: true },
    }),
    prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' } }),
  ])

  const totalGastos = transacciones.filter(t => t.tipo === 'Gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresos = transacciones.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + Number(t.monto), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Transacciones</h2>
        <div className="flex gap-3">
          <select
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
            defaultValue={quincenaId?.toString() ?? ''}
          >
            <option value="">Todas las quincenas</option>
            {quincenas.map(q => <option key={q.id} value={q.id}>{q.codigo}</option>)}
          </select>
          <select
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
            defaultValue={tipo ?? ''}
          >
            <option value="">Todos los tipos</option>
            <option value="Gasto">Gasto</option>
            <option value="Ingreso">Ingreso</option>
            <option value="Ahorro">Ahorro</option>
          </select>
        </div>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">Total registros</p>
          <p className="text-2xl font-bold text-slate-800">{transacciones.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 text-center">
          <p className="text-xs text-emerald-600 mb-1">Total ingresos</p>
          <p className="text-2xl font-bold text-emerald-700">{formatMXN(totalIngresos)}</p>
        </div>
        <div className="bg-rose-50 rounded-xl border border-rose-100 p-4 text-center">
          <p className="text-xs text-rose-600 mb-1">Total gastos</p>
          <p className="text-2xl font-bold text-rose-700">{formatMXN(totalGastos)}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {transacciones.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-5xl mb-3">📭</p>
            <p className="font-medium">Sin transacciones</p>
            <p className="text-sm mt-1">Manda un gasto por WhatsApp o importa el Excel</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Descripción</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Categoría</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Quincena</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium hidden md:table-cell">Fecha</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium hidden lg:table-cell">Usuario</th>
                  <th className="text-right px-5 py-3 text-slate-500 font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {transacciones.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{tx.descripcion}</td>
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span>{EMOJI[tx.categoria.nombre] ?? '📦'}</span>
                        {tx.categoria.nombre}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {tx.quincena.codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 hidden md:table-cell">{formatDate(tx.fecha)}</td>
                    <td className="px-4 py-3.5 text-slate-500 hidden lg:table-cell">{tx.user?.nombre ?? '—'}</td>
                    <td className={`px-5 py-3.5 text-right font-semibold ${
                      tx.tipo === 'Ingreso' ? 'text-emerald-600' : tx.tipo === 'Ahorro' ? 'text-blue-600' : 'text-rose-600'
                    }`}>
                      {tx.tipo === 'Ingreso' ? '+' : '-'}{formatMXN(Number(tx.monto))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
