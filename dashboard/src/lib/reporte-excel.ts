// Genera el .xlsx del reporte de quincena (presupuesto + liquidez) del lado
// del navegador. exceljs se importa dinamicamente para no inflar el bundle
// inicial -- solo se carga cuando el usuario da clic en "Exportar Excel".

export interface ReporteQuincena {
  codigo: string
  fechaInicio: string
  fechaFin: string
}

export interface ReportePresupuestoRow {
  tipo: string
  categoria: string
  descripcion: string
  montoPresupuestado: number
  real: number
  pendiente: number
}

export interface ReporteTransaccionRow {
  fecha: string
  tipo: string
  categoria: string
  partida: string
  descripcion: string
  monto: number
  estatus: string
  metodoPago: string
  usuario: string
}

export interface ReporteLiquidez {
  fechaCorte: string
  validado: boolean
  bbva: number
  banamex: number
  uala: number
  ualaInversion: number
  efectivo: number
  valesDespensa: number
  valesGasolina: number
  otros: number
  otrosNota: string | null
  totalLiquido: number
  faltaPagar: number
  delta: number
}

export interface ReporteData {
  quincena: ReporteQuincena
  totales: { ingreso: number; gasto: number; pagado: number; pendiente: number }
  presupuesto: ReportePresupuestoRow[]
  transacciones: ReporteTransaccionRow[]
  liquidez: ReporteLiquidez | null
}

function money(n: number) {
  return Math.round(n * 100) / 100
}

