// Helpers de texto/fecha compartidos entre miloTools.js, budgetTracker.js y
// financeAgent.js. Antes vivian copiados y por separado en varios archivos,
// con diccionarios de alias distintos (uno no conocia "super->supermercado",
// otro no conocia "nafta->gas"), lo que hacia que la misma pregunta se
// resolviera distinto segun que codigo la atendiera. Aqui queda un solo
// diccionario fusionado.

const ZONA_MEXICO = 'America/Mexico_City'

// YYYY-MM-DD del dia en Mexico. Con la zona explicita y no con los getters
// locales: src/index.js fija process.env.TZ, pero un modulo cargado por otro
// camino (un script, una prueba) no tiene por que heredarlo, y en Render el
// reloj del servidor esta en UTC -- despues de las 6pm de Mexico ya seria
// "manana".
function fechaMexico(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_MEXICO, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(fecha)
}

function mexicoDateString() {
  return fechaMexico()
}

function dbDate(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`)
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const TOKEN_ALIASES = {
  gasolina: 'gas',
  combustible: 'gas',
  nafta: 'gas',
  super: 'supermercado',
  despensa: 'supermercado',
}

function tokenSet(value) {
  const tokens = normalize(value).split(' ').filter(token => token.length >= 3)
  return new Set(tokens.flatMap(token => [token, TOKEN_ALIASES[token]].filter(Boolean)))
}

// Umbral de coincidencia por substring unificado en 0.95 (antes 0.92 en
// budgetTracker.js y 0.95 en telegramBrain.js; ninguno de los dos cambia el
// comportamiento observado hoy, se deja un solo valor como fuente de verdad).
function similarity(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.95

  const aTokens = tokenSet(na)
  const bTokens = tokenSet(nb)
  if (!aTokens.size || !bTokens.size) return 0

  let intersection = 0
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1
  return intersection / Math.max(aTokens.size, bTokens.size)
}

module.exports = { ZONA_MEXICO, fechaMexico, mexicoDateString, dbDate, normalize, similarity }
