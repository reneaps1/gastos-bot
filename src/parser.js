const { getCurrentQuincena } = require('./quincenas')

const CATEGORIAS = {
  hogar: ['hogar', 'casa', 'renta', 'luz', 'agua', 'internet', 'telefono', 'celular', 'electricidad', 'gas natural', 'gas de casa', 'mantenimiento', 'limpieza', 'lavanderia', 'lavandería'],
  salud: ['salud', 'medico', 'doctor', 'farmacia', 'medicina', 'medicinas', 'hospital', 'dentista', 'oftalmologo', 'consulta', 'examen', 'vitamina', 'suplemento', 'gine', 'terapia', 'pediatra', 'tradea', 'sertralina', 'medicamento'],
  familia: ['familia', 'super', 'mercado', 'tienda', 'pañales', 'ninera', 'guarderia', 'guardería', 'croquetas', 'comida', 'comer', 'restaurante', 'mcdonalds', 'pizza', 'tacos', 'helado', 'cafe', 'tortillas', 'formula', 'fórmula'],
  transporte: ['transporte', 'gasolina', 'gas', 'gas spark', 'gas corolla', 'gasolina corolla', 'uber', 'didí', 'didi', 'taxi', 'estacionamiento', 'parking', 'metro', 'autobus', 'camion', 'peaje', 'caseta'],
  suscripciones: ['suscripciones', 'suscripción', 'netflix', 'spotify', 'disney', 'disney+', 'youtube', 'youtube premium', 'hbo', 'amazon prime', 'chatgpt', 'chat gpt', 'obsidian', 'claude'],
  deudas: ['deudas', 'deuda', 'prestamo', 'préstamo', 'coppel', 'tanda', 'kueski', 'abono deuda', 'pago plata', 'pago truck', 'pago cesar', 'pago de truck'],
  personal: ['personal', 'diversion', 'diversión', 'yoga', 'gym', 'gy m', 'maestria', 'maestría', 'corte', 'pelo', 'ropa', 'zapatos', 'camisa', 'pantalon', 'pantalón', 'tenis', 'zapatillas', 'viaje', 'vacaciones', 'educacion', 'educación', 'audifonos', 'audífonos', 'libro', 'cursos'],
  ingresos: ['ingreso', 'ingresos', 'pago', 'cobro', 'cobrado', 'salario', 'nomina', 'nómina', 'sueldo', 'freelance', 'bono', 'extra', 'recibido', 'ganancia', 'ganado', 'vales', 'vales despensa', 'prima', 'anticipo'],
  ahorro: ['ahorro', 'ahorro pareja', 'inversion', 'inversión', 'fondo', 'crypto', 'bitcoin', 'acciones', 'bonos'],
}

const FORMAS_PAGO = {
  efectivo: ['efectivo', 'efec', 'ef', 'cash', 'dinero'],
  debito: ['tarjeta', 'tar', 'visa', 'mastercard', 'amex', 'debito', 'débito', 'nómina', 'nomina'],
  spei: ['transferencia', 'trans', 'transfer', 'spei', 'clabe', 'banco'],
  vales: ['vales', 'vale', 'vales despensa', 'vales gasolina'],
}

const INGRESO_KEYWORDS = ['ingreso', 'ingresos', 'pago', 'cobro', 'cobrado', 'salario', 'nomina', 'nómina', 'sueldo', 'freelance', 'bono', 'extra', 'recibido', 'ganancia', 'ganado']

const CLASIFICACION_POR_CATEGORIA = {
  Hogar: 'Fijo',
  Salud: 'Fijo',
  Familia: 'Variable',
  Transporte: 'Variable',
  Suscripciones: 'Fijo',
  Deudas: 'Fijo',
  Personal: 'Variable',
  Ingresos: null,
  Ahorro: null,
}

function getClasificacion(categoria, tipo) {
  if (tipo === 'Ingreso' || tipo === 'Ahorro') return null
  return CLASIFICACION_POR_CATEGORIA[categoria] || 'Variable'
}

function detectCategory(text) {
  const lower = text.toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORIAS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat.charAt(0).toUpperCase() + cat.slice(1)
    }
  }
  return null
}

function detectPaymentMethod(text) {
  const lower = text.toLowerCase()
  for (const [method, keywords] of Object.entries(FORMAS_PAGO)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return method.charAt(0).toUpperCase() + method.slice(1)
    }
  }
  return null
}

function detectType(text) {
  const lower = text.toLowerCase()
  for (const kw of INGRESO_KEYWORDS) {
    if (lower.includes(kw)) return 'Ingreso'
  }
  return 'Gasto'
}

function extractAmount(text) {
  const patterns = [
    /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
    /(\d+(?:\.\d{1,2})?)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const numStr = match[1].replace(/,/g, '')
      const num = parseFloat(numStr)
      if (!isNaN(num) && num > 0) return num
    }
  }
  return null
}

function extractDescription(text, amount) {
  let desc = text
  if (amount !== null) {
    desc = desc.replace(new RegExp(`\\$?\\s*${amount.toString().replace('.', '\\.').replace(/,/g, ',')}\\s*`), ' ')
  }
  const removeWords = [
    'gasté', 'gaste', 'pagué', 'pague', 'compré', 'compre',
    'gasto', 'pago', 'compra', 'ingreso', 'cobro', 'recibí', 'recibi',
    'en', 'de', 'para', 'con', 'por', 'el', 'la', 'los', 'las',
    'un', 'una', 'unos', 'unas', 'del', 'al',
  ]
  for (const w of removeWords) {
    desc = desc.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
  }
  desc = desc.replace(/\s+/g, ' ').trim()
  if (desc.length > 200) desc = desc.substring(0, 200)
  return desc || 'Sin descripcion'
}

function parseMessage(text, senderName, senderPhone, messageId, geminiData = null) {
  const tipo = geminiData?.tipo || detectType(text)
  const monto = (geminiData?.monto > 0 ? geminiData.monto : null) ?? extractAmount(text)
  const descripcion = geminiData?.descripcion || extractDescription(text, monto)
  const categoria = geminiData?.categoria || detectCategory(text)
  const formaPago = geminiData?.formaPago || detectPaymentMethod(text)
  const clasificacion = getClasificacion(categoria, tipo)
  const quincena = getCurrentQuincena()

  return {
    timestamp: new Date(),
    fecha: new Date(),
    usuario: senderName || 'Rene',
    phone: senderPhone || null,
    monto: monto || 0,
    descripcion,
    categoria: categoria || 'Personal',
    formaPago: formaPago || 'Efectivo',
    tipo,
    clasificacion,
    quincena,
    estatus: 'Pagado',
    messageId: messageId || null,
  }
}

function formatConfirmation(parsed) {
  return [
    `✅ *${parsed.tipo} registrado*`,
    ``,
    `📅 ${parsed.fecha.toLocaleDateString('es-MX')}`,
    `👤 ${parsed.usuario}`,
    `$${parsed.monto}`,
    `📝 ${parsed.descripcion}`,
    `🏷️ ${parsed.categoria}`,
    `💳 ${parsed.formaPago}`,
    `📊 ${parsed.quincena} - ${parsed.clasificacion || ''}`,
    `✅ ${parsed.estatus}`,
  ].join('\n')
}

module.exports = { parseMessage, formatConfirmation }
