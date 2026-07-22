export interface CsvColumn<T> {
  key: string
  label: string
  value: (row: T) => string | number
}

function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCsvValue(c.label)).join(',')
  const lines = rows.map(row => columns.map(c => escapeCsvValue(c.value(row))).join(','))
  return [header, ...lines].join('\r\n')
}

export function downloadCsv(filename: string, csvContent: string): void {
  const BOM = '﻿'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
