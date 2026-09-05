const prisma = require('./lib/prisma')
const { resolverTipoYDireccion } = require('./tipoAhorro')

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

async function listQuincenas() {
  return prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
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

async function saveTransaccion({ fecha, quincenaId, quincenaConsumoId, userId, descripcion, categoriaId, clasificacion, tipo, monto, metodoPagoId, creditoId, fechaPagoProgramada, estatus, notas, source }) {
  // Red de seguridad: sin importar que tipo haya decidido el parser/Gemini,
  // toda transaccion de una categoria "Ahorro" debe quedar con tipo:'Ahorro'
  // (ver tipoAhorro.js) para que el resumen de quincena y las cards del
  // dashboard, que agregan por tipo, siempre la vean.
  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } })
  const { tipo: tipoResuelto, direccion } = resolverTipoYDireccion(categoria?.tipo, tipo, null)

  return prisma.transaccion.create({
    data: {
      fecha,
      quincenaId,
      quincenaConsumoId: quincenaConsumoId || quincenaId,
      userId,
      descripcion,
      categoriaId,
      clasificacion,
      tipo: tipoResuelto,
      direccion,
      monto,
      metodoPagoId,
      creditoId,
      fechaPagoProgramada,
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
  const [ingresos, gastos, aportes, retiros] = await Promise.all([
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ingreso' }, _sum: { monto: true } }),
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Gasto' }, _sum: { monto: true } }),
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ahorro', direccion: 'Aporte' }, _sum: { monto: true } }),
    prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ahorro', direccion: 'Retiro' }, _sum: { monto: true } }),
  ])
  // Aporte suma, Retiro resta -- toda transaccion de categoria Ahorro
  // comparte tipo:'Ahorro' (ver src/tipoAhorro.js), asi que un blind SUM
  // aqui inflaria el total en vez de netear los retiros.
  return {
    ingresos: Number(ingresos._sum.monto ?? 0),
    gastos: Number(gastos._sum.monto ?? 0),
    ahorro: Number(aportes._sum.monto ?? 0) - Number(retiros._sum.monto ?? 0),
  }
}

module.exports = {
  findUserByPhone,
  findUserByName,
  findCategoria,
  findMetodoPago,
  findQuincenaByCodigo,
  listQuincenas,
  messageExists,
  saveMessage,
  saveTransaccion,
  getTransaccionesByQuincena,
  getResumenQuincena,
}
