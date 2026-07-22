interface QuincenaLike {
  id: number
  fechaInicio: Date
  fechaFin: Date
}

/**
 * Given a starting quincena and a recurrence config, returns the quincenas
 * (from allQuincenas) where an occurrence should land, starting at
 * quincenaInicio (inclusive) going forward. Shared by the recurring-create
 * path (POST /api/presupuestos) and the recurring-edit path
 * (PUT /api/presupuestos/[id]).
 */
export function computeQuincenasTarget(
  allQuincenas: QuincenaLike[],
  quincenaInicio: QuincenaLike,
  frecuencia: string,
  diaCobro: number | null,
  numOcurrencias: number | null
): QuincenaLike[] {
  if (frecuencia === 'MENSUAL') {
    // Target-date lookup: for each calendar month find the quincena that covers diaCobro
    const targetDay = diaCobro ?? 1
    const startDate = quincenaInicio.fechaInicio
    const startYear = startDate.getUTCFullYear()
    const startMonth = startDate.getUTCMonth()

    const lastQuincena = allQuincenas.at(-1)
    const lastDate = lastQuincena?.fechaFin ?? startDate
    const lastYear = lastDate.getUTCFullYear()
    const lastMonth = lastDate.getUTCMonth()
    const maxMonths = (lastYear - startYear) * 12 + (lastMonth - startMonth) + 1
    const monthCount = numOcurrencias ? Math.min(numOcurrencias, maxMonths) : maxMonths

    const selectedIds = new Set<number>()
    for (let i = 0; i < monthCount; i++) {
      const y = startYear + Math.floor((startMonth + i) / 12)
      const mo = (startMonth + i) % 12
      const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
      const d = Math.min(targetDay, daysInMonth)
      const target = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const q = allQuincenas.find(q => {
        const ini = q.fechaInicio.toISOString().split('T')[0]
        const fin = q.fechaFin.toISOString().split('T')[0]
        return ini <= target && target <= fin
      })
      if (q && q.fechaInicio >= quincenaInicio.fechaInicio) selectedIds.add(q.id)
    }
    return allQuincenas.filter(q => selectedIds.has(q.id))
  }

  // CADA_QUINCENA: all quincenas from start, optionally limited
  let quincenesTarget = allQuincenas.filter(q => q.fechaInicio >= quincenaInicio.fechaInicio)
  if (numOcurrencias && numOcurrencias > 0) {
    quincenesTarget = quincenesTarget.slice(0, numOcurrencias)
  }
  return quincenesTarget
}
