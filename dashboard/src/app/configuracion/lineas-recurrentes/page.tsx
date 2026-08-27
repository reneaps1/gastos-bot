'use client'
import { useState, useEffect, useCallback } from 'react'
import { LineasRecurrentesTable, type RecurrenteRow } from '@/components/ui/LineasRecurrentesTable'
import { getMexicoDateString } from '@/lib/quincena-selection'

export default function LineasRecurrentesPage() {
  const today = getMexicoDateString()
  const [presupuestos, setPresupuestos] = useState<RecurrenteRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/presupuestos')
      setPresupuestos(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Líneas recurrentes</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Series de presupuesto que se repiten automáticamente (quincenal o mensual) — consulta su frecuencia, pausa las ocurrencias futuras o elimina la serie completa.
        </p>
      </div>
      <LineasRecurrentesTable rows={presupuestos} today={today} loading={loading} onChanged={fetchData} />
    </div>
  )
}
