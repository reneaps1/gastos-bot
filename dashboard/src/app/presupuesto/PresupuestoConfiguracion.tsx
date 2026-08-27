'use client'
import Link from 'next/link'
import { CalendarRange, Tag } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { LineasRecurrentesTable } from '@/components/ui/LineasRecurrentesTable'
import type { Presupuesto } from './page'

interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }
interface Categoria { id: number; nombre: string; tipo: string; activo: boolean }

interface Props {
  quincenas: Quincena[]
  categorias: Categoria[]
  today: string
  frecuenciaPagoDefault: string | null
  presupuestos: Presupuesto[]
  loading: boolean
  onChanged: () => void
  openEdit: (p: Presupuesto) => void
}

const FREQ_LABEL_PERIODO: Record<string, string> = { QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', MENSUAL: 'Mensual' }

export function PresupuestoConfiguracion({
  quincenas, categorias, today, frecuenciaPagoDefault, presupuestos, loading, onChanged, openEdit,
}: Props) {
  const categoriasActivas = categorias.filter(c => c.activo).length

  return (
    <div className="space-y-6">
      {/* Accesos rápidos: resumen compacto + link a la página completa. No
          duplican la UI de edición de esas páginas -- solo dan visibilidad
          desde Presupuesto. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/configuracion/quincenas">
          <KpiCard
            label="Períodos de pago" value={`${quincenas.length} períodos`}
            subtitle={frecuenciaPagoDefault ? `frecuencia: ${FREQ_LABEL_PERIODO[frecuenciaPagoDefault] ?? frecuenciaPagoDefault}` : undefined}
            icon={<CalendarRange size={20} className="text-teal-600 dark:text-teal-300" />}
            color="text-teal-600 dark:text-teal-400" bg="bg-teal-50 dark:bg-teal-950/50 dark:ring-1 dark:ring-teal-800/50"
          />
        </Link>
        <Link href="/configuracion/categorias">
          <KpiCard
            label="Categorías" value={`${categoriasActivas} activas`}
            subtitle={`de ${categorias.length} totales`}
            icon={<Tag size={20} className="text-indigo-600 dark:text-indigo-300" />}
            color="text-indigo-600 dark:text-indigo-400" bg="bg-indigo-50 dark:bg-indigo-950/50 dark:ring-1 dark:ring-indigo-800/50"
          />
        </Link>
      </div>

      {/* Líneas de presupuesto recurrentes: qué partidas están "activas" como
          serie (recurrenciaGrupoId), su frecuencia, y control para pausar
          futuras o eliminar la serie completa. */}
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Líneas recurrentes</p>
        <LineasRecurrentesTable rows={presupuestos} today={today} loading={loading} onChanged={onChanged} onEdit={openEdit} />
      </div>
    </div>
  )
}
