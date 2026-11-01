'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CloudOff,
  Droplets,
  Gauge,
  ReceiptText,
} from 'lucide-react'

import { QuincenaStatus } from '@/components/ui/QuincenaStatus'
import { CierreQuincenaWizard } from '@/components/ui/CierreQuincenaWizard'
import { CuadraTuDinero, DIAS_CORTE_VIEJO } from '@/components/resumen/CuadraTuDinero'
import { ResumenKpis } from '@/components/resumen/ResumenKpis'
import { cuentaParaAgregados } from '@/lib/cierre-quincena'
import { getDefaultQuincenaId, getMexicoDateString, getQuincenaIdForDate } from '@/lib/quincena-selection'
import { useResumenQuincena, type ResumenQuincena } from '@/lib/useResumenQuincena'
import { formatDate, formatDateStr, formatMXN } from '@/lib/utils'
import type { GrupoCierre } from '@/lib/cierre-quincena'

// Inicio "de un vistazo": un resumen de Presupuesto > Tabla. Misma quincena
// (getDefaultQuincenaId, la regla de Tabla), mismas funciones y mismos
// componentes, asi que ningun numero de aqui puede contradecir a Tabla.
//
//   0. Encabezado de la quincena + "Abrir en Tabla"
//   1. ¿Cuadra tu dinero? (el veredicto)
//   2. Las 4 tarjetas de Tabla
//   3. Pendientes: solo lo que se puede resolver, cada fila lleva a resolverlo
//   4. Actividad reciente
//   5. Mas vistas
//
// Lo que antes vivia aqui y ya no (pastilla "Critico", "Caja proyectada",
// "Reconciliacion plan vs caja", Tendencia) sigue alcanzable desde el pie.

interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}

export default function DashboardPage() {
  const [quincenasRaw, setQuincenas] = useState<Quincena[] | null>(null)
  const [quincenaId, setQuincenaId] = useState('')
  const [quincenasError, setQuincenasError] = useState(false)
  const [wizardCierreOpen, setWizardCierreOpen] = useState(false)
  const today = getMexicoDateString()

  useEffect(() => {
    let cancelado = false
    fetch('/api/quincenas')
      .then(r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((items: Quincena[]) => {
        if (cancelado) return
        setQuincenas(items)
        // La misma regla que Presupuesto > Tabla: la quincena de hoy, no la
        // ultima elegida en otra pantalla.
        setQuincenaId(getDefaultQuincenaId(items))
      })
      .catch(() => { if (!cancelado) setQuincenasError(true) })
    return () => { cancelado = true }
  }, [])

  const { cargando, error, resumen, gruposCierre, cierreError, recargar } = useResumenQuincena(quincenaId, today)
  const quincenas = quincenasRaw ?? []
  const sinQuincenas = quincenasRaw != null && !quincenaId

  const qActual = quincenas.find(q => q.id.toString() === quincenaId) ?? null
  const quincenaActualIdCierre = getQuincenaIdForDate(quincenas, today)
  const quincenaActualCierre = quincenas.find(q => q.id.toString() === quincenaActualIdCierre)

  if (quincenasError) {
    return <ErrorCarga onReintentar={() => window.location.reload()} />
  }

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Bloque 0 — Encabezado de la quincena */}
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
              {qActual ? (
                <>
                  {qActual.codigo}
                  <span className="font-medium text-slate-400 dark:text-slate-500"> · </span>
                  <span className="text-base md:text-lg font-semibold text-slate-500 dark:text-slate-400">
                    {formatDateStr(qActual.fechaInicio, { day: '2-digit', month: 'short' })}
                    {' – '}
                    {formatDateStr(qActual.fechaFin, { day: '2-digit', month: 'short' })}
                  </span>
                </>
              ) : 'Inicio'}
            </h1>
          </div>
          <Link
            href="/presupuesto"
            className="hidden sm:inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Abrir en Tabla <ArrowRight size={14} />
          </Link>
        </div>
        {quincenas.length > 0 && <QuincenaStatus quincenas={quincenas} selectedId={quincenaId} today={today} />}
      </section>

      {sinQuincenas ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-sm text-slate-500 dark:text-slate-400">
          No hay quincenas configuradas. Agrégalas en <Link href="/configuracion/quincenas" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Configuración → Períodos de pago</Link>.
        </p>
      ) : cargando ? (
        <InicioSkeleton />
      ) : error || !resumen ? (
        <ErrorCarga onReintentar={recargar} />
      ) : (
        <>
          {/* Bloque 1 — ¿Cuadra tu dinero? */}
          <CuadraTuDinero
            variant="hero"
            cuadre={resumen.cuadre}
            fechaCorte={resumen.liquidez?.fechaCorte ?? null}
            teorico={resumen.teorico}
            corteDias={resumen.corteDias}
            quincenaId={quincenaId}
          />

          {/* Bloque 2 — Las 4 tarjetas de Tabla */}
          <ResumenKpis
            ingresoReal={resumen.ingresoReal}
            ingresoPresupuestado={resumen.ingresoPresupuestado}
            gastoReal={resumen.gastoReal}
            gastoPresupuestado={resumen.gastoPresupuestado}
            gastoFaltaPorPagar={resumen.gastoFaltaPorPagar}
            balancePresupuestado={resumen.balancePresupuestado}
            mostrarEnCuentas
            liquidez={resumen.liquidez}
            capturarCorteHref={`/configuracion/liquidez?quincenaId=${quincenaId}`}
          />

          {/* Bloques 3 y 4 comparten fila en escritorio */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Pendientes
              resumen={resumen}
              gruposCierre={gruposCierre}
              cierreError={cierreError}
              onReintentarCierre={recargar}
              codigo={qActual?.codigo ?? ''}
              quincenaId={quincenaId}
              onCerrar={() => setWizardCierreOpen(true)}
            />
            <ActividadReciente resumen={resumen} />
          </div>
        </>
      )}

      {/* Bloque 5 — Mas vistas */}
      <MasVistas quincenaId={quincenaId} />

      {/* El asistente abre aqui mismo: el boton de /presupuesto solo ve las
          quincenas que tiene cargadas, no todo el historial. */}
      <CierreQuincenaWizard
        open={wizardCierreOpen}
        onOpenChange={setWizardCierreOpen}
        grupos={gruposCierre ?? []}
        quincenaActualId={quincenaActualCierre ? quincenaActualCierre.id : null}
        quincenaActualCodigo={quincenaActualCierre?.codigo}
        onResuelto={recargar}
      />
    </div>
  )
}

