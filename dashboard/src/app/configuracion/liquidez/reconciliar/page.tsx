'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'

import { FormModal } from '@/components/ui/FormModal'
import { useToast } from '@/components/Toast'
import { formatDate, formatMXN } from '@/lib/utils'
import { getMexicoDateString } from '@/lib/quincena-selection'

interface Categoria {
  id: number
  nombre: string
  tipo: string
}

interface MovimientoCaja {
  ingresos: number
  gastos: number
  ahorroAportes: number
  ahorroRetiros: number
  pagosCredito: number
  neto: number
}

interface ReconciliacionData {
  quincena: { id: number; codigo: string; fechaInicio: string; fechaFin: string }
  snapshot: null | {
    id: number
    fechaCorte: string
    saldoCorte: number
    saldoEstimadoHoy: number
    movimientosDesdeCorte: MovimientoCaja
  }
  snapshotApertura?: null | {
    id: number
    fechaCorte: string
    saldoCapturado: number
    saldoAperturaEstimado: number | null
    movimientosHastaApertura: MovimientoCaja | null
  }
  plan: {
    ingresosRegistrados: number
    ingresosPagados: number
    ingresosPorCobrar: number
    totalComprometido: number
    margenPlan: number
  }
  pagos: {
    pagosQuincena: number
    desglose: {
      pendientesDirectos: number
      abonosCredito: number
      presupuestoNoEjecutado: number
    }
    ahorroPendiente: number
    pagosPorSalir?: number
  }
  ingresosPendientes: Array<{
    id: number
    fecha: string
    descripcion: string
    monto: number
    categoria: { nombre: string }
  }>
  caja: null | {
    saldoProyectadoCierre: number
    resultadoCajaQuincena: number | null
    diferenciaVsPlan: number | null
    cuadraConPlan: boolean | null
  }
  diagnostico: null | {
    movimientosOtraQuincenaNeto: number
    movimientosOtraQuincena: Array<{
      id: number
      fecha: string
      quincenaId: number
      descripcion: string
      tipo: string
      direccion: string | null
      monto: number
      categoria: { nombre: string }
      quincena: { codigo: string }
    }>
    creditoArrastrado: number
    creditoDiferidoActual: number
    ajustesTiming: number
    residual: number | null
    descuadreCorte: null | {
      snapshotAnteriorId: number
      fechaCorteAnterior: string
      saldoAnterior: number
      saldoEsperado: number
      saldoActual: number
      diferencia: number
      movimientos: MovimientoCaja
    }
    requiereAccion: boolean
  }
}

function moneyTone(value: number) {
  if (Math.abs(value) < 1) return 'text-emerald-600 dark:text-emerald-400'
  return value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
}

