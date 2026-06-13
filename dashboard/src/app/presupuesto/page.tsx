import { prisma } from '@/lib/prisma'
import { formatMXN } from '@/lib/utils'

const EMOJI: Record<string, string> = {
  Hogar: '🏠', Salud: '💊', Familia: '👨‍👩‍👧', Transporte: '🚗',
  Suscripciones: '📱', Deudas: '💳', Personal: '🎯', Ingresos: '💵', Ahorro: '🏦',
}

export default async function PresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ quincena?: string }>
}) {
  const params = await searchParams
  const quincenaId = params.quincena ? parseInt(params.quincena) : undefined

  const today = new Date()

  const [quincenaActual, todasQuincenas] = await Promise.all([
    quincenaId
      ? prisma.quincena.findUnique({ where: { id: quincenaId } })
      : prisma.quincena.findFirst({
          where: { fechaInicio: { lte: today }, fechaFin: { gte: today } },
        }),
    prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' } }),
  ])

  const qId = quincenaActual?.id ?? -1

  const presupuestos = await prisma.presupuesto.findMany({
    where: { quincenaId: qId },
    include: { categoria: true, quincena: true },
    orderBy: { categoria: { nombre: 'asc' } },
  })

  const presupuestosConGasto = await Promise.all(
    presupuestos.map(async (p) => {
      const gastado = await prisma.transaccion.aggregate({
        where: { quincenaId: p.quincenaId, categoriaId: p.categoriaId },
        _sum: { monto: true },
      })
      const real = Number(gastado._sum.monto ?? 0)
      const presup = Number(p.montoPresupuestado)
      const pct = presup > 0 ? Math.min((real / presup) * 100, 100) : 0
      return { ...p, real, pct }
    })
  )

  const totalPresupuestado = presupuestosConGasto.reduce((s, p) => s + Number(p.montoPresupuestado), 0)
  const totalGastado = presupuestosConGasto.reduce((s, p) => s + p.real, 0)
  const pctGlobal = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Presupuesto</h2>
          {quincenaActual && (
            <p className="text-sm text-slate-500 mt-1">
              {quincenaActual.codigo} · {new Date(quincenaActual.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
              {' — '}
              {new Date(quincenaActual.fechaFin).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' })}
            </p>
          )}
        </div>
        <select
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700"
          defaultValue={quincenaActual?.id?.toString() ?? ''}
        >
          {todasQuincenas.map(q => (
            <option key={q.id} value={q.id}>{q.codigo}</option>
          ))}
        </select>
      </div>

      {/* Resumen global */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex justify-between items-end mb-3">
          <div>
            <p className="text-sm text-slate-500">Progreso global</p>
            <p className="text-2xl font-bold text-slate-800">
              {formatMXN(totalGastado)} <span className="text-slate-400 font-normal text-base">/ {formatMXN(totalPresupuestado)}</span>
            </p>
          </div>
          <span className={`text-lg font-bold ${pctGlobal > 90 ? 'text-rose-600' : pctGlobal > 70 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {pctGlobal.toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${pctGlobal > 90 ? 'bg-rose-500' : pctGlobal > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${pctGlobal}%` }}
          />
        </div>
      </div>

      {/* Por categoría */}
      {presupuestosConGasto.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-5xl mb-3">📋</p>
          <p className="font-medium">Sin presupuesto configurado</p>
          <p className="text-sm mt-1">Selecciona otra quincena o importa el Excel</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {presupuestosConGasto.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{EMOJI[p.categoria.nombre] ?? '📦'}</span>
                  <div>
                    <p className="font-semibold text-slate-800">{p.descripcion}</p>
                    <p className="text-xs text-slate-400">{p.categoria.nombre}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-800">{formatMXN(p.real)}</p>
                  <p className="text-xs text-slate-400">de {formatMXN(Number(p.montoPresupuestado))}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${p.pct > 90 ? 'bg-rose-500' : p.pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
                <span className={`text-xs font-semibold w-10 text-right ${p.pct > 90 ? 'text-rose-600' : p.pct > 70 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {p.pct.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
