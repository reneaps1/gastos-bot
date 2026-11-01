// Decide a donde va un mensaje de texto de Telegram, sin red ni base.
//
// Regla: los regex solo deciden lo INEQUIVOCO. Un gasto con formato claro
// ("200 super", "$150, uber", "gaste 350 en gasolina") va directo al parser.
// Todo lo que tenga cara de pregunta va al agente, que es el unico cerebro
// para preguntas. Lo que trae un numero pero no tiene formato claro ("super
// 200 ayer") es ambiguo: lo decide el clasificador de IA, y solo se registra
// si dice que es un gasto.
//
// Por que existe: antes una cascada de siete capas probaba regex de preguntas,
// intents fijos y, si todo fallaba, mandaba el texto al parser. Asi "¿me
// alcanza para los 5000 de la tarjeta?" terminaba registrado como un gasto de
// $5000. Aqui una pregunta NUNCA puede salir con ruta 'gasto'.
//
//   'reasignar'       -> "mandalo a X": habla de un gasto que YA existe y solo
//                        se propone con un boton. Va antes que todo, como en
//                        main: "30 suerox mandalo a diversion" empieza con monto
//                        y sin esto se registraba como un gasto nuevo de $30.
//   'gasto'           -> parser, se registra (el enlace a una linea sigue siendo
//                        un boton). Si hay IA, classify solo ENRIQUECE (tipo,
//                        categoria); si no contesta, se usa el parser local.
//   'ambiguo'         -> aiRouter.classify; se registra solo si dice expense
//   'quiza-reasignar' -> trae un verbo de mover que detectReassign no entiende
//                        ("pon el uber en transporte"); classify decide si es
//                        una reasignacion y, si no, va al agente
//   'agente'          -> financeAgent

const { detectReassign, VERBOS_REASIGNAR } = require('./reassignIntent')

// Emojis y sus modificadores: "🛒 200 super" o "gasolina 500 🚗" rompian las
// anclas ^ y $ y el gasto caia en ambiguo.
const EMOJIS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu

function sinAcentos(texto) {
  return String(texto || '')
    .replace(EMOJIS, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Palabras interrogativas CON acento: con acento son pregunta en cualquier
// lugar de la frase. Sin acento solo cuentan al inicio (abajo), porque "que" y
// "como" sin acento aparecen en descripciones normales ("lo que pague").
const INTERROGATIVAS_ACENTUADAS = new Set([
  'qué', 'cuánto', 'cuánta', 'cuántos', 'cuántas', 'cómo', 'cuál', 'cuáles', 'cuándo', 'dónde', 'quién', 'quiénes',
])

const MULETILLAS = '(?:(?:y|oye|oiga|milo|hey|bueno|entonces|pero|ok|oki|va|a ver|ahora)[,\\s]+)*'

const PREGUNTA_AL_INICIO = new RegExp(
  `^${MULETILLAS}(?:cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|cuando|donde|quien|quienes|por que|porque|` +
    'me alcanza|nos alcanza|alcanza|alcanzo|puedo|podemos|hay|tengo|tenemos|llevo|llevamos|debo|debemos|' +
    'dime|dinos|dame|muestrame|ensename|ver|lista|cuadra|resumen|balance|en que|a que|de que|sabes|y la|y el|y en|y los|y las)\\b',
)

// "alcanza", "me queda", "sobra", "esta bien", "o no" y "que tal" tambien son
// pregunta aunque no lleven "?" ni vayan al inicio: "5000 para la renta
// alcanza", "500 en super esta bien o no", "5000 sobra".
const PREGUNTA_EN_CUALQUIER_LUGAR = /\b(?:cuanto|cuanta|cuantos|cuantas|me alcanza|nos alcanza|alcanza|alcanzan|alcanzo|alcanzara|me queda|nos queda|me quedan|nos quedan|sobra|sobran|esta bien|que tal|o no|puedo gastar|podemos gastar|en que gaste|en que gastamos|como voy|como vamos|como va|resumen|cuadra mi|cuadra el|que pagos|pagos vienen|quincena pasada|quincena anterior|vs|versus|comparado con)\b/

// Un monto al inicio: "200 super", "$150, uber", "1,250.50 renta".
const EMPIEZA_CON_MONTO = /^\$?\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k|mil|pesos|mxn))?(?=$|[\s,.:;-])/

// Verbo de registro al inicio y un numero en algun lado: "gaste 350 en
// gasolina", "cobro 5000 reembolso", "ayer pague 200 de luz". Solo verbos de
// movimientos que el parser local tipa bien ("cobro" esta entre sus palabras
// de ingreso).
const VERBO_DE_REGISTRO = /^(?:hoy |ayer |antier )?(?:me gaste|nos gastamos|gaste|gastamos|gasto|pague|pagamos|compre|compramos|cobro|abone|abono|abonamos)\b/

