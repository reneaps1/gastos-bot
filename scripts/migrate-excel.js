require('dotenv').config()
const XLSX = require('xlsx')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const EXCEL_PATH = 'data/milo_tracker_v6.xlsm'

const CATEGORIA_MAP = {
  'hogar': 'Hogar',
  'salud': 'Salud',
  'familia': 'Familia',
  'super': 'Familia',
  'comida': 'Familia',
  'transporte': 'Transporte',
  'suscripciones': 'Suscripciones',
  'deudas': 'Deudas',
  'personal': 'Personal',
  'diversion': 'Personal',
  'credito msi': 'Personal',
  'telefonia': 'Familia',
  'ingresos': 'Ingresos',
  'ingreso': 'Ingresos',
  'ahorro': 'Ahorro',
}

const METODO_MAP = {
  'spei': 'SPEI',
  'efectivo': 'Efectivo',
  'debito': 'Debito',
  'vales': 'Vales',
}

const USER_MAP = {
  'rene': 1,
  'mariana': 2,
}

function excelDateToJS(serial) {
  if (!serial || typeof serial !== 'number') return null
  const utcDays = serial - 25569
  return new Date(utcDays * 86400 * 1000)
}

function normalizeCategoria(raw) {
  if (!raw) return null
  const key = String(raw).toLowerCase().trim()
  return CATEGORIA_MAP[key] || null
}

function normalizeMetodo(raw) {
  if (!raw) return null
  const key = String(raw).toLowerCase().trim()
  return METODO_MAP[key] || null
}

function normalizeUser(raw) {
  if (!raw) return 1
  const key = String(raw).toLowerCase().trim()
  return USER_MAP[key] || 1
}

function normalizeTipo(raw, categoriaRaw, descripcion) {
  if (raw) {
    const key = String(raw).toLowerCase().trim()
    if (key === 'ingreso') return 'Ingreso'
    if (key === 'ahorro') return 'Ahorro'
    return 'Gasto'
  }
  const cat = categoriaRaw ? String(categoriaRaw).toLowerCase().trim() : ''
  const desc = descripcion ? String(descripcion).toLowerCase().trim() : ''
  if (cat === 'ahorro' || desc.includes('ahorro')) return 'Ahorro'
  if (cat === 'ingresos' || cat === 'ingreso') return 'Ingreso'
  return 'Gasto'
}

function normalizeClasificacion(raw) {
  if (!raw || raw === '—') return null
  const key = String(raw).toLowerCase().trim()
  if (key === 'fijo') return 'Fijo'
  if (key === 'variable') return 'Variable'
  return null
}

function normalizeEstatus(raw) {
  if (!raw) return 'Pagado'
  const key = String(raw).toLowerCase().trim()
  if (key === 'pendiente' || key === 'pend') return 'Pendiente'
  return 'Pagado'
}

async function findQuincenaId(codigo) {
  if (!codigo) return null
  const q = await prisma.quincena.findUnique({ where: { codigo: String(codigo).trim() } })
  return q ? q.id : null
}

async function findCategoriaId(nombre) {
  if (!nombre) return null
  const c = await prisma.categoria.findUnique({ where: { nombre } })
  return c ? c.id : null
}

async function findMetodoId(nombre) {
  if (!nombre) return null
  const m = await prisma.metodoPago.findUnique({ where: { nombre } })
  return m ? m.id : null
}

