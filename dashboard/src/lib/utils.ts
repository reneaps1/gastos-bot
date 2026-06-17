import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMXN(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num)
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

export function formatDateStr(
  date: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!date) return '—'
  const dateStr = date.split('T')[0]
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-MX', options).format(d)
}