// Ingresos, ahorros y retiros que el parser local NO sabe tipar: "me pagaron
// 5000" salia como un Gasto de $5000 en Personal. Nunca son formato claro: los
// decide el clasificador, que si devuelve el tipo. Sin IA no se adivina.
const MOVIMIENTO_NO_GASTO = /\b(?:me pagaron|nos pagaron|me depositaron|nos depositaron|depositaron|me transfirieron|nos transfirieron|cobre|cobramos|recibi|recibimos|ingrese|ingresamos|ingreso|deposite|depositamos|ahorre|ahorramos|meti|metimos|retire|retiramos|saque|sacamos|transferi|transferimos)\b/

// "descripcion corta + monto" al final, sin nada despues: "uber 150",
// "gasolina corolla 500". Si algo sigue al monto ("super 200 ayer") ya no es
// formato claro: lo decide el clasificador.
const TERMINA_CON_MONTO = /^[a-zñ][a-zñ0-9]*(?: [a-zñ0-9]+){0,3},? \$?\d[\d,]*(?:\.\d{1,2})?$/

// Sustantivos de consulta: "quincena 37", "ppto 5000", "saldo bbva 17886",
// "movimientos 15", "top 5". Con la forma "palabras + numero" parecen un gasto
// y son una consulta. Solo se aplican a esa forma: "300 sueltos" o "200 de
// saldo para celular" (monto primero) siguen siendo gastos.
const SUSTANTIVO_DE_CONSULTA = /\b(?:quincena|quincenas|qna|q\d+|ppto|presupuesto|saldo|saldos|movimientos|ultimos|ultimas|top|sueltos|liquidez|dia|falta|faltan|queda|quedan|sobra|sobran)\b/

// Relleno al inicio que no cambia el sentido: "oye milo 200 super".
const MULETILLAS_AL_INICIO = /^(?:(?:y|oye|oiga|milo|hey|bueno|entonces|ok|oki|va|a ver|ahora|anota|apunta|registra)[,\s]+)+/

// Un verbo de mover ("pon", "manda", "pasalo") seguido de un destino. Cubre lo
// que detectReassign no entiende, para que el clasificador pueda proponerlo.
const VERBO_DE_MOVER = new RegExp(`\\b(?:${VERBOS_REASIGNAR})\\b.*\\b(?:a|al|en|para)\\b`)

function esPregunta(texto) {
  const crudo = String(texto || '')
  if (/[¿?]/.test(crudo)) return true
  const tokens = crudo.toLowerCase().split(/[^a-z0-9áéíóúüñ]+/)
  if (tokens.some(t => INTERROGATIVAS_ACENTUADAS.has(t))) return true
  const n = sinAcentos(crudo)
  return PREGUNTA_AL_INICIO.test(n) || PREGUNTA_EN_CUALQUIER_LUGAR.test(n)
}

function esGastoClaro(texto) {
  const n = sinAcentos(texto).replace(MULETILLAS_AL_INICIO, '').trim()
  if (!/\d/.test(n)) return false
  if (MOVIMIENTO_NO_GASTO.test(n)) return false
  if (EMPIEZA_CON_MONTO.test(n)) return true
  if (VERBO_DE_REGISTRO.test(n)) return true
  return TERMINA_CON_MONTO.test(n) && !SUSTANTIVO_DE_CONSULTA.test(n)
}

function clasificarMensaje(texto) {
  const n = sinAcentos(texto)
  if (!n) return { ruta: 'agente', motivo: 'vacio' }
  // "mandalo a X" va primero, como en main: habla de un gasto que ya existe,
  // aunque empiece con monto ("30 suerox mandalo a diversion").
  if (detectReassign(texto)) return { ruta: 'reasignar', motivo: 'reasignar' }
  // La pregunta gana SIEMPRE, aunque traiga un monto: "5000 me alcanza?" no
  // es un gasto. Si trae un verbo de mover ("puedes mandar el gasto de suerox
  // a diversion?"), primero lo ve el clasificador.
  if (esPregunta(texto)) {
    return VERBO_DE_MOVER.test(n)
      ? { ruta: 'quiza-reasignar', motivo: 'pregunta-con-verbo-de-mover' }
      : { ruta: 'agente', motivo: 'pregunta' }
  }
  if (esGastoClaro(texto)) return { ruta: 'gasto', motivo: 'formato-claro' }
  if (/\d/.test(n)) return { ruta: 'ambiguo', motivo: 'numero-sin-formato' }
  if (VERBO_DE_MOVER.test(n)) return { ruta: 'quiza-reasignar', motivo: 'verbo-de-mover' }
  return { ruta: 'agente', motivo: 'texto-libre' }
}

module.exports = { clasificarMensaje, esPregunta, esGastoClaro, sinAcentos }
