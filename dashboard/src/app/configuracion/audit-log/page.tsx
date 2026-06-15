'use client'
import { useState, useEffect, useCallback } from 'react'
import { ClipboardList } from 'lucide-react'
import { formatMXN, formatDate } from '@/lib/utils'

interface AuditEntry {
  id: number; tabla: string; registroId: number; operacion: string
  campo: string | null; valorAnterior: string | null; valorNuevo: string | null
  userId: number | null; source: string | null; fecha: string
  user: { id: number; nombre: string } | null
}

interface AuditResponse {
  logs: AuditEntry[]
  total: number
  page: number
  pages: number
}

const TABLAS = ['transaccion', 'presupuesto', 'deuda', 'entrada_rapida', 'liquidez_snapshot', 'user', 'categoria']
const OPERACIONES = ['INSERT', 'UPDATE', 'DELETE']

const tablaColors: Record<string, string> = {
  transaccion: 'bg-blue-100 text-blue-700',
  presupuesto: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  deuda: 'bg-rose-100 text-rose-700',
  entrada_rapida: 'bg-amber-100 text-amber-700',
  liquidez_snapshot: 'bg-cyan-100 text-cyan-700',
  user: 'bg-emerald-100 text-emerald-700',
  categoria: 'bg-violet-100 text-violet-700',
}

const opColors: Record<string, string> = {
  INSERT: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
}

export default function AuditLogPage() {
  const [data, setData] = useState<AuditResponse>({ logs: [], total: 0, page: 1, pages: 1 })
  const [tablaFilter, setTablaFilter] = useState('')
  const [operacionFilter, setOperacionFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tablaFilter) params.set('tabla', tablaFilter)
      if (operacionFilter) params.set('operacion', operacionFilter)
      params.set('page', page.toString())
      params.set('limit', '50')
      const res = await fetch(`/api/audit-log?${params}`)
      setData(await res.json())
    } finally { setLoading(false) }
  }, [tablaFilter, operacionFilter, page])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => { setPage(1) }, [tablaFilter, operacionFilter])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Audit Log</h2>
        <p className="text-sm text-slate-500 mt-1">Historial de cambios en el sistema ({data.total} registros)</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 flex-wrap">
        <select value={tablaFilter} onChange={e => setTablaFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700">
          <option value="">Todas las tablas</option>
          {TABLAS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={operacionFilter} onChange={e => setOperacionFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700">
          <option value="">Todas las operaciones</option>
          {OPERACIONES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400 text-sm gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Cargando...
          </div>
        ) : data.logs.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
              <ClipboardList size={28} className="text-slate-300" />
            </div>
            <p className="font-medium text-slate-600">Sin registros de auditoría</p>
            <p className="text-sm mt-1">Los cambios en el sistema aparecerán aquí</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Fecha</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium">Tabla</th>
                  <th className="text-center px-3 py-3 text-slate-500 font-medium">Operación</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium hidden md:table-cell">ID</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium hidden lg:table-cell">Campo</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium hidden lg:table-cell">Anterior</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium hidden lg:table-cell">Nuevo</th>
                  <th className="text-left px-3 py-3 text-slate-500 font-medium hidden md:table-cell">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap text-xs">
                      {formatDate(log.fecha)}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tablaColors[log.tabla] ?? 'bg-slate-100 text-slate-600'}`}>
                        {log.tabla}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${opColors[log.operacion] ?? 'bg-slate-100 text-slate-600'}`}>
                        {log.operacion}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-slate-600 hidden md:table-cell">{log.registroId}</td>
                    <td className="px-3 py-3.5 text-slate-600 hidden lg:table-cell">{log.campo ?? '—'}</td>
                    <td className="px-3 py-3.5 text-slate-500 hidden lg:table-cell max-w-[120px] truncate text-xs">{log.valorAnterior ?? '—'}</td>
                    <td className="px-3 py-3.5 text-slate-700 hidden lg:table-cell max-w-[120px] truncate text-xs">{log.valorNuevo ?? '—'}</td>
                    <td className="px-3 py-3.5 text-slate-600 hidden md:table-cell">{log.user?.nombre ?? log.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
            Anterior
          </button>
          <span className="text-sm text-slate-500">Página {data.page} de {data.pages}</span>
          <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}
