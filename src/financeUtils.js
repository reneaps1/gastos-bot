// Helpers de texto/fecha compartidos entre miloTools.js, budgetTracker.js y
// telegramBrain.js. Antes vivian copiados y por separado en esos 3 archivos,
// con diccionarios de alias distintos entre budgetTracker.js y telegramBrain.js
// (uno no conocia "super->supermercado", el otro no conocia "nafta->gas"),
// lo que hacia que la misma pregunta se resolviera distinto segun que codigo
// la atendiera. Aqui queda un solo diccionario fusionado.

function mexicoDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

module.exports = { mexicoDateString, dbDate, normalize, similarity }
