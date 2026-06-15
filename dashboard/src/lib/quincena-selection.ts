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
  const active = sorted.find(q => q.fechaInicio <= dateString && dateString < q.fechaFin)
  if (active) return active.id.toString()

  const next = sorted.find(q => dateString < q.fechaFin)
  if (next) return next.id.toString()

  return sorted.at(-1)?.id.toString() ?? ''
}

export function getInitialQuincenaId(quincenas: SelectableQuincena[]) {
  return getStoredQuincenaId(quincenas) || getDefaultQuincenaId(quincenas)
}
