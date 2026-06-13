require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  globalForPrisma.prisma = new PrismaClient({ adapter })
}

module.exports = globalForPrisma.prisma
