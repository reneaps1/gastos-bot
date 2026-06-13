const XLSX = require('xlsx')

const wb = XLSX.readFile('data/milo_tracker_v6.xlsm')

function inspectSheet(name, maxRows = 10) {
  const ws = wb.Sheets[name]
  if (!ws) { console.log(`${name}: NO EXISTE`); return }

  const ref = ws['!ref']
  console.log(`\n=== ${name} ===`)
  console.log(`Rango: ${ref}`)

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  for (let i = 0; i < Math.min(data.length, maxRows); i++) {
    const row = data[i]
    const nonNull = row?.filter(v => v !== null && v !== undefined && v !== '')
    if (nonNull && nonNull.length > 0) {
      console.log(`  Fila ${i}: ${JSON.stringify(row)}`)
    }
  }
}

inspectSheet('Captura', 15)
inspectSheet('Presupuesto', 15)
inspectSheet('Liquidez', 15)
inspectSheet('Deudas v2', 15)
inspectSheet('semanas', 20)
inspectSheet('Resumen Quincenal', 10)
