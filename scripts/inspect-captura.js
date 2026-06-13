const XLSX = require('xlsx')

const wb = XLSX.readFile('data/milo_tracker_v6.xlsm')
const ws = wb.Sheets['Captura']
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

const headerRow = data.findIndex(r => r && r[0] === 'Fecha')
console.log(`Encabezado en fila: ${headerRow}`)

const rows = data.slice(headerRow + 1)
console.log(`Total filas despues del encabezado: ${rows.length}`)

let withDate = 0, withoutDate = 0, empty = 0
let quincenas = {}

for (const row of rows) {
  if (row[0] !== null && row[0] !== undefined) {
    withDate++
    const q = row[1] ? String(row[1]).trim() : 'SIN_Q'
    quincenas[q] = (quincenas[q] || 0) + 1
  } else if (row.some(v => v !== null && v !== undefined)) {
    withoutDate++
  } else {
    empty++
  }
}

console.log(`\nCon fecha: ${withDate}`)
console.log(`Sin fecha pero con datos: ${withoutDate}`)
console.log(`Vacias: ${empty}`)

console.log('\nPor quincena:')
for (const [q, count] of Object.entries(quincenas).sort()) {
  console.log(`  ${q}: ${count}`)
}
