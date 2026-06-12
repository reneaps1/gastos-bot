const CATEGORIAS = {
  comida: ['comida', 'comer', 'restaurante', 'mcdonalds', 'pizza', 'tacos', 'helado', 'cafe', 'café', 'starbucks', 'subway', 'burger', 'sushi', 'denny', 'wendys', 'wings', 'taqueria', 'taquería', 'lonchera', 'almuerzo', 'cena', 'desayuno', 'comida rapida'],
  transporte: ['transporte', 'gasolina', 'gas', 'uber', 'didí', 'didi', 'taxi', 'estacionamiento', 'parking', 'metro', 'autobus', 'camion', 'peaje', 'caseta', 'uber', 'blablacar', 'tren'],
  entretenimiento: ['entretenimiento', 'pelicula', 'cine', 'netflix', 'spotify', 'disney', 'hbo', 'amazon prime', 'videojuego', 'juego', 'party', 'fiesta', 'bar', 'cerveza', 'tequila', 'vodka', 'ron', 'whisky'],
  salud: ['salud', 'medico', 'doctor', 'farmacia', 'medicina', 'medicinas', 'hospital', 'dentista', 'oftalmologo', 'consulta', 'examen', 'vitamina', 'suplemento'],
  hogar: ['hogar', 'casa', 'renta', 'luz', 'agua', 'internet', 'telefono', 'celular', ' electricidad', 'gas natural', 'mantenimiento', 'limpieza', 'lavanderia', 'lavandería'],
  ropa: ['ropa', 'zapatos', 'camisa', 'pantalon', 'pantalón', 'tenis', 'zapatillas', 'vestido', 'falda', 'chaqueta', 'abrigo'],
  educacion: ['educacion', 'educación', 'curso', 'clase', 'libro', 'escuela', 'universidad', 'taller', 'diplomado', 'certificacion'],
  ahorro: ['ahorro', 'inversion', 'inversión', 'fondo', 'crypto', 'bitcoin', 'acciones', 'bonos'],
  otros: ['otro', 'otros', 'miscelanea', 'miscelánea', 'varios', 'general'],
};

const FORMAS_PAGO = {
  efectivo: ['efectivo', 'efec', 'ef', 'cash', 'dinero'],
  tarjeta: ['tarjeta', 'tar', 'visa', 'mastercard', 'amex', 'credito', 'crédito', 'debito', 'débito', 'nómina', 'nomina'],
  transferencia: ['transferencia', 'trans', 'transfer', 'spei', 'clabe', 'banco'],
  mercadopago: ['mercadopago', 'mercado pago', 'mp'],
};

const INGRESO_KEYWORDS = ['ingreso', 'ingresos', 'pago', 'cobro', 'cobrado', 'salario', 'nomina', 'nómina', 'sueldo', 'freelance', 'bono', 'extra', 'recibido', 'ganancia', 'ganado'];
const GASTO_KEYWORDS = ['gasto', 'gasté', 'gaste', 'pagué', 'pague', 'compré', 'compre', 'pago', 'compra', 'gastamos', 'pagamos'];

const USUARIO_DEFAULT = 'Rene';
const FORMA_PAGO_DEFAULT = 'Efectivo';
const TIPO_DEFAULT_GASTO = 'Gasto';
const TIPO_DEFAULT_INGRESO = 'Ingreso';
const CLASIFICACION_DEFAULT_GASTO = 'Variable';
const CLASIFICACION_DEFAULT_INGRESO = 'Ingreso';
const ESTATUS_DEFAULT = 'Pagado';

function getCurrentQuincena() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const quincenaNum = Math.ceil((day > 15 ? 2 : 1) + (month - 1) * 2);
  return `Q${quincenaNum}`;
}

function getCurrentDateFormatted() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTimestamp() {
  const now = new Date();
  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  };
  return now.toLocaleString('es-MX', options);
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORIAS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  }
  return 'Otros';
}

function detectPaymentMethod(text) {
  const lower = text.toLowerCase();
  for (const [method, keywords] of Object.entries(FORMAS_PAGO)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return method.charAt(0).toUpperCase() + method.slice(1);
    }
  }
  return FORMA_PAGO_DEFAULT;
}

function detectType(text) {
  const lower = text.toLowerCase();
  for (const kw of INGRESO_KEYWORDS) {
    if (lower.includes(kw)) return TIPO_DEFAULT_INGRESO;
  }
  return TIPO_DEFAULT_GASTO;
}

function extractAmount(text) {
  const patterns = [
    /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
    /(\d+(?:\.\d{1,2})?)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

function extractDescription(text, amount) {
  let desc = text;
  if (amount !== null) {
    desc = desc.replace(new RegExp(`\\$?\\s*${amount.toString().replace('.', '\\.').replace(/,/g, ',')}\\s*`), ' ');
  }

  const removeWords = [
    'gasté', 'gaste', 'pagué', 'pague', 'compré', 'compre',
    'gasto', 'pago', 'compra', 'ingreso', 'cobro', 'recibí', 'recibi',
    'en', 'de', 'para', 'con', 'por', 'el', 'la', 'los', 'las',
    'un', 'una', 'unos', 'unas', 'del', 'al',
  ];
  for (const w of removeWords) {
    desc = desc.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
  }

  desc = desc.replace(/\s+/g, ' ').trim();
  if (desc.length > 50) desc = desc.substring(0, 50);

  return desc || 'Sin descripcion';
}

function parseMessage(text, senderName) {
  const tipo = detectType(text);
  const monto = extractAmount(text);
  const descripcion = extractDescription(text, monto);
  const categoria = detectCategory(text);
  const formaPago = detectPaymentMethod(text);
  const clasificacion = tipo === 'Ingreso' ? CLASIFICACION_DEFAULT_INGRESO : CLASIFICACION_DEFAULT_GASTO;
  const quincena = getCurrentQuincena();
  const estatus = ESTATUS_DEFAULT;
  const timestamp = getCurrentTimestamp();
  const fechaFormat = getCurrentDateFormatted();

  return [
    timestamp,
    senderName || USUARIO_DEFAULT,
    monto || 0,
    descripcion,
    categoria,
    formaPago,
    tipo,
    clasificacion,
    quincena,
    estatus,
    fechaFormat,
  ];
}

function formatConfirmation(row) {
  const [fecha, usuario, monto, descripcion, categoria, formaPago, tipo, clasificacion, quincena, estatus] = row;
  return [
    `✅ *${tipo} registrado*`,
    ``,
    `📅 ${fecha}`,
    `👤 ${usuario}`,
    `$${monto}`,
    `📝 ${descripcion}`,
    `🏷️ ${categoria}`,
    `💳 ${formaPago}`,
    `📊 ${quincena} - ${clasificacion}`,
    `✅ ${estatus}`,
  ].join('\n');
}

module.exports = { parseMessage, formatConfirmation };
