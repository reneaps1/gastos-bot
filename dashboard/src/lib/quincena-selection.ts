export interface SelectableQuincena {
  id: number
  codigo: string
  fechaInicio: string
  fechaFin: string
}

const STORAGE_KEY = 'milo:selectedQuincenaId'

export function getMexicoDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  return `${year}-${month}-${day}`
}

export function getStoredQuincenaId(quincenas: SelectableQuincena[]) {
  if (typeof window === 'undefined') return ''
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored && quincenas.some(q => q.id.toString() === stored) ? stored : ''
}

export function persistQuincenaId(quincenaId: string) {
  if (typeof window === 'undefined' || !quincenaId) return
  window.localStorage.setItem(STORAGE_KEY, quincenaId)
}

export function getDefaultQuincenaId(quincenas: SelectableQuincena[], dateString = getMexicoDateString()) {
  const sorted = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const active = sorted.find(q => q.fechaInicio <= dateString && dateString <= q.fechaFin)
  if (active) return active.id.toString()

  const next = sorted.find(q => dateString <= q.fechaFin)
  if (next) return next.id.toString()

  return sorted.at(-1)?.id.toString() ?? ''
}

export function getInitialQuincenaId(quincenas: SelectableQuincena[]) {
  return getStoredQuincenaId(quincenas) || getDefaultQuincenaId(quincenas)
}

export function getQuincenaIdForDate(quincenas: SelectableQuincena[], dateString: string) {
  const sorted = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const first = sorted[0]
  if (!first || dateString < first.fechaInicio) return ''

  const active = sorted.find(q => q.fechaInicio <= dateString && dateString <= q.fechaFin)
  // '' signals date is in a gap — callers should warn the user to pick a quincena manually
  return active?.id.toString() ?? ''
}

export function isDateInQuincenaGap(quincenas: SelectableQuincena[], dateString: string) {
  if (!dateString) return false
  const sorted = [...quincenas].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  const first = sorted[0]
  const last = sorted.at(-1)
  if (!first || !last) return false
  if (dateString < first.fechaInicio || dateString > last.fechaFin) return false
  return !sorted.some(q => q.fechaInicio <= dateString && dateString <= q.fechaFin)
}

export function formatQuincenaRange(quincena: SelectableQuincena) {
  const format = (value: string) => {
    if (!value) return '—'
    const dateOnly = value.split('T')[0]
    const d = new Date(`${dateOnly}T00:00:00.000Z`)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
  }

  return `${format(quincena.fechaInicio)} - ${format(quincena.fechaFin)}`
}

export function formatQuincenaOption(quincena: SelectableQuincena) {
  return `${quincena.codigo} · ${formatQuincenaRange(quincena)}`
}
