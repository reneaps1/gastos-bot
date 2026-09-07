'use client'

import type { ComponentProps } from 'react'
import { PresupuestoAnalisis as PresupuestoAnalisisCore } from './PresupuestoAnalisisCore'
import { PresupuestoForecast } from './PresupuestoForecast'

type Props = ComponentProps<typeof PresupuestoAnalisisCore>

/**
 * Capa de composición: mantiene intacta la implementación avanzada de
 * Análisis (gráfica, filtros, simulación, variaciones, etc.) y suma el
 * forecast como un bloque independiente. Separarlos reduce el riesgo de
 * regresiones en la gráfica al evolucionar el pronóstico.
 */
export function PresupuestoAnalisis(props: Props) {
  return (
    <div className="space-y-6">
      <PresupuestoForecast today={props.today} />
      <PresupuestoAnalisisCore {...props} />
    </div>
  )
}
