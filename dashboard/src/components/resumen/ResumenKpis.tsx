import Link from 'next/link'
import { Coins, Droplets, Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { pctColor, pctTextColor } from '@/lib/presupuesto-colores'
import { formatDate, formatMXN } from '@/lib/utils'

// Las tarjetas resumen de Presupuesto > Tabla, compartidas con el Inicio para
// que las dos pantallas muestren los mismos numeros con los mismos textos.
//
// Cada tarjeta responde una pregunta: cuanto entro, cuanto llevo pagado, si
// el plan alcanza y cuanto hay en cuentas. "Libre / sin asignar" solo aparece
// cuando quien la usa lo pide (Tabla sin panel "¿Cuadra tu dinero?": sin corte
// o con quincenas combinadas); si no, repetiria su lado "Segun tu presupuesto".

interface Props {
  ingresoReal: number
  ingresoPresupuestado: number
  // Gastos: Tabla los calcula sobre las filas filtradas; el Inicio, sobre la
  // quincena completa (no tiene filtros).
  gastoReal: number
  gastoPresupuestado: number
  gastoFaltaPorPagar: number
  // Ingreso presupuestado - gasto presupuestado, sin filtros.
  balancePresupuestado: number
  // false = no se muestra la tarjeta "En cuentas" (Tabla en modo "Todas").
  mostrarEnCuentas: boolean
  // null = no hay corte: la tarjeta invita a capturarlo.
  liquidez: { total: number; fechaCorte: string | null } | null
  enCuentasLabel?: string
  capturarCorteHref: string
  libre?: { valor: number; label: string } | null
}

export function ResumenKpis({
  ingresoReal, ingresoPresupuestado, gastoReal, gastoPresupuestado, gastoFaltaPorPagar,
  balancePresupuestado, mostrarEnCuentas, liquidez, enCuentasLabel = 'En cuentas', capturarCorteHref, libre,
}: Props) {
  const columnas = 3 + (mostrarEnCuentas ? 1 : 0) + (libre ? 1 : 0)
  return (
    <div className={`grid grid-cols-2 gap-3 ${{ 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' }[columnas]}`}>
      <KpiCard
        label="Ingresos" value={formatMXN(ingresoReal)}
        subtitle={`de ${formatMXN(ingresoPresupuestado)} presupuestado`}
        icon={<TrendingUp size={20} className="text-emerald-600 dark:text-emerald-300" />}
        color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50"
        action={(() => {
          const pct = ingresoPresupuestado > 0 ? (ingresoReal / ingresoPresupuestado) * 100 : 0
          const cumplido = pct >= 100
          return (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${cumplido ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span className={`text-[10px] font-semibold tabular-nums ${cumplido ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{pct.toFixed(0)}%</span>
            </div>
          )
        })()}
      />
      <KpiCard
        label="Gastos" value={formatMXN(gastoReal)}
        subtitle={`pagado de ${formatMXN(gastoPresupuestado)} · faltan ${formatMXN(gastoFaltaPorPagar)} por pagar`}
        icon={<TrendingDown size={20} className="text-rose-600 dark:text-rose-300" />}
        color="text-rose-600 dark:text-rose-400" bg="bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50"
        action={(() => {
          const pct = gastoPresupuestado > 0 ? (gastoReal / gastoPresupuestado) * 100 : 0
          return (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span className={`text-[10px] font-semibold tabular-nums ${pctTextColor(pct)}`}>{pct.toFixed(0)}%</span>
            </div>
          )
        })()}
      />
      {/* Antes: "Ingresos - gastos" real. A media quincena casi siempre sale
          positivo (aun no pagas casi nada) y se leia como "me sobra" junto a
          tarjetas que decian "te faltan". Lo que si dice algo es el plan:
          si el presupuesto ya nace en negativo, todo lo demas sale en falta. */}
      <KpiCard
        label="Tu plan" value={formatMXN(Math.abs(balancePresupuestado))}
        subtitle={balancePresupuestado < 0
          ? 'falta · presupuestaste gastar más de lo que planeas ganar'
          : 'sobra · tu presupuesto deja margen'}
        subtitleColor={balancePresupuestado < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
        icon={<Scale size={20} className={balancePresupuestado >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'} />}
        color={balancePresupuestado >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
        bg={balancePresupuestado >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50' : 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50'}
      />
      {mostrarEnCuentas && (
        liquidez ? (
          <KpiCard
            label={enCuentasLabel} value={formatMXN(liquidez.total)}
            subtitle={liquidez.fechaCorte ? `corte del ${formatDate(liquidez.fechaCorte)}` : 'según tu último corte'}
            icon={<Droplets size={20} className="text-blue-600 dark:text-blue-300" />}
            color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
          />
        ) : (
          <Link href={capturarCorteHref}>
            <KpiCard
              label="En cuentas" value="—" subtitle="Sin corte capturado: captúralo"
              icon={<Droplets size={20} className="text-blue-600 dark:text-blue-300" />}
              color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950/50 dark:ring-1 dark:ring-blue-800/50"
            />
          </Link>
        )
      )}
      {libre && (
        <KpiCard
          label={libre.label} value={formatMXN(Math.abs(libre.valor))}
          subtitle={libre.valor < 0 ? 'te faltan · comprometiste más de lo que ingresó' : 'te sobran de tus ingresos reales'}
          subtitleColor={libre.valor < 0 ? 'text-rose-500 dark:text-rose-400' : undefined}
          icon={<Coins size={20} className={libre.valor >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'} />}
          color={libre.valor >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
          bg={libre.valor >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/50 dark:ring-1 dark:ring-emerald-800/50' : 'bg-rose-50 dark:bg-rose-950/50 dark:ring-1 dark:ring-rose-800/50'}
        />
      )}
    </div>
  )
}
