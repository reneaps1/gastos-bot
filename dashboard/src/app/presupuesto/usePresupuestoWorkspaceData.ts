'use client'

import { useCallback, useEffect, useState } from 'react'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { normalizeReferencia, type ReferenciaValores } from '@/lib/referencia'
import type { Presupuesto } from './page'

export interface WorkspaceQuincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
  ingresoReferencia: number | null
  limiteGastoReferencia: number | null
  fechaCierre?: string | null
}

export interface WorkspaceCategoria {
  id: number
  nombre: string
  tipo: string
  activo: boolean
}

export interface WorkspaceConfig extends ReferenciaValores {
  frecuenciaPagoDefault: string | null
}

export function usePresupuestoWorkspaceData() {
  const today = getMexicoDateString()
  const [quincenas, setQuincenas] = useState<WorkspaceQuincena[]>([])
  const [categorias, setCategorias] = useState<WorkspaceCategoria[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [config, setConfig] = useState<WorkspaceConfig>({
    frecuenciaPagoDefault: null,
    ingresoReferencia: null,
    limiteGastoReferencia: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [qRes, cRes, pRes, cfgRes] = await Promise.all([
        fetch('/api/quincenas'),
        fetch('/api/categorias'),
        fetch('/api/presupuestos'),
        fetch('/api/configuracion'),
      ])
      if (![qRes, cRes, pRes, cfgRes].every(r => r.ok)) throw new Error('No se pudieron cargar los datos de Presupuesto')

      const [qData, cData, pData, cfgData] = await Promise.all([
        qRes.json(), cRes.json(), pRes.json(), cfgRes.json(),
      ])

      setQuincenas((Array.isArray(qData) ? qData : []).map((q: WorkspaceQuincena) => normalizeReferencia(q)))
      setCategorias(Array.isArray(cData) ? cData : [])
      setPresupuestos(Array.isArray(pData) ? pData : [])
      const normalized = normalizeReferencia(cfgData ?? {})
      setConfig({
        frecuenciaPagoDefault: cfgData?.frecuenciaPagoDefault ?? null,
        ingresoReferencia: normalized.ingresoReferencia,
        limiteGastoReferencia: normalized.limiteGastoReferencia,
      })
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const updateQuincena = useCallback((updated: WorkspaceQuincena) => {
    const normalized = normalizeReferencia(updated)
    setQuincenas(prev => prev.map(q => q.id === normalized.id ? { ...q, ...normalized } : q))
  }, [])

  return { today, quincenas, categorias, presupuestos, config, loading, error, reload, updateQuincena }
}
