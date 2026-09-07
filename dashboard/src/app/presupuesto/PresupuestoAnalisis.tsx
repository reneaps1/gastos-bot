'use client'

import type { ComponentProps } from 'react'
import { PresupuestoAnalisis as PresupuestoAnalisisCore } from './PresupuestoAnalisisCore'
import { PresupuestoForecast } from './PresupuestoForecast'

type Props = ComponentProps<typeof PresupuestoAnalisisCore>

/**
 * Capa de composición: mantiene intacta la implementación avanzada de
 * Análisis (gráfica, filtros, simulación histórica, variaciones, etc.) y
 * suma el forecast/escenarios como un bloque independiente.
 */
export function PresupuestoAnalisis(props: Props) {
  return (
    <div className="space-y-6">
      <PresupuestoForecast today={props.today} presupuestos={props.presupuestos} />
      <PresupuestoAnalisisCore {...props} />
    </div>
  )
}