function MiniCard({ label, value, hint, tone = 'neutral' }: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const toneClass = {
    neutral: 'text-slate-900 dark:text-slate-100',
    good: 'text-emerald-700 dark:text-emerald-300',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-rose-700 dark:text-rose-300',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

function ConciliarContent() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const quincenaId = searchParams.get('quincenaId') ?? ''
  const [data, setData] = useState<ReconciliacionData | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [ajusteOpen, setAjusteOpen] = useState(false)
  const [ajusteCategoriaId, setAjusteCategoriaId] = useState('')
  const [ajusteDescripcion, setAjusteDescripcion] = useState('')
  const [ajusteSaving, setAjusteSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!quincenaId) { setLoading(false); return }
    setLoading(true)
    try {
      const [res, catRes] = await Promise.all([
        fetch(`/api/liquidez/reconciliacion-plan-caja?quincenaId=${quincenaId}`),
        fetch('/api/categorias'),
      ])
      if (!res.ok) throw new Error()
      setData(await res.json())
      setCategorias(await catRes.json())
    } catch {
      toast('No se pudo calcular la reconciliación', 'error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [quincenaId, toast])

  useEffect(() => { void fetchData() }, [fetchData])

  const residual = data?.diagnostico?.residual ?? null
  const tipoAjuste: 'Gasto' | 'Ingreso' = (residual ?? 0) < 0 ? 'Gasto' : 'Ingreso'
  const montoAjuste = Math.abs(residual ?? 0)

  const categoriasAjuste = useMemo(
    () => categorias.filter(c => c.tipo === tipoAjuste),
    [categorias, tipoAjuste],
  )

  async function marcarCobrado(id: number) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/transacciones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estatus: 'Pagado' }),
      })
      if (!res.ok) throw new Error()
      toast('Ingreso marcado como cobrado')
      await fetchData()
    } catch {
      toast('No se pudo actualizar el ingreso', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function moverAQActual(id: number) {
    if (!data) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/transacciones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quincenaId: data.quincena.id, presupuestoId: null }),
      })
      if (!res.ok) throw new Error()
      toast(`Movimiento reasignado a ${data.quincena.codigo}`)
      await fetchData()
    } catch {
      toast('No se pudo mover la transacción', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function openAjuste() {
    if (!data || residual == null || Math.abs(residual) < 1) return
    setAjusteCategoriaId('')
    setAjusteDescripcion(
      residual < 0
        ? `Gasto faltante detectado en reconciliación ${data.quincena.codigo}`
        : `Ingreso faltante detectado en reconciliación ${data.quincena.codigo}`,
    )
    setAjusteOpen(true)
  }

  async function guardarAjuste() {
    if (!data || !ajusteCategoriaId || residual == null) return
    setAjusteSaving(true)
    try {
      const res = await fetch('/api/transacciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: getMexicoDateString(),
          quincenaId: data.quincena.id,
          descripcion: ajusteDescripcion.trim() || `${tipoAjuste} faltante de reconciliación`,
          categoriaId: ajusteCategoriaId,
          tipo: tipoAjuste,
          monto: montoAjuste,
          estatus: 'Pagado',
          source: 'ajuste-reconciliacion',
        }),
      })
      if (!res.ok) throw new Error()
      toast('Movimiento de ajuste registrado')
      setAjusteOpen(false)
      await fetchData()
    } catch {
      toast('No se pudo registrar el ajuste', 'error')
    } finally {
      setAjusteSaving(false)
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-sm text-slate-400">Calculando reconciliación...</div>
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
        <p className="text-sm text-slate-500">No se pudo cargar la reconciliación.</p>
        <Link href="/" className="mt-3 inline-flex text-sm font-semibold text-indigo-600 hover:underline">Volver al dashboard</Link>
      </div>
    )
  }

  if (!data.snapshot || !data.caja) {
    return (
      <div className="space-y-5">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"><ArrowLeft size={14} /> Dashboard</Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800/50 dark:bg-amber-950/20">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">No hay corte de liquidez para {data.quincena.codigo}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Sin una fotografía de tus cuentas no podemos reconciliar el plan con la caja.</p>
          <Link href={`/configuracion/liquidez?quincenaId=${data.quincena.id}`} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Capturar corte <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    )
  }

  const diferencia = data.caja.diferenciaVsPlan
  const diferenciaAbs = Math.abs(diferencia ?? 0)
  const descuadreCorte = data.diagnostico?.descuadreCorte?.diferencia ?? 0
  const movimientosPost = data.snapshot.movimientosDesdeCorte
  const tieneMovimientosPost = Math.abs(movimientosPost.neto) >= 0.01

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"><ArrowLeft size={14} /> Dashboard</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">Reconciliar plan y caja · {data.quincena.codigo}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Aquí Milo explica la diferencia y te da acciones para corregir datos cuando sí hay un error.</p>
        </div>
        <button onClick={() => void fetchData()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <RefreshCw size={14} /> Recalcular
        </button>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Caja real proyectada</p>
          <p className="mt-2 text-4xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatMXN(data.caja.saldoProyectadoCierre)}</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Esto es lo que Milo estima que habrá físicamente en tus cuentas al cerrar la quincena.</p>
        </div>
        <div className={`rounded-2xl border p-5 ${data.caja.cuadraConPlan ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20'}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Plan vs caja de esta quincena</p>
          <p className={`mt-2 text-3xl font-bold tabular-nums ${data.caja.cuadraConPlan ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {diferencia == null ? 'Sin base' : formatMXN(diferenciaAbs)}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {diferencia == null
              ? 'Falta un corte anterior al inicio de la quincena para comparar el resultado de caja contra el plan.'
              : data.caja.cuadraConPlan
                ? 'Cuadra: el resultado de caja de la quincena coincide con el margen del plan.'
                : diferencia < 0
                  ? 'La quincena está dejando menos dinero en caja de lo que el plan dice.'
                  : 'La quincena está dejando más dinero en caja de lo que el plan dice.'}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <WalletCards size={18} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">1. Cómo llega Milo a “te va a quedar”</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MiniCard label="Saldo del corte" value={formatMXN(data.snapshot.saldoCorte)} hint={`Corte ${formatDate(data.snapshot.fechaCorte)}`} />
          <MiniCard label="± Desde el corte" value={formatMXN(movimientosPost.neto)} hint="Movimientos pagados posteriores al corte." tone={movimientosPost.neto < 0 ? 'bad' : movimientosPost.neto > 0 ? 'good' : 'neutral'} />
          <MiniCard label="Saldo estimado hoy" value={formatMXN(data.snapshot.saldoEstimadoHoy)} hint="Corte actualizado con el ledger." />
          <MiniCard label="+ Por cobrar" value={formatMXN(data.plan.ingresosPorCobrar)} hint="Ingresos todavía pendientes." tone={data.plan.ingresosPorCobrar > 0 ? 'good' : 'neutral'} />
          <MiniCard label="− Por salir" value={formatMXN(data.pagos.pagosPorSalir ?? (data.pagos.pagosQuincena + data.pagos.ahorroPendiente))} hint="Gasto, crédito y ahorro pendiente." tone="warn" />
          <MiniCard label="= Cierre proyectado" value={formatMXN(data.caja.saldoProyectadoCierre)} hint="Dinero físico estimado al cierre." tone={data.caja.saldoProyectadoCierre < 0 ? 'bad' : 'good'} />
        </div>
        {tieneMovimientosPost && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/20 dark:text-blue-300">
            Tu corte no es la última foto del ledger. Milo ya incorporó después del corte: +{formatMXN(movimientosPost.ingresos)} ingresos, −{formatMXN(movimientosPost.gastos)} gastos, −{formatMXN(movimientosPost.ahorroAportes)} ahorro, +{formatMXN(movimientosPost.ahorroRetiros)} retiros de ahorro y −{formatMXN(movimientosPost.pagosCredito)} pagos de crédito.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">2. Comparación correcta: resultado de Q vs plan</h2>
        </div>
        {data.snapshotApertura?.saldoAperturaEstimado == null ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
            No existe un corte anterior al inicio de {data.quincena.codigo}. Sin saldo de apertura, comparar directamente “ingreso sin destino” contra saldo de cuentas no es contablemente válido.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniCard label="Saldo de apertura" value={formatMXN(data.snapshotApertura.saldoAperturaEstimado)} hint="Lo que ya traías antes de esta quincena." />
            <MiniCard label="Cierre proyectado" value={formatMXN(data.caja.saldoProyectadoCierre)} hint="Lo que estimamos tendrás al terminar." />
            <MiniCard label="Resultado de esta Q" value={formatMXN(data.caja.resultadoCajaQuincena ?? 0)} hint="Cierre menos saldo de apertura." tone={(data.caja.resultadoCajaQuincena ?? 0) < 0 ? 'bad' : 'good'} />
            <MiniCard label="Margen del plan" value={formatMXN(data.plan.margenPlan)} hint="Ingreso de la Q que quedó sin compromiso." tone={data.plan.margenPlan < 0 ? 'bad' : 'neutral'} />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">3. Qué puede estar explicando la diferencia</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Milo separa desfases legítimos de datos que sí requieren corrección.</p>
          </div>
          {data.caja.cuadraConPlan && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><CheckCircle2 size={12} /> Cuadra</span>}
        </div>

        <div className="mt-4 space-y-3">
          {(data.diagnostico?.creditoArrastrado ?? 0) > 0 && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex gap-3">
                <CreditCard size={18} className="mt-0.5 text-violet-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pagos de compras de otras quincenas</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Salen de caja en {data.quincena.codigo}, pero el gasto se originó en otra quincena. Es un desfase de timing, no necesariamente un error.</p>
                </div>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-rose-600">−{formatMXN(data.diagnostico?.creditoArrastrado ?? 0)}</span>
            </div>
          )}

          {(data.diagnostico?.creditoDiferidoActual ?? 0) > 0 && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex gap-3">
                <CreditCard size={18} className="mt-0.5 text-blue-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Compras de esta Q que se pagarán después</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">El plan reserva el gasto completo, pero parte del efectivo saldrá en futuras quincenas.</p>
                </div>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-blue-600">+{formatMXN(data.diagnostico?.creditoDiferidoActual ?? 0)}</span>
            </div>
          )}

          {(data.diagnostico?.movimientosOtraQuincena?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-800/40 dark:bg-amber-950/10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Movimientos ocurridos en estas fechas, asignados a otra quincena</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Si la quincena está mal, puedes corregirla aquí. Si es intencional, déjalo como está.</p>
                </div>
                <span className={`shrink-0 font-bold tabular-nums ${moneyTone(data.diagnostico?.movimientosOtraQuincenaNeto ?? 0)}`}>{formatMXN(data.diagnostico?.movimientosOtraQuincenaNeto ?? 0)}</span>
              </div>
              <div className="mt-3 space-y-2">
                {data.diagnostico?.movimientosOtraQuincena.slice(0, 8).map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs dark:bg-slate-900/50">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-700 dark:text-slate-200">{tx.descripcion}</p>
                      <p className="text-slate-400">{formatDate(tx.fecha)} · {tx.quincena.codigo} · {tx.categoria.nombre}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold tabular-nums">{formatMXN(tx.monto)}</span>
                      <button disabled={busyId === tx.id} onClick={() => void moverAQActual(tx.id)} className="rounded-md border border-slate-200 px-2 py-1 font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-indigo-950/20">Mover a {data.quincena.codigo}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Math.abs(descuadreCorte) >= 1 && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-800/50 dark:bg-rose-950/15">
              <div className="flex gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-rose-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">El último corte no cuadra con el corte anterior y los movimientos registrados</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Esto sí apunta a un movimiento faltante o a un saldo capturado incorrectamente.</p>
                </div>
              </div>
              <span className={`shrink-0 font-bold tabular-nums ${descuadreCorte < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{formatMXN(Math.abs(descuadreCorte))}</span>
            </div>
          )}

          {(data.diagnostico?.residual != null && Math.abs(data.diagnostico.residual) >= 1) && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800/60 dark:bg-rose-950/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">Quedan {formatMXN(Math.abs(data.diagnostico.residual))} sin explicar</p>
                  <p className="mt-1 max-w-2xl text-xs text-rose-700/80 dark:text-rose-300/80">Primero verifica que el corte sea correcto. Si el dinero realmente salió o entró y no existe transacción, registra el movimiento faltante para que plan y caja puedan cuadrar.</p>
                </div>
                <button onClick={openAjuste} className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700">Registrar {tipoAjuste.toLowerCase()} faltante</button>
              </div>
            </div>
          )}

          {(data.diagnostico?.residual != null && Math.abs(data.diagnostico.residual) < 1 && !data.caja.cuadraConPlan) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300">
              La diferencia restante ya está explicada por timing entre quincenas/crédito. No hace falta inventar una transacción de ajuste.
            </div>
          )}
        </div>
      </section>

      {data.ingresosPendientes.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2">
            <Clock3 size={18} className="text-emerald-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ingresos pendientes de cobrar</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Solo marca “Cobrado” si el dinero ya entró realmente a tus cuentas.</p>
          <div className="mt-3 space-y-2">
            {data.ingresosPendientes.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{i.descripcion}</p>
                  <p className="text-xs text-slate-400">{formatDate(i.fecha)} · {i.categoria.nombre}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold tabular-nums text-emerald-600">{formatMXN(i.monto)}</span>
                  <button disabled={busyId === i.id} onClick={() => void marcarCobrado(i.id)} className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/20">Marcar cobrado</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={`/configuracion/liquidez?quincenaId=${data.quincena.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <WalletCards size={14} /> Revisar / actualizar corte
        </Link>
        <Link href="/transacciones" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <CircleDollarSign size={14} /> Ver transacciones
        </Link>
        <Link href="/creditos" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <CreditCard size={14} /> Revisar créditos
        </Link>
      </div>

      <FormModal open={ajusteOpen} onOpenChange={setAjusteOpen} title={`Registrar ${tipoAjuste.toLowerCase()} faltante`}>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
            Este ajuste crea una transacción real por {formatMXN(montoAjuste)}. Úsalo solo si verificaste el corte y confirmaste que el movimiento ocurrió pero nunca se registró.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Descripción</label>
            <input value={ajusteDescripcion} onChange={e => setAjusteDescripcion(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Categoría *</label>
            <select value={ajusteCategoriaId} onChange={e => setAjusteCategoriaId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-100">
              <option value="">Seleccionar...</option>
              {categoriasAjuste.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAjusteOpen(false)} disabled={ajusteSaving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancelar</button>
            <button onClick={() => void guardarAjuste()} disabled={ajusteSaving || !ajusteCategoriaId} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{ajusteSaving ? 'Guardando...' : 'Registrar ajuste'}</button>
          </div>
        </div>
      </FormModal>
    </div>
  )
}

export default function ConciliarPlanCajaPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-slate-400">Cargando...</div>}>
      <ConciliarContent />
    </Suspense>
  )
}
