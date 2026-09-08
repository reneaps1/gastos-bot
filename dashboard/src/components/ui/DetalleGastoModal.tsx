'use client'
import { useEffect, useState } from 'react'
import { Loader2, ArrowRightLeft, ArrowUpDown, XCircle, Pencil, MessageSquare, Send, History, ChevronDown, ChevronUp } from 'lucide-react'
import { formatMXN, formatDateStr } from '@/lib/utils'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { useToast } from '@/components/Toast'

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
  categoriaTipo: string
  estadoLinea: string
  quincenaCodigo: string
  recurrenciaGrupoId: string | null
}

interface OcurrenciaSerie {
  id: number
  real: number
  quincena: { fechaInicio: string; fechaFin: string }
}

// Mismo calculo que proyeccion() en PresupuestoAnalisis.tsx (promedio +
// desviacion poblacional de las ultimas hasta-3 quincenas YA CERRADAS), pero
// aplicado al real de las ocurrencias pasadas de esta serie recurrente en vez
// de al gasto total de la quincena -- misma nocion de "cerrada" (fechaFin <
// hoy), sin depender de que alguien haya corrido el wizard de cierre.
function historialSerie(ocurrencias: OcurrenciaSerie[], today: string) {
  const cerradas = ocurrencias
    .filter(o => o.quincena.fechaFin < today)
    .sort((a, b) => a.quincena.fechaInicio.localeCompare(b.quincena.fechaInicio))
  const ultimas = cerradas.slice(-3)
  if (ultimas.length === 0) return null
  const valores = ultimas.map(o => o.real)
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length
  const varianza = valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length
  return { promedio, desviacion: Math.sqrt(varianza), n: ultimas.length }
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

interface UserOption { id: number; nombre: string }
interface Comentario {
  id: number
  texto: string
  fechaCreacion: string
  user: { id: number; nombre: string } | null
}

type TipoCambioPresupuesto =
  | 'CREACION'
  | 'AJUSTE_MANUAL'
  | 'DESDE_SIN_ASIGNAR'
  | 'TRASPASO_ENTRADA'
  | 'TRASPASO_SALIDA'
  | 'MIGRACION_VIGENTE'

interface CambioPresupuesto {
  id: number
  tipo: TipoCambioPresupuesto
  montoAnterior: number
  montoNuevo: number
  delta: number
  grupoCambioId: string | null
  presupuestoRelacionadoId: number | null
  relacionado: { descripcion: string; categoria: string | null } | null
  motivo: string | null
  actor: string | null
  fechaCreacion: string
}

interface HistorialPresupuestoResponse {
  presupuesto: {
    id: number
    original: number
    vigente: number
    ajusteAcumulado: number
  }
  cambios: CambioPresupuesto[]
}

// fechaCreacion es un timestamp real (no una fecha-sin-hora como Quincena),
// asi que se muestra en la hora local del navegador -- formatDateStr/formatDate
// de @/lib/utils estan pensados para columnas @db.Date y truncarian/forzarian
// UTC, perdiendo la hora real del comentario o del cambio de presupuesto.
function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function etiquetaCambio(cambio: CambioPresupuesto) {
  switch (cambio.tipo) {
    case 'CREACION': return 'Presupuesto inicial'
    case 'AJUSTE_MANUAL': return 'Ajuste manual'
    case 'DESDE_SIN_ASIGNAR': return 'Desde dinero sin asignar'
    case 'TRASPASO_ENTRADA': return cambio.relacionado ? `Desde ${cambio.relacionado.descripcion}` : 'Traspaso recibido'
    case 'TRASPASO_SALIDA': return cambio.relacionado ? `Hacia ${cambio.relacionado.descripcion}` : 'Traspaso enviado'
    case 'MIGRACION_VIGENTE': return 'Vigente previo al historial'
  }
}

function formatDelta(delta: number) {
  if (Math.abs(delta) < 0.005) return formatMXN(0)
  return `${delta > 0 ? '+' : '−'}${formatMXN(Math.abs(delta))}`
}

interface DetalleGastoProps {
  partida: PartidaDetalle
  onTraspasar?: () => void
  // Ajustar monto y Cancelar generalizan acciones que hoy solo viven en el
  // panel de triage de deficit / el wizard de cierre de quincena (mismos
  // endpoints, sin restriccion de servidor -- ver plan). onAjustado deja que
  // el padre actualice `detalleP` en vivo con el nuevo monto sin cerrar este
  // modal; onCancelado cierra el modal (una linea Cancelada deja de tener
  // sentido seguir inspeccionando aqui) y refresca las listas.
  onAjustado?: (nuevoMontoRevisado: number) => void
  onCancelado?: () => void
  onEditar?: () => void
}

export function DetalleGastoContent({ partida, onTraspasar, onAjustado, onCancelado, onEditar }: DetalleGastoProps) {
  const { toast } = useToast()
  const [rows, setRows] = useState<TransaccionRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<ReturnType<typeof historialSerie>>(null)
  const [accionActiva, setAccionActiva] = useState<'ajustar' | 'cancelar' | null>(null)
  const [montoAjuste, setMontoAjuste] = useState('')
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [notaCancelar, setNotaCancelar] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [historialPresupuesto, setHistorialPresupuesto] = useState<HistorialPresupuestoResponse | null>(null)
  const [historialPresupuestoLoading, setHistorialPresupuestoLoading] = useState(true)
  const [historialPresupuestoError, setHistorialPresupuestoError] = useState(false)
  const [historialPresupuestoAbierto, setHistorialPresupuestoAbierto] = useState(false)
  const [historialVersion, setHistorialVersion] = useState(0)

  const [comentarios, setComentarios] = useState<Comentario[]>([])
  const [comentariosLoading, setComentariosLoading] = useState(true)
  const [users, setUsers] = useState<UserOption[]>([])
  const [nuevoTexto, setNuevoTexto] = useState('')
  const [nuevoUserId, setNuevoUserId] = useState('')
  const [enviandoComentario, setEnviandoComentario] = useState(false)

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

  // Historial auditable del monto de esta línea. Es distinto al historial de
  // la serie recurrente: aquí interesa cómo cambió Original → Vigente dentro
  // de ESTA quincena y de dónde vino cada ajuste.
  useEffect(() => {
    let cancelado = false
    setHistorialPresupuestoLoading(true)
    setHistorialPresupuestoError(false)
    fetch(`/api/presupuestos/${partida.id}/historial`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: HistorialPresupuestoResponse) => {
        if (!cancelado) setHistorialPresupuesto(data)
      })
      .catch(() => {
        if (!cancelado) {
          setHistorialPresupuesto(null)
          setHistorialPresupuestoError(true)
        }
      })
      .finally(() => {
        if (!cancelado) setHistorialPresupuestoLoading(false)
      })
    return () => { cancelado = true }
  }, [partida.id, historialVersion])

  // Historial de esta serie recurrente: solo aplica si la partida pertenece a
  // un grupo (ver recurrenciaGrupoId). Se pide aparte de las transacciones de
  // arriba porque es una consulta distinta (otras partidas, no otras
  // transacciones) y no toda partida es recurrente.
  useEffect(() => {
    if (!partida.recurrenciaGrupoId) { setHistorial(null); return }
    let cancelado = false
    fetch(`/api/presupuestos?recurrenciaGrupoId=${partida.recurrenciaGrupoId}`)
      .then(res => res.ok ? res.json() : [])
      .then((data: OcurrenciaSerie[]) => {
        if (!cancelado) setHistorial(historialSerie(data, getMexicoDateString()))
      })
      .catch(() => { if (!cancelado) setHistorial(null) })
    return () => { cancelado = true }
  }, [partida.recurrenciaGrupoId])

  // Comentarios de esta partida. Igual que el estado de `loading` de arriba,
  // arranca en true por useState y el componente se remonta por partida (key
  // en el caller) -- no hace falta resetear el flag a mano aqui.
  useEffect(() => {
    let cancelado = false
    fetch(`/api/presupuestos/${partida.id}/comentarios`)
      .then(res => res.ok ? res.json() : [])
      .then((data: Comentario[]) => { if (!cancelado) setComentarios(data) })
      .catch(() => { if (!cancelado) setComentarios([]) })
      .finally(() => { if (!cancelado) setComentariosLoading(false) })
    return () => { cancelado = true }
  }, [partida.id])

  // Lista de usuarios para el selector "quien comenta" -- no depende de la
  // partida, se pide una sola vez.
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.ok ? res.json() : [])
      .then((data: UserOption[]) => setUsers(data))
      .catch(() => setUsers([]))
  }, [])

  async function enviarComentario() {
    const texto = nuevoTexto.trim()
    if (!texto) return
    setEnviandoComentario(true)
    try {
      const res = await fetch(`/api/presupuestos/${partida.id}/comentarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, userId: nuevoUserId || null }),
      })
      if (!res.ok) throw new Error()
      const creado: Comentario = await res.json()
      setComentarios(prev => [...prev, creado])
      setNuevoTexto('')
    } catch {
      toast('Error al publicar el comentario', 'error')
    } finally {
      setEnviandoComentario(false)
    }
  }

  const original = historialPresupuesto?.presupuesto.original ?? Number(partida.montoPresupuestado)
  const presupuestado = historialPresupuesto?.presupuesto.vigente ?? partida.montoEfectivo
  const ajusteAcumulado = historialPresupuesto?.presupuesto.ajusteAcumulado ?? (presupuestado - original)
  const fueRevisado = Math.abs(ajusteAcumulado) >= 0.005
  const ajustePct = original > 0 ? (ajusteAcumulado / original) * 100 : null
  const restante = presupuestado - partida.real
  const ejecucionVigentePct = presupuestado > 0 ? (partida.real / presupuestado) * 100 : null
  const desviacionOriginal = partida.real - original
  const desviacionOriginalPct = original > 0 ? (desviacionOriginal / original) * 100 : null
  // El total que devuelve la API es la suma no paginada con el mismo filtro que
  // usa /api/presupuestos, asi que deberia coincidir con `real`. Si no coincide
  // se avisa en vez de mostrar dos numeros distintos sin explicacion.
  const descuadre = !loading && !error && Math.abs(total - partida.real) > 0.01
  const esGastoAbierta = partida.categoriaTipo === 'Gasto' && partida.estadoLinea === 'Abierta'
  // Mismo criterio que el boton de traspaso en presupuesto/page.tsx: solo
  // lineas de Gasto abiertas con saldo sin gastar pueden donar.
  const puedeTraspasar = onTraspasar != null && esGastoAbierta && restante > 0
  const puedeAjustar = onAjustado != null && esGastoAbierta
  const puedeCancelar = onCancelado != null && esGastoAbierta

  async function guardarAjuste() {
    const nuevo = parseFloat(montoAjuste)
    if (isNaN(nuevo) || nuevo < partida.real) {
      toast(`No puede quedar por debajo de lo ya gastado (${formatMXN(partida.real)})`, 'error')
      return
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/presupuestos/${partida.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ montoRevisado: nuevo, motivoCambio: motivoAjuste.trim() || undefined }),
      })
      if (!res.ok) throw new Error()
      toast('Monto vigente ajustado')
      setAccionActiva(null)
      setMotivoAjuste('')
      onAjustado?.(nuevo)
      setHistorialVersion(v => v + 1)
    } catch {
      toast('Error al ajustar el monto', 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarCancelacion() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/presupuestos/${partida.id}/resolver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'cancelar', nota: notaCancelar || undefined }),
      })
      if (!res.ok) throw new Error()
      toast('Línea cancelada')
      onCancelado?.()
    } catch {
      toast('Error al cancelar la línea', 'error')
      setGuardando(false)
    }
  }

  return (
    <div>
      {(onEditar || puedeAjustar || puedeTraspasar || puedeCancelar) && (
        <div className="mb-3">
          {accionActiva === null ? (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
              {onEditar && (
                <button onClick={onEditar}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline cursor-pointer">
                  <Pencil size={13} /> Editar
                </button>
              )}
              {puedeAjustar && (
                <button onClick={() => { setMontoAjuste(String(presupuestado)); setMotivoAjuste(''); setAccionActiva('ajustar') }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                  <ArrowUpDown size={13} /> Ajustar vigente
                </button>
              )}
              {puedeTraspasar && (
                <button onClick={onTraspasar}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                  <ArrowRightLeft size={13} /> Traspasar saldo libre
                </button>
              )}
              {puedeCancelar && (
                <button onClick={() => setAccionActiva('cancelar')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer">
                  <XCircle size={13} /> Cancelar línea
                </button>
              )}
            </div>
          ) : accionActiva === 'ajustar' ? (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-2.5">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Nuevo presupuesto vigente</label>
                  <input type="number" min={partida.real} step="0.01" value={montoAjuste} onChange={e => setMontoAjuste(e.target.value)} autoFocus
                    className="w-36 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Motivo <span className="font-normal text-slate-400">(opcional)</span></label>
                  <input type="text" value={motivoAjuste} onChange={e => setMotivoAjuste(e.target.value)} placeholder="Ej. gasto mayor a lo previsto"
                    className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
              <p className="text-[11px] text-indigo-600/80 dark:text-indigo-400/80">
                El Original ({formatMXN(original)}) no cambia. Este ajuste modifica únicamente el Vigente y queda en el historial.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setAccionActiva(null)} disabled={guardando}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700 cursor-pointer">
                  Cancelar
                </button>
                <button onClick={guardarAjuste} disabled={guardando}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                  {guardando && <Loader2 size={12} className="animate-spin" />} Guardar vigente
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">¿Por qué? (opcional)</label>
                <input type="text" value={notaCancelar} onChange={e => setNotaCancelar(e.target.value)} autoFocus
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-400" />
              </div>
              <button onClick={guardarCancelacion} disabled={guardando}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                {guardando && <Loader2 size={12} className="animate-spin" />} Sí, cancelar línea
              </button>
              <button onClick={() => setAccionActiva(null)} disabled={guardando}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                Volver
              </button>
            </div>
          )}
        </div>
      )}

      {partida.recurrenciaGrupoId && (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2 mb-4">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Historial de esta serie</p>
          {historial ? (
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">
              prom. real {formatMXN(historial.promedio)}
              <span className="text-slate-400 dark:text-slate-500 font-normal text-xs"> ± {formatMXN(historial.desviacion)} ({historial.n} quincenas)</span>
            </p>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">Historial insuficiente</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Original</p>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(original)}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">plan al crear la línea</p>
        </div>
        <div className={`rounded-xl px-3 py-2 ${fueRevisado ? 'bg-indigo-50 dark:bg-indigo-950/30 ring-1 ring-indigo-100 dark:ring-indigo-900/60' : 'bg-slate-50 dark:bg-slate-700/40'}`}>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Vigente</p>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(presupuestado)}</p>
          {fueRevisado ? (
            <p className={`text-[10px] font-medium ${ajusteAcumulado > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatDelta(ajusteAcumulado)}{ajustePct != null ? ` (${ajustePct > 0 ? '+' : ''}${ajustePct.toFixed(1)}%)` : ''} vs original
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">sin ajustes</p>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Real</p>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatMXN(partida.real)}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            {ejecucionVigentePct != null ? `${ejecucionVigentePct.toFixed(0)}% del vigente` : 'sin base vigente'}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {restante < 0 ? 'Excedido' : 'Restante'}
          </p>
          <p className={`text-sm font-bold tabular-nums ${restante < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {formatMXN(Math.abs(restante))}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">contra vigente</p>
        </div>
      </div>

      {fueRevisado && (
        <div className={`mb-3 rounded-xl border px-3 py-2.5 ${desviacionOriginal > 0 ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20' : 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/20'}`}>
          <p className={`text-xs font-medium ${desviacionOriginal > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
            {ejecucionVigentePct != null ? `Has usado ${ejecucionVigentePct.toFixed(0)}% del presupuesto vigente.` : 'Presupuesto vigente ajustado.'}
            {' '}Frente al plan original, el real está {desviacionOriginal >= 0 ? 'arriba' : 'abajo'} por {formatMXN(Math.abs(desviacionOriginal))}
            {desviacionOriginalPct != null ? ` (${Math.abs(desviacionOriginalPct).toFixed(1)}%)` : ''}.
          </p>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setHistorialPresupuestoAbierto(v => !v)}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
          aria-expanded={historialPresupuestoAbierto}
        >
          <div className="flex items-center gap-2 min-w-0">
            <History size={14} className="text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Historial del presupuesto</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {historialPresupuestoLoading
                  ? 'Cargando cambios…'
                  : historialPresupuestoError
                    ? 'No se pudo cargar'
                    : `${historialPresupuesto?.cambios.length ?? 0} evento${(historialPresupuesto?.cambios.length ?? 0) === 1 ? '' : 's'} · ajuste neto ${formatDelta(ajusteAcumulado)}`}
              </p>
            </div>
          </div>
          {historialPresupuestoAbierto ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
        </button>

        {historialPresupuestoAbierto && (
          <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-3 bg-slate-50/60 dark:bg-slate-900/20">
            {historialPresupuestoLoading ? (
              <div className="py-4 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Cargando historial…
              </div>
            ) : historialPresupuestoError ? (
              <p className="py-3 text-xs text-rose-600 dark:text-rose-400 text-center">No se pudo cargar el historial de esta partida.</p>
            ) : !historialPresupuesto || historialPresupuesto.cambios.length === 0 ? (
              <p className="py-3 text-xs text-slate-400 dark:text-slate-500 text-center">Sin eventos registrados.</p>
            ) : (
              <ol className="space-y-0">
                {historialPresupuesto.cambios.map((cambio, index) => {
                  const positivo = cambio.delta > 0.005
                  const negativo = cambio.delta < -0.005
                  return (
                    <li key={cambio.id} className="relative pl-6 pb-4 last:pb-0">
                      {index < historialPresupuesto.cambios.length - 1 && (
                        <span className="absolute left-[6px] top-3 bottom-0 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
                      )}
                      <span className={`absolute left-0 top-1.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-slate-800 ${positivo ? 'bg-amber-400' : negativo ? 'bg-emerald-500' : 'bg-indigo-400'}`} aria-hidden />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{etiquetaCambio(cambio)}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {formatTimestamp(cambio.fechaCreacion)}{cambio.actor ? ` · ${cambio.actor}` : ''}
                          </p>
                          {cambio.motivo && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 break-words">{cambio.motivo}</p>
                          )}
                          {cambio.tipo === 'MIGRACION_VIGENTE' && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 italic">La fecha corresponde al backfill; Milo no conoce cuándo ocurrió el ajuste histórico original.</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-xs font-bold tabular-nums ${positivo ? 'text-amber-600 dark:text-amber-400' : negativo ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                            {cambio.tipo === 'CREACION' ? formatMXN(cambio.montoNuevo) : formatDelta(cambio.delta)}
                          </p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">queda {formatMXN(cambio.montoNuevo)}</p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
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

      <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-700">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-2">
          <MessageSquare size={13} /> Comentarios
        </p>

        {comentariosLoading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Cargando...</p>
        ) : comentarios.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-3">Sin comentarios todavía.</p>
        ) : (
          <ul className="space-y-2 mb-3 max-h-56 overflow-y-auto pr-1">
            {comentarios.map(c => (
              <li key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{c.user?.nombre ?? 'Sin usuario'}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{formatTimestamp(c.fechaCreacion)}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap break-words">{c.texto}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <select value={nuevoUserId} onChange={e => setNuevoUserId(e.target.value)}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">¿Quién comenta?</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <div className="flex gap-2">
            <textarea value={nuevoTexto} onChange={e => setNuevoTexto(e.target.value)} rows={2}
              placeholder="Escribe un comentario..."
              className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
            <button onClick={enviarComentario} disabled={enviandoComentario || !nuevoTexto.trim()} aria-label="Enviar comentario"
              className="self-end px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 cursor-pointer transition-colors">
              {enviandoComentario ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
