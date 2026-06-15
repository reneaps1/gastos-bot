require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  await prisma.user.createMany({
    data: [
      { nombre: 'Rene',    phoneWhatsapp: null },
      { nombre: 'Mariana', phoneWhatsapp: null },
    ],
    skipDuplicates: true,
  })

  await prisma.categoria.createMany({
    data: [
      { nombre: 'Hogar',         tipo: 'Gasto',   clasificacion: 'Fijo',     ejemplos: 'Renta, Agua, Luz, Gas, Internet' },
      { nombre: 'Salud',         tipo: 'Gasto',   clasificacion: 'Fijo',     ejemplos: 'Medicamentos, Terapia, Pediatra, Gine, Tradea, Sertralina' },
      { nombre: 'Familia',       tipo: 'Gasto',   clasificacion: 'Variable', ejemplos: 'Super, Pañales, Niñera, Guardería, Croquetas, Fórmula Leo' },
      { nombre: 'Transporte',    tipo: 'Gasto',   clasificacion: 'Variable', ejemplos: 'Gasolina, Gas auto, Casetas, Control vehicular' },
      { nombre: 'Suscripciones', tipo: 'Gasto',   clasificacion: 'Fijo',     ejemplos: 'Netflix, Spotify, Disney+, YouTube, ChatGPT, Claude' },
      { nombre: 'Deudas',        tipo: 'Gasto',   clasificacion: 'Fijo',     ejemplos: 'Préstamos, Coppel, Tanda, Kueski, Pago truck' },
      { nombre: 'Personal',      tipo: 'Gasto',   clasificacion: 'Variable', ejemplos: 'Diversión, Yoga, GYM, Audífonos, Educación, Ropa' },
      { nombre: 'Ingresos',      tipo: 'Ingreso', clasificacion: null,       ejemplos: 'Salario, Vales Despensa, Bono, Prima, Anticipo' },
      { nombre: 'Ahorro',        tipo: 'Ahorro',  clasificacion: null,       ejemplos: 'Fondo emergencia, Meta vacaciones, Ahorro pareja' },
    ],
    skipDuplicates: true,
  })

  await prisma.metodoPago.createMany({
    data: [
      { nombre: 'SPEI' },
      { nombre: 'Efectivo' },
      { nombre: 'Debito' },
      { nombre: 'Vales' },
      { nombre: 'Credito' },
    ],
    skipDuplicates: true,
  })

  await prisma.cuenta.createMany({
    data: [
      { nombre: 'BBVA',           tipo: 'Banco' },
      { nombre: 'Banamex',        tipo: 'Banco' },
      { nombre: 'Ualá',           tipo: 'Digital' },
      { nombre: 'Ualá Inversión', tipo: 'Digital' },
      { nombre: 'Efectivo',       tipo: 'Efectivo' },
      { nombre: 'Vales Despensa', tipo: 'Vales' },
      { nombre: 'Vales Gasolina', tipo: 'Vales' },
    ],
    skipDuplicates: true,
  })

  await prisma.quincena.createMany({
    data: [
      { codigo: 'Q23', fechaInicio: new Date('2026-03-01'), fechaFin: new Date('2026-03-29') },
      { codigo: 'Q24', fechaInicio: new Date('2026-03-30'), fechaFin: new Date('2026-04-14') },
      { codigo: 'Q25', fechaInicio: new Date('2026-04-15'), fechaFin: new Date('2026-04-29') },
      { codigo: 'Q26', fechaInicio: new Date('2026-04-30'), fechaFin: new Date('2026-05-13') },
      { codigo: 'Q27', fechaInicio: new Date('2026-05-15'), fechaFin: new Date('2026-05-28') },
      { codigo: 'Q28', fechaInicio: new Date('2026-05-29'), fechaFin: new Date('2026-06-15') },
      { codigo: 'Q29', fechaInicio: new Date('2026-06-16'), fechaFin: new Date('2026-06-29') },
      { codigo: 'Q30', fechaInicio: new Date('2026-06-30'), fechaFin: new Date('2026-07-14') },
      { codigo: 'Q31', fechaInicio: new Date('2026-07-15'), fechaFin: new Date('2026-07-29') },
      { codigo: 'Q32', fechaInicio: new Date('2026-07-30'), fechaFin: new Date('2026-08-13') },
      { codigo: 'Q33', fechaInicio: new Date('2026-08-14'), fechaFin: new Date('2026-08-27') },
      { codigo: 'Q34', fechaInicio: new Date('2026-08-28'), fechaFin: new Date('2026-09-14') },
      { codigo: 'Q35', fechaInicio: new Date('2026-09-15'), fechaFin: new Date('2026-09-29') },
      { codigo: 'Q36', fechaInicio: new Date('2026-09-30'), fechaFin: new Date('2026-10-13') },
      { codigo: 'Q37', fechaInicio: new Date('2026-10-14'), fechaFin: new Date('2026-10-29') },
      { codigo: 'Q38', fechaInicio: new Date('2026-10-30'), fechaFin: new Date('2026-11-12') },
      { codigo: 'Q39', fechaInicio: new Date('2026-11-13'), fechaFin: new Date('2026-11-29') },
      { codigo: 'Q40', fechaInicio: new Date('2026-11-30'), fechaFin: new Date('2026-12-14') },
      { codigo: 'Q41', fechaInicio: new Date('2026-12-15'), fechaFin: new Date('2026-12-30') },
      { codigo: 'Q42', fechaInicio: new Date('2026-12-31'), fechaFin: new Date('2027-01-14') },
    ],
    skipDuplicates: true,
  })

  const [users, categorias, metodos, cuentas, quincenas] = await Promise.all([
    prisma.user.count(),
    prisma.categoria.count(),
    prisma.metodoPago.count(),
    prisma.cuenta.count(),
    prisma.quincena.count(),
  ])

  console.log('✅ Seed completado:')
  console.log(`   Users: ${users}`)
  console.log(`   Categorias: ${categorias}`)
  console.log(`   Métodos de pago: ${metodos}`)
  console.log(`   Cuentas: ${cuentas}`)
  console.log(`   Quincenas: ${quincenas}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
