require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const q25 = await prisma.quincena.findUnique({ where: { codigo: 'Q25' } })

  const gastos = await prisma.transaccion.findMany({
    where: { quincenaId: q25.id, tipo: 'Gasto' },
    include: { categoria: true },
    orderBy: { fecha: 'asc' },
  })

  console.log(`Q25 gastos: ${gastos.length} transacciones`)
  console.log(`Total: ${gastos.reduce((sum, t) => sum + Number(t.monto), 0).toFixed(2)}`)
  console.log('')

  for (const t of gastos) {
    console.log(`${t.fecha.toISOString().slice(0,10)} | ${t.descripcion.padEnd(30)} | ${t.categoria.nombre.padEnd(15)} | ${Number(t.monto).toFixed(2)}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