export async function downloadReporteExcel(data: ReporteData) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Milo Gastos'
  wb.created = new Date()

  const moneyFmt = '"$"#,##0.00'

  // ---- Resumen ----
  const resumen = wb.addWorksheet('Resumen')
  resumen.columns = [{ width: 28 }, { width: 20 }]
  resumen.addRow(['Reporte de quincena', data.quincena.codigo])
  resumen.addRow(['Periodo', `${data.quincena.fechaInicio.split('T')[0]} a ${data.quincena.fechaFin.split('T')[0]}`])
  resumen.addRow(['Generado', new Date().toLocaleString('es-MX')])
  resumen.addRow([])

  if (data.liquidez) {
    const l = data.liquidez
    resumen.addRow(['Liquidez — corte', l.fechaCorte.split('T')[0]])
    resumen.addRow(['Validado', l.validado ? 'Si' : 'No'])
    resumen.addRow(['Total liquido', money(l.totalLiquido)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Falta por pagar', money(l.faltaPagar)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Delta (liquido neto)', money(l.delta)]).getCell(2).numFmt = moneyFmt
    resumen.addRow([])
    resumen.addRow(['BBVA', money(l.bbva)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Banamex', money(l.banamex)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Uala', money(l.uala)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Uala Inversion', money(l.ualaInversion)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Efectivo', money(l.efectivo)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Vales despensa', money(l.valesDespensa)]).getCell(2).numFmt = moneyFmt
    resumen.addRow(['Vales gasolina', money(l.valesGasolina)]).getCell(2).numFmt = moneyFmt
    resumen.addRow([l.otrosNota ? `Otros (${l.otrosNota})` : 'Otros', money(l.otros)]).getCell(2).numFmt = moneyFmt
    resumen.addRow([])
  }

  resumen.addRow(['Ingresos', money(data.totales.ingreso)]).getCell(2).numFmt = moneyFmt
  resumen.addRow(['Gastos', money(data.totales.gasto)]).getCell(2).numFmt = moneyFmt
  resumen.addRow(['Pagado', money(data.totales.pagado)]).getCell(2).numFmt = moneyFmt
  resumen.addRow(['Pendiente', money(data.totales.pendiente)]).getCell(2).numFmt = moneyFmt
  resumen.getColumn(1).font = { bold: true }

  // ---- Presupuesto ----
  const ppto = wb.addWorksheet('Presupuesto')
  ppto.columns = [
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Categoría', key: 'categoria', width: 22 },
    { header: 'Descripción', key: 'descripcion', width: 32 },
    { header: 'Presupuestado', key: 'montoPresupuestado', width: 16, style: { numFmt: moneyFmt } },
    { header: 'Real', key: 'real', width: 16, style: { numFmt: moneyFmt } },
    { header: 'Pendiente', key: 'pendiente', width: 16, style: { numFmt: moneyFmt } },
    { header: 'Restante', key: 'restante', width: 16, style: { numFmt: moneyFmt } },
  ]
  ppto.getRow(1).font = { bold: true }
  for (const row of data.presupuesto) {
    ppto.addRow({
      tipo: row.tipo,
      categoria: row.categoria,
      descripcion: row.descripcion,
      montoPresupuestado: money(row.montoPresupuestado),
      real: money(row.real),
      pendiente: money(row.pendiente),
      restante: money(row.montoPresupuestado - row.real),
    })
  }

  // ---- Transacciones ----
  const tx = wb.addWorksheet('Transacciones')
  tx.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Categoría', key: 'categoria', width: 20 },
    { header: 'Partida', key: 'partida', width: 28 },
    { header: 'Descripción', key: 'descripcion', width: 32 },
    { header: 'Monto', key: 'monto', width: 14, style: { numFmt: moneyFmt } },
    { header: 'Estatus', key: 'estatus', width: 12 },
    { header: 'Método de pago', key: 'metodoPago', width: 16 },
    { header: 'Usuario', key: 'usuario', width: 14 },
  ]
  tx.getRow(1).font = { bold: true }
  for (const row of data.transacciones) {
    tx.addRow({ ...row, fecha: row.fecha.split('T')[0], monto: money(row.monto) })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `reporte-${data.quincena.codigo}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export interface ReporteResumenRow {
  categoria: string
  descripcion: string
  presupuestado: number
  pagado: number
  falta: number
  estado: string
}

export interface ReporteResumenData {
  quincena: ReporteQuincena
  liquidezDisponible: number | null
  totalPresupuestado: number
  totalPagado: number
  totalFalta: number
  rows: ReporteResumenRow[]
}

export async function downloadResumenExcel(data: ReporteResumenData) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Milo Gastos'
  wb.created = new Date()

  const moneyFmt = '"$"#,##0.00'
  const sheet = wb.addWorksheet('Resumen')
  sheet.addRow(['Reporte resumido de quincena', data.quincena.codigo])
  sheet.addRow(['Periodo', `${data.quincena.fechaInicio.split('T')[0]} a ${data.quincena.fechaFin.split('T')[0]}`])
  sheet.addRow(['Generado', new Date().toLocaleString('es-MX')])
  sheet.addRow([])
  if (data.liquidezDisponible != null) {
    sheet.addRow(['Liquidez disponible', money(data.liquidezDisponible)]).getCell(2).numFmt = moneyFmt
  }
  sheet.addRow(['Presupuestado', money(data.totalPresupuestado)]).getCell(2).numFmt = moneyFmt
  sheet.addRow(['Pagado', money(data.totalPagado)]).getCell(2).numFmt = moneyFmt
  sheet.addRow(['Falta por cubrir', money(data.totalFalta)]).getCell(2).numFmt = moneyFmt
  sheet.addRow([])
  sheet.getColumn(1).width = 26
  sheet.getColumn(2).width = 18

  const headerRow = sheet.addRow(['Categoría', 'Descripción', 'Presupuestado', 'Pagado', 'Falta', 'Estado'])
  headerRow.font = { bold: true }
  sheet.getColumn(3).width = 16
  sheet.getColumn(4).width = 16
  sheet.getColumn(5).width = 16
  sheet.getColumn(6).width = 14
  for (const row of data.rows) {
    const r = sheet.addRow([row.categoria, row.descripcion, money(row.presupuestado), money(row.pagado), money(row.falta), row.estado])
    r.getCell(3).numFmt = moneyFmt
    r.getCell(4).numFmt = moneyFmt
    r.getCell(5).numFmt = moneyFmt
  }
  const totalRow = sheet.addRow(['TOTAL', '', money(data.totalPresupuestado), money(data.totalPagado), money(data.totalFalta), ''])
  totalRow.font = { bold: true }
  totalRow.getCell(3).numFmt = moneyFmt
  totalRow.getCell(4).numFmt = moneyFmt
  totalRow.getCell(5).numFmt = moneyFmt

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `resumen-presupuesto-${data.quincena.codigo}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
