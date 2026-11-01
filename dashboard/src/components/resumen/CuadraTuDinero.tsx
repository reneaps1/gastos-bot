import Link from 'next/link'
import { ArrowRight, ChevronDown, Droplets } from 'lucide-react'
import { formatDate, formatMXN } from '@/lib/utils'
import type { Cuadre } from '@/lib/presupuesto-totales'

// Panel "¿Cuadra tu dinero?". Una sola pieza para las dos pantallas que lo
// muestran, asi el Inicio no puede decir otra cosa que Presupuesto > Tabla:
//   - variant="full": el panel de Tabla tal cual (tres celdas a la vista).
//   - variant="hero": el veredicto del Inicio. La frase va primero, la
//     comparacion contra el presupuesto en una pastilla y las celdas detras de
//     "Ver como se calcula". Sin corte cae al lado "segun tu presupuesto".
// La matematica no vive aqui: llega hecha en `cuadre` (calcularCuadre).

// A partir de cuantos dias el corte ya no sirve para un veredicto confiable.
export const DIAS_CORTE_VIEJO = 3

interface Props {
  variant: 'full' | 'hero'
  // null = no hay corte de liquidez (no hay lado "real").
  cuadre: Cuadre | null
  fechaCorte: string | null
  // Solo hero: respaldo sin corte (calcularLibreDeQuincena) y enlaces.
  teorico?: number | null
  corteDias?: number | null
  quincenaId?: string
}

// Regla unica de saldo: el monto va sin signo y una palabra dice si sobra o
// falta. Con los dos lados en negativo, "+$50" o "deberia faltarte" obligaban
// a comparar dos faltantes y adivinar el sentido.
function Pill({ n }: { n: number }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium border ${n < 0
      ? 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-800/40'
      : 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800/40'}`}>
      {n < 0 ? 'Falta' : 'Sobra'}
    </span>
  )
}

function tone(n: number) {
  return n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
}

function Titular({ real, className }: { real: number; className: string }) {
  return (
    <p className={className}>
      <span className={`font-bold tabular-nums ${tone(real)}`}>{real < 0 ? 'Te faltan' : 'Te sobran'} {formatMXN(Math.abs(real))}</span>{' '}
      {real < 0 ? 'para cubrir lo que te queda por pagar esta quincena.' : 'después de pagar todo lo pendiente.'}
    </p>
  )
}

function CeldaCuentas({ cuadre }: { cuadre: Cuadre }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Según tus cuentas</p>
      <p className="flex items-center gap-2 mt-0.5">
        <Pill n={cuadre.real} />
        <span className={`text-xl font-bold tabular-nums ${tone(cuadre.real)}`}>{formatMXN(Math.abs(cuadre.real))}</span>
      </p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums mt-0.5">{formatMXN(cuadre.enCuentas)} en cuentas − {formatMXN(cuadre.porPagar)} por pagar</p>
    </div>
  )
}

function CeldaPresupuesto({ cuadre }: { cuadre: Cuadre }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Según tu presupuesto</p>
      <p className="flex items-center gap-2 mt-0.5">
        <Pill n={cuadre.teorico} />
        <span className={`text-xl font-bold tabular-nums ${tone(cuadre.teorico)}`}>{formatMXN(Math.abs(cuadre.teorico))}</span>
      </p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums mt-0.5">{formatMXN(cuadre.ingresos)} ingresos − {formatMXN(cuadre.comprometido)} comprometido</p>
    </div>
  )
}

function textoContra(cuadre: Cuadre) {
  return cuadre.cuadra ? '✓ Cuadra' : `Vas ${formatMXN(Math.abs(cuadre.delta))} ${cuadre.mejor ? 'mejor' : 'peor'}`
}

function textoPista(cuadre: Cuadre) {
  return cuadre.cuadra
    ? 'Tus cuentas coinciden con el presupuesto.'
    : cuadre.mejor
      ? 'Tienes más en cuentas de lo que el presupuesto calcula.'
      : 'Tienes menos en cuentas de lo que el presupuesto calcula.'
}

