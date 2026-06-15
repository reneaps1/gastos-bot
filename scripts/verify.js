require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const EXPECTED_TABLES = [
  'users', 'categorias', 'metodos_pago', 'quincenas', 'cuentas',
  'transacciones', 'entrada_rapida', 'presupuesto', 'deudas', 'creditos', 'credito_pagos',
  'whatsapp_messages', 'import_batches', 'audit_log', 'liquidez_snapshots',
]

const EXPECTED_VIEWS = [
  'v_resumen_quincenal', 'v_estado_deudas',
  'v_ejecucion_presupuesto', 'v_corte_liquidez', 'v_liquidez',
  'v_consumo_quincenal', 'v_credito_pagos_quincena',
]

const EXPECTED_ENUMS = ['TipoMovimiento', 'ClasificacionGasto', 'EstatusPago', 'TipoCredito', 'EstatusCreditoPago']

const SEED_EXPECTED = [
  { table: 'users',       expected: 2,  label: 'usuarios' },
  { table: 'categorias',  expected: 9,  label: 'categorias' },
  { table: 'metodos_pago', expected: 5, label: 'métodos de pago' },
  { table: 'cuentas',     expected: 7,  label: 'cuentas' },
  { table: 'quincenas',   expected: 20, label: 'quincenas' },
]

let errors = 0

function ok(msg)  { console.log(`  OK  ${msg}`) }
function fail(msg) { console.log(`  FAIL  ${msg}`); errors++ }

async function checkTables() {
  const result = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  const existing = result.rows.map(r => r.table_name)
  for (const t of EXPECTED_TABLES) {
    if (existing.includes(t)) ok(`Tabla \`${t}\` existe`)
    else { fail(`Tabla \`${t}\` NO existe`); errors++ }
  }
}

async function checkViews() {
  const result = await pool.query(`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'public'
  `)
  const existing = result.rows.map(r => r.table_name)
  for (const v of EXPECTED_VIEWS) {
    if (existing.includes(v)) ok(`Vista \`${v}\` existe`)
    else fail(`Vista \`${v}\` NO existe`)
  }
}

async function checkEnums() {
  const result = await pool.query(`
    SELECT typname FROM pg_type
    WHERE typnamespace = 'public'::regnamespace AND typtype = 'e'
  `)
  const existing = result.rows.map(r => r.typname)
  for (const e of EXPECTED_ENUMS) {
    if (existing.includes(e)) ok(`Enum \`${e}\` existe`)
    else fail(`Enum \`${e}\` NO existe`)
  }
}

async function checkSeeds() {
  for (const { table, expected, label } of SEED_EXPECTED) {
    const result = await pool.query(`SELECT COUNT(*) AS count FROM "${table}"`)
    const count = parseInt(result.rows[0].count, 10)
    if (count === expected) ok(`Seed ${label}: ${count} registros`)
    else fail(`Seed ${label}: esperado ${expected}, obtenido ${count}`)
  }
}

async function checkForeignKeys() {
  const fkChecks = [
    { name: 'transacciones -> quincenas', query: `SELECT COUNT(*) FROM transacciones t WHERE t.quincena_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM quincenas q WHERE q.id = t.quincena_id)` },
    { name: 'transacciones -> categorias', query: `SELECT COUNT(*) FROM transacciones t WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE c.id = t.categoria_id)` },
    { name: 'presupuesto -> quincenas', query: `SELECT COUNT(*) FROM presupuesto p WHERE NOT EXISTS (SELECT 1 FROM quincenas q WHERE q.id = p.quincena_id)` },
    { name: 'presupuesto -> categorias', query: `SELECT COUNT(*) FROM presupuesto p WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE c.id = p.categoria_id)` },
    { name: 'liquidez_snapshots -> quincenas', query: `SELECT COUNT(*) FROM liquidez_snapshots ls WHERE NOT EXISTS (SELECT 1 FROM quincenas q WHERE q.id = ls.quincena_id)` },
  ]

  for (const { name, query } of fkChecks) {
    const result = await pool.query(query)
    const orphans = parseInt(result.rows[0].count, 10)
    if (orphans === 0) ok(`FK integridad: ${name}`)
    else fail(`FK integridad: ${name} - ${orphans} huerfanos`)
  }
}

async function main() {
  console.log('\n=== Verificacion del DDL ===\n')

  console.log('[Tablas]')
  await checkTables()

  console.log('\n[Vistas]')
  await checkViews()

  console.log('\n[Enums]')
  await checkEnums()

  console.log('\n[Seeds]')
  await checkSeeds()

  console.log('\n[Integridad referencial]')
  await checkForeignKeys()

  console.log(`\n=== Resultado: ${errors === 0 ? 'TODO OK' : errors + ' error(es) detectado(s)'} ===\n`)
  process.exit(errors > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
