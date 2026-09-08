'use client'

import type { ComponentProps } from 'react'
import { PresupuestoAnalisis as PresupuestoAnalisisCore } from './PresupuestoAnalisisCore'
import { PresupuestoEvolucionPlan } from './PresupuestoEvolucionPlan'
import { PresupuestoForecast } from './PresupuestoForecast'
import { PresupuestoGraficaOVR } from './PresupuestoGraficaOVR'

type Props = ComponentProps<typeof PresupuestoAnalisisCore>

/**
 * Capa de composición: mantiene intacta la implementación avanzada de
 * Análisis (filtros, simulación histórica, variaciones, etc.) y suma
 * forecast/escenarios + evolución auditable + una lectura O/V/R dedicada.
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
      <PresupuestoGraficaOVR
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