// ── Bloque 3 ────────────────────────────────────────────────────────────────

function Pendientes({
  resumen,
  gruposCierre,
  cierreError,
  onReintentarCierre,
  codigo,
  quincenaId,
  onCerrar,
}: {
  resumen: ResumenQuincena
  gruposCierre: GrupoCierre[] | null
  cierreError: boolean
  onReintentarCierre: () => void
  codigo: string
  quincenaId: string
  onCerrar: () => void
}) {
  const gastoLineas = resumen.presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const pasadas = gastoLineas.filter(p => p.excedido > 0)
  const arriba80 = gastoLineas.filter(p => p.excedido <= 0 && p.pct > 80)
  const totalCierre = (gruposCierre ?? []).reduce((s, g) => s + g.total, 0)
  const corteHref = `/configuracion/liquidez?quincenaId=${quincenaId}`

  const filas: React.ReactNode[] = []

  if (resumen.sinPartida.cantidad > 0) {
    filas.push(
      <FilaPendiente
        key="sin-partida"
        href="/presupuesto"
        icon={<ReceiptText size={16} />}
        tone="warn"
        title={plural(resumen.sinPartida.cantidad, 'movimiento sin partida', 'movimientos sin partida')}
        detail={resumen.sinPartida.monto > 0 ? `${formatMXN(resumen.sinPartida.monto)} fuera de plan` : undefined}
        accion="Asignar"
      />,
    )
  }

  if (pasadas.length > 0 || arriba80.length > 0) {
    filas.push(
      <FilaPendiente
        key="partidas"
        href="/presupuesto"
        icon={pasadas.length > 0 ? <AlertTriangle size={16} /> : <Gauge size={16} />}
        tone={pasadas.length > 0 ? 'bad' : 'warn'}
        title={pasadas.length > 0
          ? plural(pasadas.length, 'partida se pasó', 'partidas se pasaron')
          : `${plural(arriba80.length, 'partida va', 'partidas van')} arriba de 80%`}
        detail={pasadas.length > 0
          ? [
              `por ${formatMXN(pasadas.reduce((s, p) => s + p.excedido, 0))} en total`,
              arriba80.length > 0 ? `${arriba80.length} más arriba de 80%` : null,
            ].filter(Boolean).join(' · ')
          : undefined}
        accion="Ver en Tabla"
      />,
    )
  }

  if (gruposCierre && gruposCierre.length > 0) {
    filas.push(
      <FilaPendiente
        key="cierre"
        onClick={onCerrar}
        icon={<CircleDollarSign size={16} />}
        tone="warn"
        title={plural(gruposCierre.length, 'quincena sin cerrar', 'quincenas sin cerrar')}
        detail={formatMXN(totalCierre)}
        accion="Cerrar"
      />,
    )
  }

  // Si no se pudo revisar el historial no se puede afirmar "nada pendiente":
  // fila neutra para reintentar en vez del aviso verde.
  if (cierreError) {
    filas.push(
      <FilaPendiente
        key="cierre-error"
        onClick={onReintentarCierre}
        icon={<CloudOff size={16} />}
        tone="neutral"
        title="No se pudo revisar quincenas anteriores"
        accion="Reintentar"
      />,
    )
  }

  if (!resumen.liquidez) {
    filas.push(
      <FilaPendiente
        key="corte"
        href={corteHref}
        icon={<Droplets size={16} />}
        tone="warn"
        title="Sin corte de cuentas"
        detail="Captúralo para saber si te alcanza"
        accion="Capturar corte"
      />,
    )
  } else if (resumen.corteDias != null && resumen.corteDias >= DIAS_CORTE_VIEJO) {
    filas.push(
      <FilaPendiente
        key="corte"
        href={corteHref}
        icon={<Droplets size={16} />}
        tone="warn"
        title={`Tu corte es de hace ${resumen.corteDias} días`}
        detail="Actualízalo para que el veredicto sea real"
        accion="Actualizar corte"
      />,
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 md:p-5">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">Pendientes</h2>
      {filas.length > 0 ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
          {filas}
          {gruposCierre == null && !cierreError && (
            <p className="py-3 text-xs text-slate-400 dark:text-slate-500">Revisando quincenas anteriores…</p>
          )}
        </div>
      ) : gruposCierre == null ? (
        <div className="h-11 rounded-xl bg-slate-100 dark:bg-slate-700/40 animate-pulse" />
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-800/40 px-4 py-3">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Nada pendiente{codigo ? ` en ${codigo}` : ''}.</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">Todo tiene partida, ninguna se pasó y el corte está al día.</p>
          </div>
        </div>
      )}
    </section>
  )
}

