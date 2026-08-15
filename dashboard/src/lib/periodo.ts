export type Granularidad = 'semana' | 'quincena' | 'mes'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function parseDateUTC(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

function toISODate(d: Date) {
  return d.toISOString().split('T')[0]
}

/** Semana ISO (lunes-domingo) que contiene la fecha dada. */
export function getIsoWeekRange(dateStr: string) {
  const d = parseDateUTC(dateStr)
  const day = d.getUTCDay() // 0=domingo..6=sábado
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const desde = toISODate(monday)
  const hasta = toISODate(sunday)
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth()
  const label = sameMonth
    ? `${monday.getUTCDate()}-${sunday.getUTCDate()} ${MESES_ABBR[sunday.getUTCMonth()]}`
    : `${monday.getUTCDate()} ${MESES_ABBR[monday.getUTCMonth()]} - ${sunday.getUTCDate()} ${MESES_ABBR[sunday.getUTCMonth()]}`
  return { desde, hasta, label }
}

/** Mes calendario (1 al último día) que contiene la fecha dada. */
export function getMonthRange(dateStr: string) {
  const d = parseDateUTC(dateStr)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))

  const desde = toISODate(first)
  const hasta = toISODate(last)
  const label = `${MESES[month][0].toUpperCase()}${MESES[month].slice(1)} ${year}`
  return { desde, hasta, label }
}

export function shiftWeek(dateStr: string, delta: number) {
  const d = parseDateUTC(dateStr)
  d.setUTCDate(d.getUTCDate() + delta * 7)
  return toISODate(d)
}

export function shiftMonth(dateStr: string, delta: number) {
  const d = parseDateUTC(dateStr)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + delta)
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDayOfTarget))
  return toISODate(d)
}

export function getPeriodoRange(granularidad: 'semana' | 'mes', anchor: string) {
  return granularidad === 'semana' ? getIsoWeekRange(anchor) : getMonthRange(anchor)
}

export function shiftPeriodo(granularidad: 'semana' | 'mes', anchor: string, delta: number) {
  return granularidad === 'semana' ? shiftWeek(anchor, delta) : shiftMonth(anchor, delta)
}
