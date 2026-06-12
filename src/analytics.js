const { getRows } = require('./sheets');
const { getCurrentQuincena } = require('./quincenas');

function parseRows(rows) {
  return rows.map(r => ({
    fecha: r[0] || '',
    usuario: r[1] || '',
    monto: parseFloat(r[2]) || 0,
    descripcion: r[3] || '',
    categoria: r[4] || '',
    formaPago: r[5] || '',
    tipo: r[6] || '',
    clasificacion: r[7] || '',
    quincena: r[8] || '',
    estatus: r[9] || '',
    fechaFormat: r[10] || '',
    phone: r[11] || '',
  }));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thisWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMoney(n) {
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function detectIntent(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Gasto hoy
  if (/cuanto.*(gaste|gasto|gastado).*hoy|gaste.*hoy|hoy.*cuanto|gasto de hoy|cuanto llevo hoy/.test(lower)) {
    return 'gasto_hoy';
  }

  // Gasto ayer
  if (/cuanto.*(gaste|gasto|gastado).*ayer|ayer.*cuanto|gasto de ayer/.test(lower)) {
    return 'gasto_ayer';
  }

  // Gasto esta semana
  if (/cuanto.*(gaste|gasto|gastado).*(semana|esta semana|la semana)|esta semana|semana/.test(lower)) {
    return 'gasto_semana';
  }

  // Gasto este mes
  if (/cuanto.*(gaste|gasto|gastado).*(mes|este mes|el mes)|este mes|mes actual/.test(lower)) {
    return 'gasto_mes';
  }

  // Gasto por categoría
  if (/cuanto.*(gaste|gasto|gastado|gasté).*(en|por|de|categoría|categoria|comida|transporte|entretenimiento|salud|hogar|ropa|educación|educacion|ahorro|otros)/.test(lower)) {
    return 'gasto_categoria';
  }

  // Gasto específico (algo en particular)
  if (/cuanto.*(gaste|gasto|gastado|gasté).*(en|de|por)\s+\w+|cuanto.*llevo.*en/.test(lower)) {
    return 'gasto_especifico';
  }

  // Balance / cuánto me queda
  if (/cuanto.*(queda|quedo|me queda|saldo|balance|disponible|tengo|dispongo)/.test(lower)) {
    return 'balance';
  }

  // Últimos gastos
  if (/ultimos|últimos|recientes|que (gaste|gasté|gasto|compré|compre)|cuando|ver gastos|ver movimientos/.test(lower)) {
    return 'ultimos';
  }

  // Top gastos
  if (/mayores|top|mas gastado|más gastado|grandes|mayor|ranking|principales/.test(lower)) {
    return 'top';
  }

  // Resumen quincenal
  if (/resumen|quincena|quincenal|como voy|cómo voy/.test(lower)) {
    return 'resumen';
  }

  // Gastos por forma de pago
  if (/cuanto.*(gaste|gasto|gastado).*(tarjeta|efectivo|transferencia|mercadopago|credito|debito)/.test(lower)) {
    return 'gasto_pago';
  }

  // Ingresos
  if (/cuanto.*(ingreso|gané|gane|cobré|cobre|recibí|recibi)|ingresos/.test(lower)) {
    return 'ingresos';
  }

  // Diario promedio
  if (/promedio|prom|diario|al dia|al día/.test(lower)) {
    return 'promedio';
  }

  // Ayuda
  if (/ayuda|help|comandos|opciones|que puedo|qué puedo/.test(lower)) {
    return 'ayuda';
  }

  return null;
}

async function handleQuestion(text, senderName) {
  const intent = detectIntent(text);
  if (!intent) return null;

  const rows = await getRows();
  const data = parseRows(rows);

  switch (intent) {
    case 'gasto_hoy': return gastoHoy(data, senderName);
    case 'gasto_ayer': return gastoAyer(data, senderName);
    case 'gasto_semana': return gastoSemana(data, senderName);
    case 'gasto_mes': return gastoMes(data, senderName);
    case 'gasto_categoria': return gastoCategoria(data, text, senderName);
    case 'gasto_especifico': return gastoEspecifico(data, text, senderName);
    case 'balance': return balance(data, senderName);
    case 'ultimos': return ultimos(data, senderName);
    case 'top': return top(data, senderName);
    case 'resumen': return resumen(data, senderName);
    case 'gasto_pago': return gastoPago(data, text, senderName);
    case 'ingresos': return ingresos(data, senderName);
    case 'promedio': return promedio(data, senderName);
    case 'ayuda': return help();
    default: return null;
  }
}

function gastoHoy(data, name) {
  const todayStr = today();
  const gastos = data.filter(d => d.fechaFormat === todayStr && d.tipo === 'Gasto');
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `Hoy no has registrado gastos todavía.`;

  let msg = `📅 *Gastos de hoy*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  gastos.forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria})\n`;
  });
  return msg;
}