async function migrateCaptura() {
  console.log('\n=== Migrando Captura ===')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets['Captura']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerRow = data.findIndex(r => r && r[0] === 'Fecha')
  if (headerRow === -1) { console.log('  ERROR: No se encontro encabezado'); return }

  const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })

  function findQuincenaByDate(date) {
    if (!date) return null
    return allQuincenas.find(q => date >= q.fechaInicio && date <= q.fechaFin) || null
  }

  const rows = data.slice(headerRow + 1).filter(r => {
    const hasAny = r.some(v => v !== null && v !== undefined && v !== '')
    return hasAny && (r[2] !== null || r[6] !== null)
  })
  console.log(`  Filas a procesar: ${rows.length}`)

  let imported = 0, skipped = 0, errors = 0

  for (const row of rows) {
    try {
      let fecha = excelDateToJS(row[0])
      const quincenaCodigo = row[1] ? String(row[1]).trim() : null
      const descripcion = row[2] ? String(row[2]).trim() : null
      const categoriaRaw = row[3] ? String(row[3]).trim() : null
      const clasificacionRaw = row[4]
      const tipoRaw = row[5]
      const monto = row[6] ? Number(row[6]) : 0
      const metodoRaw = row[7] ? String(row[7]).trim() : null
      const estatusRaw = row[8]
      const notas = row[9] ? String(row[9]).trim() : null
      const quienRaw = row[10]

      if (!descripcion || monto === 0) { skipped++; continue }

      let quincenaId = null
      if (quincenaCodigo) {
        quincenaId = await findQuincenaId(quincenaCodigo)
      }
      if (!quincenaId && fecha) {
        const q = findQuincenaByDate(fecha)
        if (q) quincenaId = q.id
      }
      if (!quincenaId && quincenaCodigo) {
        const q = allQuincenas.find(x => x.codigo === quincenaCodigo)
        if (q) { quincenaId = q.id; fecha = q.fechaInicio }
      }
      if (!quincenaId) { skipped++; continue }
      if (!fecha) {
        const q = allQuincenas.find(x => x.id === quincenaId)
        fecha = q ? q.fechaInicio : new Date()
      }

      const categoriaNombre = normalizeCategoria(categoriaRaw)
      const categoriaId = await findCategoriaId(categoriaNombre)
      if (!categoriaId) { skipped++; continue }

      const metodoNombre = normalizeMetodo(metodoRaw)
      const metodoId = metodoNombre ? await findMetodoId(metodoNombre) : null

      const userId = normalizeUser(quienRaw)
      const tipo = normalizeTipo(tipoRaw, categoriaRaw, descripcion)
      const clasificacion = normalizeClasificacion(clasificacionRaw)
      const estatus = normalizeEstatus(estatusRaw)

      await prisma.transaccion.create({
        data: {
          fecha,
          quincenaId,
          userId,
          descripcion,
          categoriaId,
          clasificacion,
          tipo,
          monto,
          metodoPagoId: metodoId,
          estatus,
          notas,
          source: 'excel',
        },
      })
      imported++
    } catch (e) {
      errors++
      if (errors <= 5) console.log(`  Error fila: ${e.message}`)
    }
  }

  console.log(`  Importadas: ${imported}`)
  console.log(`  Omitidas: ${skipped}`)
  console.log(`  Errores: ${errors}`)
  return { imported, skipped, errors }
}

async function migratePresupuesto() {
  console.log('\n=== Migrando Presupuesto ===')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets['Presupuesto']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerRow = data.findIndex(r => r && r[0] === 'Quincena')
  if (headerRow === -1) { console.log('  ERROR: No se encontro encabezado'); return }

  const rows = data.slice(headerRow + 1).filter(r => r[0] !== null && r[0] !== undefined && r[2] !== null)
  console.log(`  Filas a procesar: ${rows.length}`)

  let imported = 0, skipped = 0, errors = 0

  for (const row of rows) {
    try {
      const quincenaCodigo = String(row[0]).trim()
      const descripcion = row[2] ? String(row[2]).trim() : null
      const categoriaRaw = row[3] ? String(row[3]).trim() : null
      const montoPresupuestado = row[4] ? Number(row[4]) : 0
      const notas = row[5] ? String(row[5]).trim() : null
      const clasificacionRaw = row[10]
      const tipoRaw = row[11]

      if (!descripcion || montoPresupuestado === 0) { skipped++; continue }

      const quincenaId = await findQuincenaId(quincenaCodigo)
      if (!quincenaId) { skipped++; continue }

      const categoriaNombre = normalizeCategoria(categoriaRaw)
      const categoriaId = await findCategoriaId(categoriaNombre)
      if (!categoriaId) { skipped++; continue }

      const tipo = normalizeTipo(tipoRaw || 'Gasto')
      const clasificacion = normalizeClasificacion(clasificacionRaw)

      await prisma.presupuesto.create({
        data: {
          quincenaId,
          descripcion,
          categoriaId,
          clasificacion,
          tipo,
          montoPresupuestado,
          notas,
        },
      })
      imported++
    } catch (e) {
      errors++
      if (errors <= 5) console.log(`  Error fila: ${e.message}`)
    }
  }

  console.log(`  Importadas: ${imported}`)
  console.log(`  Omitidas: ${skipped}`)
  console.log(`  Errores: ${errors}`)
  return { imported, skipped, errors }
}

async function migrateLiquidez() {
  console.log('\n=== Migrando Liquidez ===')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets['Liquidez']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerRow = data.findIndex(r => r && r[0] === 'Fecha Corte')
  if (headerRow === -1) { console.log('  ERROR: No se encontro encabezado'); return }

  const rows = data.slice(headerRow + 1).filter(r => r[0] !== null && r[0] !== undefined)
  console.log(`  Filas a procesar: ${rows.length}`)

  let imported = 0, skipped = 0, errors = 0

  for (const row of rows) {
    try {
      const fechaCorte = excelDateToJS(row[0])
      const bbva = row[1] ? Number(row[1]) : 0
      const banamex = row[2] ? Number(row[2]) : 0
      const uala = row[3] ? Number(row[3]) : 0
      const ualaInversion = row[4] ? Number(row[4]) : 0
      const efectivo = row[5] ? Number(row[5]) : 0
      const valesDespensa = row[6] ? Number(row[6]) : 0
      const valesGasolina = row[7] ? Number(row[7]) : 0
      const faltaPagar = row[9] ? Number(row[9]) : 0
      const teorico = row[11] ? Number(row[11]) : null
      const notas = row[13] ? String(row[13]).trim() : null
      const quincenaCodigo = row[14] ? String(row[14]).trim() : null

      if (!fechaCorte) { skipped++; continue }

      const quincenaId = await findQuincenaId(quincenaCodigo)
      if (!quincenaId) { skipped++; continue }

      await prisma.liquidezSnapshot.create({
        data: {
          fechaCorte,
          quincenaId,
          bbva,
          banamex,
          uala,
          ualaInversion,
          efectivo,
          valesDespensa,
          valesGasolina,
          faltaPagar,
          teorico,
          notas,
        },
      })
      imported++
    } catch (e) {
      errors++
      if (errors <= 5) console.log(`  Error fila: ${e.message}`)
    }
  }

  console.log(`  Importadas: ${imported}`)
  console.log(`  Omitidas: ${skipped}`)
  console.log(`  Errores: ${errors}`)
  return { imported, skipped, errors }
}

