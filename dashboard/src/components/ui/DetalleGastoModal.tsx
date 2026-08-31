'use client'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatMXN, formatDateStr } from '@/lib/utils'

// Detalle de las transacciones que componen el real de una partida de
// presupuesto. Consulta solo por presupuestoId (sin filtro de tipo), que es
// exactamente el filtro con el que /api/presupuestos calcula el campo `real`
// de cada linea, para que el total del detalle siempre cuadre con el numero
// de la pagina -- sea la partida de Gasto, Ingreso o Ahorro.

export interface PartidaDetalle {
  id: number
  descripcion: string
  montoPresupuestado: number | string
  montoRevisado: number | string | null
  montoEfectivo: number
  real: number
  categoriaNombre: string
  quincenaCodigo: string
}

interface TransaccionRow {
  id: number
  fecha: string
  descripcion: string
  monto: string | number
  estatus: 'Pagado' | 'Pendiente'
  categoria: { nombre: string } | null
  metodoPago: { nombre: string } | null
  user: { nombre: string } | null
}

export function DetalleGastoContent({ partida }: { partida: PartidaDetalle }) {
  const [rows, setRows] = useState<TransaccionRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // El componente se monta por partida (va con `key` en el caller), asi que el
  // estado ya arranca en loading y el efecto solo dispara el fetch: no hace
  // falta resetear estado de forma sincrona aqui.
  useEffect(() => {
    let cancelado = false
    // limit alto: una partida rara vez pasa de unas decenas de movimientos, y
    // asi el listado no queda paginado a la mitad.
    fetch(`/api/transacciones?presupuestoId=${partida.id}&limit=200`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(json => {
        if (cancelado) return
        setRows(json.data ?? [])
        // Las transacciones de una partida comparten su tipo (Gasto, Ingreso o
        // Ahorro) por construccion, asi que solo uno de estos tres viene con
        // monto — sumarlos da el total real sin tener que adivinar cual es.
        const t = json.totales ?? {}
        setTotal(Number(t.Gasto ?? 0) + Number(t.Ingreso ?? 0) + Number(t.Ahorro ?? 0))
      })
      .catch(() => {
        if (!cancelado) setError('No se pudo cargar el detalle. Intenta de nuevo.')
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => { cancelado = true }
  }, [partida.id])

  const presupuestado = partida.montoEfectivo
  const fueRevisado = partida.montoRevisado != null && Number(partida.montoRevisado) !== Number(partida.montoPresupuestado)
  const restante = presupuestado - partida.real
  // El total que devuelve la API es la suma no paginada con el mismo filtro que
  // usa /api/presupuestos, asi que deberia coincidir con `real`. Si no coincide
  // se avisa en vez de mostrar dos numeros distintos sin explicacion.
  const descuadre = !loading && !error && Math.abs(total - partida.real) > 0.01

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Presupuestado</p>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(presupuestado)}</p>
          {fueRevisado && <p className="text-[10px] text-slate-400 dark:text-slate-500">original {formatMXN(Number(partida.montoPresupuestado))}</p>}
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Gastado</p>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(partida.real)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {restante < 0 ? 'Excedido' : 'Restante'}
          </p>
          <p className={`text-sm font-bold tabular-nums ${restante < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {formatMXN(Math.abs(restante))}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 dark:text-slate-500">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Cargando movimientos...</span>
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-medium text-slate-600 dark:text-slate-400">Sin movimientos asignados</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
            Ninguna transacción está asignada a esta partida todavía.
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            Las transacciones se asignan a mano desde el Dashboard o Transacciones.
          </p>
        </div>
      ) : (
        <>
          {descuadre && (
            <p className="mb-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
              El total del detalle ({formatMXN(total)}) no coincide con el gastado mostrado
              ({formatMXN(partida.real)}). Recarga la página para refrescar los datos.
            </p>
          )}

          {/* Movil: lista */}
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 sm:hidden">
            {rows.map(t => (
              <li key={t.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-100 text-sm truncate">{t.descripcion}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {formatDateStr(t.fecha, { day: '2-digit', month: 'short' })}
                      {t.metodoPago?.nombre ? ` · ${t.metodoPago.nombre}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(t.monto)}</p>
                    {t.estatus === 'Pendiente' && (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">pendiente</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Escritorio: tabla */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-700">
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">Fecha</th>
                  <th className="py-2 pr-3 font-medium">Descripción</th>
                  <th className="py-2 pr-3 font-medium">Método</th>
                  <th className="py-2 pr-3 font-medium">Estatus</th>
                  <th className="py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {rows.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateStr(t.fecha, { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="py-2 pr-3 text-slate-800 dark:text-slate-100 max-w-[240px] truncate">{t.descripcion}</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{t.metodoPago?.nombre ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {t.estatus === 'Pendiente' ? (
                        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded-full">Pendiente</span>
                      ) : (
                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded-full">Pagado</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{formatMXN(t.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {rows.length} {rows.length === 1 ? 'movimiento' : 'movimientos'}
            </span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}
