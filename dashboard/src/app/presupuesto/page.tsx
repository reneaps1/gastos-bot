'use client'

import Link from 'next/link'
import { useState } from 'react'
import { History, Settings2, TrendingUp, WalletCards } from 'lucide-react'
import PresupuestoAhoraLegacy from './PresupuestoAhoraLegacy'
import { PresupuestoHistorial } from './PresupuestoHistorial'
import { PresupuestoProyeccion } from './PresupuestoProyeccion'

export interface Quincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
  ingresoReferencia: number | null
  limiteGastoReferencia: number | null
  fechaCierre?: string | null
}

export interface Categoria {
  id: number
  nombre: string
  tipo: string
  activo: boolean
}

export interface Presupuesto {
  id: number
  descripcion: string
  montoPresupuestado: number
  clasificacion: string | null
  tipo: string
  notas: string | null
  quincenaId: number
  categoriaId: number
  recurrente: boolean
  frecuencia: string | null
  recurrenciaGrupoId: string | null
  numOcurrencias: number | null
  diaCobro: number | null
  fechaVencimiento: string | null
  estadoLinea: string
  montoRevisado: number | string | null
  montoEfectivo: number
  categoria: Categoria
  quincena: Quincena
  real: number
  pendiente: number
  pct: number
  categoriaTotal: number
  excedido: number
}

type Seccion = 'ahora' | 'historial' | 'proyeccion'

const SECCIONES: { key: Seccion; label: string; icon: typeof WalletCards }[] = [
  { key: 'ahora', label: 'Ahora', icon: WalletCards },
  { key: 'historial', label: 'Historial', icon: History },
  { key: 'proyeccion', label: 'Proyección', icon: TrendingUp },
]

export default function PresupuestoPage() {
  const [seccion, setSeccion] = useState<Seccion>('ahora')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-3 gap-1 flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 min-w-0">
          {SECCIONES.map(item => {
            const Icon = item.icon
            const active = seccion === item.key
            return (
              <button key={item.key} type="button" onClick={() => setSeccion(item.key)}
                className={`min-w-0 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${active
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                <Icon size={15} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
        <Link href="/configuracion/referencias-presupuesto" aria-label="Configurar referencias de Presupuesto" title="Configuración de Presupuesto"
          className="w-11 h-11 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-700 flex items-center justify-center transition-colors">
          <Settings2 size={18} />
        </Link>
      </div>

      {seccion === 'ahora' && (
        <div id="presupuesto-ahora-legacy">
          <PresupuestoAhoraLegacy />
          <style>{`
            /* Ahora conserva la pantalla operativa probada. Solo ocultamos los
               destinos viejos Análisis/Config: ahora viven en la navegación superior. */
            #presupuesto-ahora-legacy div:has(> button > svg.lucide-layout-grid):has(> button > svg.lucide-table-2) > button:nth-child(n+3) {
              display: none !important;
            }
          `}</style>
        </div>
      )}

      {seccion === 'historial' && <PresupuestoHistorial />}
      {seccion === 'proyeccion' && <PresupuestoProyeccion />}
    </div>
  )
}
