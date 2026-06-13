const XLSX = require('xlsx')

const wb = XLSX.readFile('data/milo_tracker_v6.xlsm')
const ws = wb.Sheets['Captura']
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

const headerRow = data.findIndex(r => r && r[0] === 'Fecha')
const rows = data.slice(headerRow + 1)

console.log('=== Filas con "Ahorro" en descripcion ===')
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  if (row[2] && String(row[2]).toLowerCase().includes('ahorro')) {
    console.log(`Fila ${headerRow + 1 + i}: ${JSON.stringify(row)}`)
  }
}
