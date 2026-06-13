const prisma = require('./lib/prisma')

async function findUserByPhone(phone) {
  if (!phone) return null
  return prisma.user.findFirst({ where: { phoneWhatsapp: phone, activo: true } })
}

async function findUserByName(nombre) {
  if (!nombre) return null
  return prisma.user.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, activo: true } })
}

async function findCategoria(nombre) {
  if (!nombre) return null
  return prisma.categoria.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, activo: true } })
}

async function findMetodoPago(nombre) {
  if (!nombre) return null
  return prisma.metodoPago.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' } } })
}

async function findQuincenaByCodigo(codigo) {
  if (!codigo) return null
  return prisma.quincena.findUnique({ where: { codigo } })
}

async function findQuincenaByDate(date) {
  const allQuincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
  return allQuincenas.find(q => date >= q.fechaInicio && date <= q.fechaFin) || null
}

async function messageExists(waMessageId) {
  if (!waMessageId) return false
  const msg = await prisma.whatsappMessage.findFirst({ where: { waMessageId } })
  return !!msg
}

async function saveMessage({ waMessageId, fromNumber, fromName, userId, body, tipo, procesado, transaccionId, error, fechaMensaje }) {
  return prisma.whatsappMessage.create({
    data: {
      waMessageId,
      fromNumber,
      fromName,
      userId,
      body,
      tipo,
      procesado: procesado || false,
      transaccionId,
      error,
      fechaMensaje: fechaMensaje || new Date(),
    },
  })
}

async function saveTransaccion({ fecha, quincenaId, userId, descripcion, categoriaId, clasificacion, tipo, monto, metodoPagoId, estatus, notas, source }) {
  return prisma.transaccion.create({
    data: {
      fecha,
      quincenaId,
      userId,
      descripcion,
      categoriaId,
      clasificacion,
      tipo,
      monto,
      metodoPagoId,
      estatus: estatus || 'Pagado',
      notas,
      source: source || 'whatsapp',
    },
  })
}

async function getTransaccionesByQuincena(quincenaId) {
  return prisma.transaccion.findMany({
    where: { quincenaId },
    include: { categoria: true, user: true, metodoPago: true },
    orderBy: { fecha: 'desc' },
  })
}

async function getResumenQuincena(quincenaId) {
  const [ingresos, gastos, ahorro] = await Promise.all([
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ingreso' }, _sum: { monto: true } }),
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Gasto' }, _sum: { monto: true } }),
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ahorro' }, _sum: { monto: true } }),
  ])
  return {
    ingresos: Number(ingresos._sum.monto ?? 0),
    gastos: Number(gastos._sum.monto ?? 0),
    ahorro: Number(ahorro._sum.monto ?? 0),
  }
}

module.exports = {
  findUserByPhone,
  findUserByName,
  findCategoria,
  findMetodoPago,
  findQuincenaByCodigo,
  findQuincenaByDate,
  messageExists,
  saveMessage,
  saveTransaccion,
  getTransaccionesByQuincena,
  getResumenQuincena,
}