function textoCausa(cuadre: Cuadre) {
  return cuadre.mejor
    ? 'Suele ser saldo que traías de quincenas anteriores o un ingreso sin registrar.'
    : 'Suele ser un gasto sin registrar, un cargo pendiente o un corte de liquidez desactualizado.'
}

export function CuadraTuDinero(props: Props) {
  return props.variant === 'full' ? <CuadraFull {...props} /> : <CuadraHero {...props} />
}

function CuadraFull({ cuadre, fechaCorte }: Props) {
  if (!cuadre) return null
  const bien = cuadre.cuadra || cuadre.mejor
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">¿Cuadra tu dinero?</h3>
        {fechaCorte && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">corte del {formatDate(fechaCorte)}</span>
        )}
      </div>
      <Titular real={cuadre.real} className="text-base md:text-lg text-slate-700 dark:text-slate-200 mb-3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CeldaCuentas cuadre={cuadre} />
        <CeldaPresupuesto cuadre={cuadre} />
        <div className={`rounded-xl p-3 ring-1 ${bien
          ? 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-800/50'
          : 'bg-amber-50 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800/50'}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Contra tu presupuesto</p>
          <p className={`text-xl font-bold tabular-nums mt-0.5 ${bien ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {textoContra(cuadre)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{textoPista(cuadre)}</p>
        </div>
      </div>
      {!cuadre.cuadra && (
        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">{textoCausa(cuadre)}</p>
      )}
    </div>
  )
}

function CuadraHero({ cuadre, fechaCorte, teorico, corteDias, quincenaId }: Props) {
  const corteHref = quincenaId ? `/configuracion/liquidez?quincenaId=${quincenaId}` : '/configuracion/liquidez'
  const corteViejo = corteDias != null && corteDias >= DIAS_CORTE_VIEJO

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">¿Cuadra tu dinero?</h2>
        {cuadre && fechaCorte && (
          corteViejo ? (
            <Link href={corteHref} className="inline-flex min-h-[44px] sm:min-h-0 items-center justify-end text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:underline text-right">
              corte de hace {corteDias} días · Actualizar
            </Link>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">corte del {formatDate(fechaCorte)}</span>
          )
        )}
      </div>

      {cuadre ? (
        <>
          <Titular real={cuadre.real} className="text-lg md:text-xl text-slate-700 dark:text-slate-200" />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 tabular-nums ${cuadre.cuadra || cuadre.mejor
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50'
              : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50'}`}>
              Contra tu presupuesto: {textoContra(cuadre)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {textoPista(cuadre)}{!cuadre.cuadra && <> {textoCausa(cuadre)}</>}
          </p>

          <details className="group mt-3">
            <summary className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1 cursor-pointer list-none text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 [&::-webkit-details-marker]:hidden">
              Ver cómo se calcula
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CeldaCuentas cuadre={cuadre} />
              <CeldaPresupuesto cuadre={cuadre} />
            </div>
          </details>
        </>
      ) : teorico != null ? (
        // Sin corte: el mismo respaldo que Tabla (tarjeta "Libre / sin
        // asignar"). Sin la foto de cuentas no se puede decir si alcanza.
        <>
          <p className="text-lg md:text-xl text-slate-700 dark:text-slate-200">
            Según tu presupuesto:{' '}
            <span className={`font-bold tabular-nums ${tone(teorico)}`}>{teorico < 0 ? 'Falta' : 'Sobra'} {formatMXN(Math.abs(teorico))}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Captura tu corte de cuentas para saber si te alcanza.
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-400 dark:text-slate-500">Sin datos de la quincena.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={corteHref}
          className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          <Droplets size={13} /> {cuadre ? 'Actualizar corte' : 'Capturar corte'}
        </Link>
        <Link href="/presupuesto"
          className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400">
          Abrir en Tabla <ArrowRight size={12} />
        </Link>
      </div>

      {/* En el telefono el boton principal del encabezado baja aqui, a ancho
          completo, para quedar al alcance del pulgar justo bajo el veredicto. */}
      <Link href="/presupuesto"
        className="sm:hidden mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
        Abrir en Tabla <ArrowRight size={14} />
      </Link>
    </section>
  )
}
