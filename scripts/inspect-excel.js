const XLSX = require('xlsx')

const wb = XLSX.readFile('milo_tracker_v6.xlsm')

console.log('=== HOJAS DEL EXCEL ===\n')
console.log(wb.SheetNames.join(', '))
console.log('\n')

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 })

  console.log(`--- ${name} ---`)
  console.log(`Filas: ${data.length}`)

  if (data.length > 0) {
    console.log(`Columnas: ${data[0]?.length || 0}`)
    console.log(`Encabezados: ${JSON.stringify(data[0])}`)

    if (data.length > 1) {
      console.log(`Primera fila datos: ${JSON.stringify(data[1])}`)
    }
    if (data.length > 2) {
      console.log(`Segunda fila datos: ${JSON.stringify(data[2])}`)
    }
  }
  console.log('')
}
