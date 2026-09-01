interface QuincenaLike {
  id: number
  fechaInicio: Date
  fechaFin: Date
}

/**
 * El dia diaCobro del mismo mes en que cae quincena.fechaInicio, clamped a
 * los dias que tenga ese mes -- una etiqueta de fecha para una quincena YA
 * conocida (la fila ya vive ahi), no una busqueda de "que quincena cubre
 * esta fecha" como hace computeQuincenasTarget para UBICAR una ocurrencia
 * nueva. Por eso no valida que diaCobro caiga dentro del sub-rango exacto
 * de esa quincena -- una fila puede estar en la quincena "equivocada" para
 * su propio diaCobro (reasignada a mano, dato viejo) y aun asi debe mostrar
 * la fecha que el usuario configuro, no quedar en blanco en silencio.
 */
export function fechaDiaCobroEnQuincena(quincena: QuincenaLike, diaCobro: number): string {
  const y = quincena.fechaInicio.getUTCFullYear()
  const mo = quincena.fechaInicio.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
  const d = Math.min(diaCobro, daysInMonth)
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Given a starting quincena and a recurrence config, returns the quincenas
 * (from allQuincenas) where an occurrence should land, starting at
 * quincenaInicio (inclusive) going forward. Shared by the recurring-create
 * path (POST /api/presupuestos) and the recurring-edit path
 * (PUT /api/presupuestos/[id]).
 *
 * Cada quincena viene con `fechaVencimiento`: para MENSUAL con diaCobro
 * explicito, el dia diaCobro del mes de esa ocurrencia (el mismo target-date
 * que ya se calculaba para encontrar la quincena, antes se descartaba) --
 * asi cada ocurrencia generada trae una fecha real en vez de quedar vacia.
 * Sin diaCobro explicito (o en CADA_QUINCENA, donde "dia del mes" no aplica)
 * viene null -- nunca se inventa una fecha que el usuario no pidio.
 */
export function computeQuincenasTarget<Q extends QuincenaLike>(
  allQuincenas: Q[],
  quincenaInicio: Q,
  frecuencia: string,
  diaCobro: number | null,
  numOcurrencias: number | null
): Array<Q & { fechaVencimiento: string | null }> {
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
    const fechaPorQuincenaId = new Map<number, string>()
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
      if (q && q.fechaInicio >= quincenaInicio.fechaInicio) {
        selectedIds.add(q.id)
        if (diaCobro != null) fechaPorQuincenaId.set(q.id, target)
      }
    }
    return allQuincenas
      .filter(q => selectedIds.has(q.id))
      .map(q => ({ ...q, fechaVencimiento: fechaPorQuincenaId.get(q.id) ?? null }))
  }

  // CADA_QUINCENA: all quincenas from start, optionally limited
  let quincenesTarget = allQuincenas.filter(q => q.fechaInicio >= quincenaInicio.fechaInicio)
  if (numOcurrencias && numOcurrencias > 0) {
    quincenesTarget = quincenesTarget.slice(0, numOcurrencias)
  }
  return quincenesTarget.map(q => ({ ...q, fechaVencimiento: null }))
}
