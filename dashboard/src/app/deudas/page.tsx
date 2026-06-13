import { prisma } from '@/lib/prisma'
import { formatMXN, formatDate } from '@/lib/utils'

export default async function DeudasPage() {
  const deudas = await prisma.deuda.findMany({
    where: { activo: true },
    orderBy: { deudaOriginal: 'desc' },
  })

  const catDeudas = await prisma.categoria.findFirst({ where: { nombre: 'Deudas' } })

  const deudasConAbonos = await Promise.all(
    deudas.map(async (d) => {
      let totalAbonado = 0
      if (catDeudas) {
        const res = await prisma.transaccion.aggregate({
          where: {
            categoriaId: catDeudas.id,
            notas: { contains: d.acreedor, mode: 'insensitive' },
          },
          _sum: { monto: true },
        })
        totalAbonado = Number(res._sum.monto ?? 0)
      }
      const original = Number(d.deudaOriginal)
      const saldo = Math.max(original - totalAbonado, 0)
      const pct = original > 0 ? Math.min((totalAbonado / original) * 100, 100) : 0
      const abonoMensual = Number(d.abonoMensual ?? 0)
      const mesesRestantes = abonoMensual > 0 ? Math.ceil(saldo / abonoMensual) : null
      return { ...d, totalAbonado, saldo, pct, mesesRestantes }
    })
  )

  const totalDeuda = deudasConAbonos.reduce((s, d) => s + Number(d.deudaOriginal), 0)
  const totalSaldo = deudasConAbonos.reduce((s, d) => s + d.saldo, 0)
  const totalAbonado = deudasConAbonos.reduce((s, d) => s + d.totalAbonado, 0)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">Deudas</h2>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">Deuda original total</p>
          <p className="text-xl font-bold text-slate-800">{formatMXN(totalDeuda)}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 text-center">
          <p className="text-xs text-emerald-600 mb-1">Total abonado</p>
          <p className="text-xl font-bold text-emerald-700">{formatMXN(totalAbonado)}</p>
        </div>
        <div className="bg-rose-50 rounded-xl border border-rose-100 p-4 text-center">
          <p className="text-xs text-rose-600 mb-1">Saldo pendiente</p>
          <p className="text-xl font-bold text-rose-700">{formatMXN(totalSaldo)}</p>
        </div>
      </div>

      {/* Lista de deudas */}
      {deudasConAbonos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-5xl mb-3">🎉</p>
          <p className="font-medium">Sin deudas registradas</p>
          <p className="text-sm mt-1">Importa el Excel para ver el estado de tus deudas</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {deudasConAbonos.map(d => (
            <div key={d.id} className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">{d.acreedor}</h3>
                  <div className="flex gap-3 mt-1 text-sm text-slate-500">
                    {d.fechaInicio && <span>Desde {formatDate(d.fechaInicio)}</span>}
                    {d.abonoMensual && <span>· Abono: {formatMXN(Number(d.abonoMensual))}/mes</span>}
                    {d.mesesRestantes && <span>· ~{d.mesesRestantes} meses restantes</span>}
                  </div>
                  {d.notas && <p className="text-xs text-slate-400 mt-1">{d.notas}</p>}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-rose-600">{formatMXN(d.saldo)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">de {formatMXN(Number(d.deudaOriginal))}</p>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Abonado: {formatMXN(d.totalAbonado)}</span>
                  <span className={`font-semibold ${d.pct > 75 ? 'text-emerald-600' : d.pct > 40 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {d.pct.toFixed(1)}% pagado
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${d.pct > 75 ? 'bg-emerald-500' : d.pct > 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${d.pct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