async function migrateDeudas() {
  console.log('\n=== Migrando Deudas v2 ===')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets['Deudas v2']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerRow = data.findIndex(r => r && r[0] === 'Acreedor')
  if (headerRow === -1) { console.log('  ERROR: No se encontro encabezado'); return }

  const rows = data.slice(headerRow + 1).filter(r => r[0] !== null && r[0] !== undefined && r[0] !== 'TOTAL')
  console.log(`  Filas a procesar: ${rows.length}`)

  let imported = 0, errors = 0

  for (const row of rows) {
    try {
      const acreedor = String(row[0]).trim()
      const deudaOriginal = Number(row[1])
      const abonoMensual = row[2] ? Number(row[2]) : null

      await prisma.deuda.create({
        data: {
          acreedor,
          deudaOriginal,
          abonoMensual,
          activo: true,
        },
      })
      imported++
    } catch (e) {
      errors++
      if (errors <= 5) console.log(`  Error fila: ${e.message}`)
    }
  }

  console.log(`  Importadas: ${imported}`)
  console.log(`  Errores: ${errors}`)
  return { imported, errors }
}

async function validate() {
  console.log('\n=== Validacion contra Excel ===')

  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets['Resumen Quincenal']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerRow = data.findIndex(r => r && r[0] === 'Quincena')
  const rows = data.slice(headerRow + 1).filter(r => r[0] && r[0] !== 'TOTAL')

  for (const row of rows) {
    const codigo = String(row[0]).trim()
    const excelIngresos = Number(row[2]) || 0
    const excelGastos = Number(row[6]) || 0
    const excelBalance = Number(row[7]) || 0

    const quincena = await prisma.quincena.findUnique({ where: { codigo } })
    if (!quincena) continue

    const dbIngresos = await prisma.transaccion.aggregate({
      where: { quincenaId: quincena.id, tipo: 'Ingreso' },
      _sum: { monto: true },
    })
    const dbGastos = await prisma.transaccion.aggregate({
      where: { quincenaId: quincena.id, tipo: 'Gasto' },
      _sum: { monto: true },
    })

    const dbIng = Number(dbIngresos._sum.monto ?? 0)
    const dbGas = Number(dbGastos._sum.monto ?? 0)
    const dbBal = dbIng - dbGas

    const diffIng = Math.abs(dbIng - excelIngresos)
    const diffGas = Math.abs(dbGas - excelGastos)
    const diffBal = Math.abs(dbBal - excelBalance)

    const ok = diffIng < 1 && diffGas < 1 && diffBal < 1
    console.log(`  ${codigo}: Ing ${dbIng.toFixed(2)} vs ${excelIngresos.toFixed(2)} | Gas ${dbGas.toFixed(2)} vs ${excelGastos.toFixed(2)} | Bal ${dbBal.toFixed(2)} vs ${excelBalance.toFixed(2)} ${ok ? 'OK' : 'DIFF'}`)
  }
}

async function main() {
  console.log('Iniciando migracion desde Excel...')

  const existing = await prisma.transaccion.count()
  if (existing > 0) {
    console.log(`\nADVERTENCIA: Ya existen ${existing} transacciones.`)
    console.log('Para re-migrar, limpia la DB primero.')
    console.log('Saltando migracion...\n')
  } else {
    await migrateCaptura()
    await migratePresupuesto()
    await migrateLiquidez()
    await migrateDeudas()
  }

  await validate()

  console.log('\n=== Resumen final ===')
  const [tx, pres, liq, deudas] = await Promise.all([
    prisma.transaccion.count(),
    prisma.presupuesto.count(),
    prisma.liquidezSnapshot.count(),
    prisma.deuda.count(),
  ])
  console.log(`  Transacciones: ${tx}`)
  console.log(`  Presupuestos: ${pres}`)
  console.log(`  Liquidez snapshots: ${liq}`)
  console.log(`  Deudas: ${deudas}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
