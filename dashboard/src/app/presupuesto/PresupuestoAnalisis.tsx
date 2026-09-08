'use client'

import type { ComponentProps } from 'react'
import { PresupuestoAnalisis as PresupuestoAnalisisCore } from './PresupuestoAnalisisCore'
import { PresupuestoEvolucionPlan } from './PresupuestoEvolucionPlan'
import { PresupuestoForecast } from './PresupuestoForecast'

type Props = ComponentProps<typeof PresupuestoAnalisisCore>

/**
 * Capa de composición: mantiene intacta la implementación avanzada de
 * Análisis (gráfica, filtros, simulación histórica, variaciones, etc.) y
 * suma forecast/escenarios + evolución auditable del plan como bloques
 * independientes.
 */
export function PresupuestoAnalisis(props: Props) {
  return (
    <div className="space-y-6">
      <PresupuestoForecast today={props.today} presupuestos={props.presupuestos} />
      <PresupuestoEvolucionPlan
        quincenas={props.quincenas}
        presupuestos={props.presupuestos}
        desdeId={props.desdeId}
        hastaId={props.hastaId}
        categoriaId={props.categoriaId}
      />
      <PresupuestoAnalisisCore {...props} />
    </div>
  )
}
