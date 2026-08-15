// Corrección de datos, uso único — NO es una migración de Prisma y no debe
// ejecutarse automáticamente en el deploy.
//
// Ajusta las quincenas Q33 en adelante para que los cierres de fin de mes
// usen el último día hábil del mes (ver DEVELOPMENT_POLICY.md y la función
// lastBusinessDayOfMonth en src/quincenas.js). Las quincenas ya cerradas
// (Q23-Q31) NO se tocan.
//
// Uso: node prisma/scripts/fix-quincena-month-end.js
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// codigo -> { fechaInicio?, fechaFin? } — solo se actualizan los campos presentes
const FIXES = {
  Q33: { fechaFin: '2026-08-31' },
  Q34: { fechaInicio: '2026-09-01' },
  Q35: { fechaFin: '2026-09-30' },
  Q36: { fechaInicio: '2026-10-01' },
  Q37: { fechaFin: '2026-10-30' },
  Q38: { fechaInicio: '2026-10-31' },
  Q39: { fechaFin: '2026-11-30' },
  Q40: { fechaInicio: '2026-12-01' },
  Q41: { fechaFin: '2026-12-31' },
  Q42: { fechaInicio: '2027-01-01' },
}

async function main() {
  for (const [codigo, cambios] of Object.entries(FIXES)) {
    const existing = await prisma.quincena.findFirst({ where: { codigo } })
    if (!existing) {
      console.log(`⚠ ${codigo} no existe en la base de datos, se omite.`)
      continue
    }
    const data = {}
    if (cambios.fechaInicio) data.fechaInicio = new Date(cambios.fechaInicio)
    if (cambios.fechaFin) data.fechaFin = new Date(cambios.fechaFin)

    const before = { fechaInicio: existing.fechaInicio.toISOString().split('T')[0], fechaFin: existing.fechaFin.toISOString().split('T')[0] }
    await prisma.quincena.update({ where: { id: existing.id }, data })
    console.log(`✓ ${codigo}: ${JSON.stringify(before)} -> ${JSON.stringify({ ...before, ...cambios })}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