function gastoAyer(data, name) {
  const yesterdayStr = yesterday();
  const gastos = data.filter(d => d.fechaFormat === yesterdayStr && d.tipo === 'Gasto');
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `Ayer no registraste gastos.`;

  let msg = `📅 *Gastos de ayer*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  gastos.forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria})\n`;
  });
  return msg;
}

function gastoSemana(data, name) {
  const weekStart = thisWeekStart();
  const todayStr = today();
  const gastos = data.filter(d => d.fechaFormat >= weekStart && d.fechaFormat <= todayStr && d.tipo === 'Gasto');
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `Esta semana no has registrado gastos.`;

  const porCategoria = {};
  gastos.forEach(g => {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
  });

  let msg = `📅 *Gastos de esta semana*\n`;
  msg += `📆 ${weekStart} al ${todayStr}\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  msg += `Por categoría:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, monto]) => {
      msg += `• ${cat}: $${formatMoney(monto)}\n`;
    });
  return msg;
}

function gastoMes(data, name) {
  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto');
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `Este mes no has registrado gastos.`;

  const porCategoria = {};
  gastos.forEach(g => {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
  });

  let msg = `📅 *Gastos de este mes*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  msg += `Por categoría:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, monto]) => {
      msg += `• ${cat}: $${formatMoney(monto)}\n`;
    });
  return msg;
}

function gastoCategoria(data, text, name) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cats = ['hogar', 'salud', 'familia', 'transporte', 'suscripciones', 'deudas', 'personal', 'ahorro'];
  let found = cats.find(c => lower.includes(c));
  if (!found) {
    const aliases = {
      super: 'familia', mercado: 'familia', comida: 'familia', tacos: 'familia', pizza: 'familia',
      mcdonalds: 'familia', starbucks: 'familia', cafe: 'familia', tortillas: 'familia',
      uber: 'transporte', didi: 'transporte', taxi: 'transporte', gasolina: 'transporte',
      gas: 'transporte', netflix: 'suscripciones', spotify: 'suscripciones', disney: 'suscripciones',
      youtube: 'suscripciones', farmacia: 'salud', medico: 'salud', doctor: 'salud',
      gine: 'salud', terapia: 'salud', luz: 'hogar', agua: 'hogar', internet: 'hogar',
      telefono: 'hogar', coppel: 'deudas', deuda: 'deudas', diversion: 'personal',
      gym: 'personal', audifonos: 'personal', ropa: 'personal', educacion: 'personal'
    };
    for (const [alias, cat] of Object.entries(aliases)) {
      if (lower.includes(alias)) { found = cat; break; }
    }
  }
  if (!found) return `No detecté la categoría. Prueba con: hogar, salud, familia, transporte, suscripciones, deudas, personal.`;

  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto' && d.categoria.toLowerCase() === found);
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `No tienes gastos en *${found}* este mes.`;

  let msg = `🏷️ *${found.charAt(0).toUpperCase() + found.slice(1)} este mes*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  gastos.slice(0, 10).forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n`;
  });
  if (gastos.length > 10) msg += `\n... y ${gastos.length - 10} más`;
  return msg;
}