function FilaPendiente({
  href,
  onClick,
  icon,
  tone,
  title,
  detail,
  accion,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  tone: 'warn' | 'bad' | 'neutral'
  title: string
  detail?: string
  accion: string
}) {
  const toneClasses = tone === 'bad'
    ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/25'
    : tone === 'neutral'
      ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50'
      : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/25'

  const contenido = (
    <>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses}`}>{icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
          {detail && <span className="block text-xs text-slate-400 dark:text-slate-500 tabular-nums">{detail}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 group-hover:underline">
        {accion} <ChevronRight size={14} />
      </span>
    </>
  )
  const clase = 'group flex w-full min-h-[44px] items-center justify-between gap-3 py-2.5 text-left cursor-pointer'

  return href ? (
    <Link href={href} className={clase}>{contenido}</Link>
  ) : (
    <button type="button" onClick={onClick} className={clase}>{contenido}</button>
  )
}

// ── Bloque 4 ────────────────────────────────────────────────────────────────

function ActividadReciente({ resumen }: { resumen: ResumenQuincena }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-slate-100 dark:border-slate-700/80">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Actividad reciente</h2>
        <Link href="/transacciones" className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Ver todas <ArrowRight size={11} />
        </Link>
      </div>
      {resumen.transacciones.length === 0 ? (
        <p className="px-4 md:px-5 py-6 text-sm text-slate-400 dark:text-slate-500">Sin movimientos registrados.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
          {resumen.transacciones.slice(0, 5).map(tx => (
            <div key={tx.id} className="flex items-center justify-between gap-3 px-4 md:px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{tx.descripcion}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                  <span>{tx.categoria.nombre} · {formatDate(tx.fecha)}</span>
                  {tx.estatus === 'Pendiente' && (
                    <span className="rounded-full bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">pendiente</span>
                  )}
                  {tx.presupuestoId == null && (
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-300">sin partida</span>
                  )}
                </div>
              </div>
              <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.tipo === 'Ingreso' ? 'text-emerald-600 dark:text-emerald-400' : tx.tipo === 'Ahorro' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {tx.tipo === 'Ingreso' ? '+' : tx.tipo === 'Gasto' ? '−' : ''}{formatMXN(Number(tx.monto))}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Bloque 5 ────────────────────────────────────────────────────────────────

function MasVistas({ quincenaId }: { quincenaId: string }) {
  const links = [
    { href: '/detalle', label: 'Vista detallada' },
    { href: quincenaId ? `/configuracion/liquidez/reconciliar?quincenaId=${quincenaId}` : '/configuracion/liquidez/reconciliar', label: 'Conciliar plan y caja' },
    { href: '/configuracion/liquidez', label: 'Liquidez y cierre proyectado' },
    { href: '/presupuesto', label: 'Historial y tendencia' },
    { href: '/ahorro', label: 'Ahorro' },
  ]
  return (
    // El relleno extra cubre el area segura del iPhone, que la barra de
    // pestanas suma a su propia altura.
    <section className="pt-1 pb-[env(safe-area-inset-bottom)] md:pb-0">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Más vistas</h2>
      <div className="flex flex-wrap gap-x-4">
        {links.map(l => (
          <Link
            key={l.label}
            href={l.href}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {l.label} <ChevronRight size={14} className="text-slate-400 dark:text-slate-500" />
          </Link>
        ))}
      </div>
    </section>
  )
}

// ── Estados de carga ────────────────────────────────────────────────────────

function ErrorCarga({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-950/20 p-5">
      <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">No se pudieron cargar los datos de la quincena.</p>
      <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-300/80">Revisa tu conexión. Si sigue fallando, la base de datos puede no estar respondiendo.</p>
      <button
        type="button"
        onClick={onReintentar}
        className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-rose-200 dark:border-rose-800/60 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
      >
        Reintentar
      </button>
    </div>
  )
}

function InicioSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-200/70 dark:bg-slate-800" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
        <div className="h-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      </div>
    </div>
  )
}
