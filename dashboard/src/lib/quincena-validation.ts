interface QuincenaRange {
  id: number
  codigo: string
  fechaInicio: Date
  fechaFin: Date
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10)
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Primer periodo (si existe) cuyo rango se traslapa con [fechaInicio, fechaFin]. */
export function findOverlap(existing: QuincenaRange[], fechaInicio: string, fechaFin: string) {
  return existing.find(q => fechaInicio <= toISO(q.fechaFin) && toISO(q.fechaInicio) <= fechaFin) ?? null
}

/**
 * Advertencias (no bloqueantes) de hueco entre [fechaInicio, fechaFin] y sus
 * vecinos mas cercanos en `existing`. Los huecos son validos (quincenas
 * reales los tienen), solo se avisan para que no sean accidentales.
 */
export function findGapWarnings(existing: QuincenaRange[], fechaInicio: string, fechaFin: string): string[] {
  const warnings: string[] = []
  const sorted = [...existing].sort((a, b) => toISO(a.fechaInicio).localeCompare(toISO(b.fechaInicio)))

  const prev = [...sorted].reverse().find(q => toISO(q.fechaFin) < fechaInicio)
  if (prev && addDaysISO(toISO(prev.fechaFin), 1) !== fechaInicio) {
    warnings.push(`Deja un hueco entre ${prev.codigo} (termina ${toISO(prev.fechaFin)}) y este periodo (empieza ${fechaInicio}).`)
  }

  const next = sorted.find(q => toISO(q.fechaInicio) > fechaFin)
  if (next && addDaysISO(fechaFin, 1) !== toISO(next.fechaInicio)) {
    warnings.push(`Deja un hueco entre este periodo (termina ${fechaFin}) y ${next.codigo} (empieza ${toISO(next.fechaInicio)}).`)
  }

  return warnings
}
