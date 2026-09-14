// Entiende frases del tipo "el gasto de suerox mandalo a diversion" y saca las
// dos referencias difusas: QUE movimiento y A QUE linea.
//
// Detector LOCAL por regex, sin red. DeepSeek queda como respaldo en
// src/deepseek.js para frases raras, mismo patron que usa
// classifyQuestionLocally() en src/telegramBrain.js: lo comun se resuelve sin
// depender de que un proveedor externo este vivo.
//
// Solo interpreta texto. No toca la base ni decide nada: lo que devuelve son dos
// cadenas que alguien mas tiene que resolver contra datos reales y poner en un
// boton para que una persona confirme.

const { normalize } = require('./financeUtils')

// Verbos con los que alguien pide mover un gasto de linea. Las formas con
// pronombre pegado ("mandalo") van ANTES que la raiz ("manda") para que la
// alternancia no corte a media palabra.
const VERBOS = [
  'mandalo', 'mandala', 'mandar', 'manda',
  'cambialo', 'cambiala', 'cambiar', 'cambia',
  'pasalo', 'pasala', 'pasar', 'pasa',
  'muevelo', 'muevela', 'mover', 'mueve',
  'ponlo', 'ponla', 'poner', 'pon',
  'asignalo', 'asignala', 'asignar', 'asigna',
  'reasignalo', 'reasignar', 'reasigna',
  'vinculalo', 'vincular', 'vincula',
].join('|')

// Ruido que la gente pone alrededor de la referencia y que no ayuda a buscarla.
const RUIDO_REFERENCIA = /^(?:el|la|los|las|lo|ese|esa|este|esta|mi|un|una)\s+|^(?:gasto|movimiento|cargo|compra|pago)\s+|^(?:de|del)\s+/
const RUIDO_DESTINO = /^(?:la\s+)?(?:linea|partida|categoria|presupuesto)\s+(?:de\s+)?|^(?:el\s+)?presupuesto\s+(?:de\s+)?/

function limpiar(texto, ruido) {
  let out = String(texto || '').trim().replace(/[.,;!?¡¿]+$/g, '').trim()
  // Se aplica varias veces: "el gasto de suerox" necesita tres pasadas.
  for (let i = 0; i < 4; i++) {
    const antes = out
    out = out.replace(ruido, '').trim()
    if (out === antes) break
  }
  return out
}

/**
 * @param {string} texto
 * @returns {{referencia: string, destino: string}|null}
 */
function detectReassign(texto) {
  const n = normalize(texto)
  if (!n) return null

  const match = n.match(new RegExp(`^(.*?)\\b(?:${VERBOS})\\b\\s*(.*)$`))
  if (!match) return null

  let referencia = limpiar(match[1], RUIDO_REFERENCIA)
  let resto = match[2].trim()

  if (referencia) {
    // "el gasto de suerox mandalo a diversion": la referencia iba antes del
    // verbo y lo que sigue es la preposicion mas el destino.
    const destinoMatch = resto.match(/^(?:a|al|en|para|hacia)\s+(.+)$/)
    if (!destinoMatch) return null
    resto = destinoMatch[1]
  } else {
    // "manda el gasto de suerox a diversion": los dos van despues del verbo.
    // Se corta en el ULTIMO " a " porque la referencia puede traer uno propio
    // ("el pago a la niñera a diversion").
    const corte = resto.lastIndexOf(' a ')
    if (corte === -1) return null
    referencia = limpiar(resto.slice(0, corte), RUIDO_REFERENCIA)
    resto = resto.slice(corte + 3)
  }

  const destino = limpiar(resto, RUIDO_DESTINO)
  if (!referencia || !destino) return null

  // Una referencia de una o dos letras haria un LIKE que empata con casi todo.
  if (referencia.length < 3 || destino.length < 3) return null

  return { referencia, destino }
}

module.exports = { detectReassign }
