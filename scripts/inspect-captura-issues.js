const XLSX = require('xlsx')

const wb = XLSX.readFile('data/milo_tracker_v6.xlsm')
const ws = wb.Sheets['Captura']
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

const headerRow = data.findIndex(r => r && r[0] === 'Fecha')
const rows = data.slice(headerRow + 1)

console.log('=== Filas SIN quincena ===')
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  if (row[0] !== null && row[0] !== undefined && (!row[1] || String(row[1]).trim() === '')) {
    console.log(`Fila ${headerRow + 1 + i}: ${JSON.stringify(row)}`)
  }
}

console.log('\n=== Filas con fecha pero categoria desconocida ===')
const CATEGORIA_MAP = {
  'hogar': 'Hogar', 'salud': 'Salud', 'familia': 'Familia', 'super': 'Familia',
  'comida': 'Familia', 'transporte': 'Transporte', 'suscripciones': 'Suscripciones',
  'deudas': 'Deudas', 'personal': 'Personal', 'diversion': 'Personal',
  'ingresos': 'Ingresos', 'ingreso': 'Ingresos', 'ahorro': 'Ahorro',
}

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  if (row[0] !== null && row[0] !== undefined && row[3]) {
    const cat = String(row[3]).toLowerCase().trim()
    if (!CATEGORIA_MAP[cat]) {
      console.log(`Fila ${headerRow + 1 + i}: cat="${row[3]}" -> ${JSON.stringify(row)}`)
    }
  }
}

console.log('\n=== Filas sin fecha pero con datos ===')
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  if ((row[0] === null || row[0] === undefined) && row.some(v => v !== null && v !== undefined)) {
    console.log(`Fila ${headerRow + 1 + i}: ${JSON.stringify(row)}`)
  }
}