function gastoEspecifico(data, text, name) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = lower.split(/\s+/);
  const skip = ['cuanto', 'gaste', 'gasto', 'gastado', 'gasté', 'en', 'de', 'por', 'la', 'el', 'los', 'las', 'un', 'una', 'llevo', 'lleve'];
  const searchWords = words.filter(w => !skip.includes(w) && w.length > 2);

  if (searchWords.length === 0) return `No detecté en qué gastaste. Prueba: "cuanto gaste en McDonalds"`;

  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto');
  const matches = gastos.filter(g => {
    const desc = g.descripcion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return searchWords.some(w => desc.includes(w));
  });

  const total = matches.reduce((s, d) => s + d.monto, 0);

  if (matches.length === 0) return `No encontré gastos relacionados con "${searchWords.join(' ')}" este mes.`;

  let msg = `🔍 *"${searchWords.join(' ')}" este mes*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${matches.length} vez(es)\n\n`;
  matches.slice(0, 5).forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n`;
  });
  return msg;
}

function balance(data, name) {
  const month = getCurrentMonth();
  const ingresos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Ingreso');
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto');
  const totalIngresos = ingresos.reduce((s, d) => s + d.monto, 0);
  const totalGastos = gastos.reduce((s, d) => s + d.monto, 0);
  const disponible = totalIngresos - totalGastos;

  let msg = `💰 *Balance del mes*\n\n`;
  msg += `📈 Ingresos: *$${formatMoney(totalIngresos)}*\n`;
  msg += `📉 Gastos: *$${formatMoney(totalGastos)}*\n`;
  msg += `💵 Disponible: *$${formatMoney(disponible)}*\n\n`;

  if (disponible > 0) {
    msg += `✅ vas bien, te quedan $${formatMoney(disponible)}`;
  } else if (disponible === 0) {
    msg += `⚠️ estás al cero`;
  } else {
    msg += `🔴 vas en negativo por $${formatMoney(Math.abs(disponible))}`;
  }
  return msg;
}

function ultimos(data, name) {
  const sorted = [...data].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const last10 = sorted.slice(0, 10);

  if (last10.length === 0) return `No hay registros aún.`;

  let msg = `📋 *Últimos movimientos*\n\n`;
  last10.forEach(g => {
    const icon = g.tipo === 'Gasto' ? '📉' : '📈';
    msg += `${icon} $${formatMoney(g.monto)} - ${g.descripcion} (${g.categoria})\n`;
    msg += `   📅 ${g.fechaFormat} | ${g.formaPago}\n\n`;
  });
  return msg;
}

function top(data, name) {
  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto');
  if (gastos.length === 0) return `No hay gastos este mes.`;

  const sorted = [...gastos].sort((a, b) => b.monto - a.monto).slice(0, 10);
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  let msg = `🏆 *Top 10 gastos del mes*\n\n`;
  sorted.forEach((g, i) => {
    const pct = ((g.monto / total) * 100).toFixed(1);
    msg += `${i + 1}. $${formatMoney(g.monto)} - ${g.descripcion}\n`;
    msg += `   📅 ${g.fechaFormat} | 🏷️ ${g.categoria} | ${pct}%\n\n`;
  });
  return msg;
}

function resumen(data, name) {
  const q = getCurrentQuincena();
  const month = getCurrentMonth();
  const quincenaData = data.filter(d => d.quincena === q);
  const monthData = data.filter(d => d.fechaFormat.startsWith(month));

  const gastosQ = quincenaData.filter(d => d.tipo === 'Gasto').reduce((s, d) => s + d.monto, 0);
  const ingresosQ = quincenaData.filter(d => d.tipo === 'Ingreso').reduce((s, d) => s + d.monto, 0);
  const gastosM = monthData.filter(d => d.tipo === 'Gasto').reduce((s, d) => s + d.monto, 0);
  const ingresosM = monthData.filter(d => d.tipo === 'Ingreso').reduce((s, d) => s + d.monto, 0);

  const porCategoria = {};
  quincenaData.filter(d => d.tipo === 'Gasto').forEach(g => {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
  });

  let msg = `📊 *Resumen ${q}*\n\n`;
  msg += `💵 *Quincena:*\n`;
  msg += `  📈 Ingresos: $${formatMoney(ingresosQ)}\n`;
  msg += `  📉 Gastos: $${formatMoney(gastosQ)}\n`;
  msg += `  💰 Disponible: *$${formatMoney(ingresosQ - gastosQ)}*\n\n`;
  msg += `📅 *Mes (${month}):*\n`;
  msg += `  📈 Ingresos: $${formatMoney(ingresosM)}\n`;
  msg += `  📉 Gastos: $${formatMoney(gastosM)}\n`;
  msg += `  💰 Disponible: *$${formatMoney(ingresosM - gastosM)}*\n\n`;

  if (Object.keys(porCategoria).length > 0) {
    msg += `Por categoría (${q}):\n`;
    Object.entries(porCategoria)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, monto]) => {
        msg += `• ${cat}: $${formatMoney(monto)}\n`;
      });
  }
  return msg;
}

function gastoPago(data, text, name) {
  const lower = text.toLowerCase();
  const pagos = ['efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'credito', 'debito'];
  const found = pagos.find(p => lower.includes(p));
  if (!found) return `No detecté la forma de pago. Prueba con: efectivo, tarjeta, transferencia`;

  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto' && d.formaPago.toLowerCase().includes(found));
  const total = gastos.reduce((s, d) => s + d.monto, 0);

  if (gastos.length === 0) return `No tienes gastos con *${found}* este mes.`;

  let msg = `💳 *${found.charAt(0).toUpperCase() + found.slice(1)} este mes*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${gastos.length} movimiento(s)\n\n`;
  gastos.slice(0, 10).forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n`;
  });
  return msg;
}

function ingresos(data, name) {
  const month = getCurrentMonth();
  const ing = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Ingreso');
  const total = ing.reduce((s, d) => s + d.monto, 0);

  if (ing.length === 0) return `No tienes ingresos registrados este mes.`;

  let msg = `📈 *Ingresos del mes*\n\n`;
  msg += `💰 Total: *$${formatMoney(total)}*\n`;
  msg += `📝 ${ing.length} registro(s)\n\n`;
  ing.forEach(g => {
    msg += `• $${formatMoney(g.monto)} - ${g.descripcion} (${g.fechaFormat})\n`;
  });
  return msg;
}

function promedio(data, name) {
  const month = getCurrentMonth();
  const gastos = data.filter(d => d.fechaFormat.startsWith(month) && d.tipo === 'Gasto');
  if (gastos.length === 0) return `No hay datos para calcular promedio.`;

  const total = gastos.reduce((s, d) => s + d.monto, 0);
  const days = new Set(gastos.map(d => d.fechaFormat)).size;
  const prom = total / days;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const projected = prom * daysInMonth;

  let msg = `📊 *Promedio diario este mes*\n\n`;
  msg += `💰 Promedio: *$${formatMoney(prom)}/día*\n`;
  msg += `📅 Días con registros: ${days}\n`;
  msg += `📈 Proyección fin de mes: *$${formatMoney(projected)}*\n`;
  return msg;
}

function help() {
  return [
    `🤖 *Bot de Gastos - Comandos*`,
    ``,
    `*Registrar:*`,
    `• gasto 149 McDonalds comida`,
    `• gaste 36 estacionamiento`,
    `• ingreso 3500 pago`,
    ``,
    `*Consultar:*`,
    `• cuanto gaste hoy`,
    `• cuanto gaste ayer`,
    `• cuanto gaste esta semana`,
    `• cuanto gaste este mes`,
    ``,
    `*Por categoría:*`,
    `• cuanto gaste en familia`,
    `• cuanto gaste en transporte`,
    `• cuanto gaste en salud`,
    `• cuanto gaste en personal`,
    ``,
    `*Por algo específico:*`,
    `• cuanto gaste en McDonalds`,
    `• cuanto gaste en uber`,
    ``,
    `*Balance:*`,
    `• cuanto me queda`,
    `• balance`,
    ``,
    `*Otros:*`,
    `• ultimos - últimos movimientos`,
    `• top - top 10 gastos del mes`,
    `• resumen - resumen quincenal`,
    `• ingresos - ver ingresos del mes`,
    `• promedio - promedio diario`,
    `• gasto en efectivo - por forma de pago`,
  ].join('\n');
}

module.exports = { handleQuestion, detectIntent };
