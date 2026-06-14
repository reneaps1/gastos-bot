const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
let genModel = null

function getModel() {
  if (!GEMINI_API_KEY) return null
  if (!genModel) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    genModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  }
  return genModel
}

const CATEGORIAS = ['Hogar', 'Salud', 'Familia', 'Transporte', 'Suscripciones', 'Deudas', 'Personal', 'Ingresos', 'Ahorro']
const FORMAS_PAGO = ['Efectivo', 'Debito', 'Spei', 'Vales']

// Clasifica el mensaje en tres tipos:
// - expense: registro de gasto/ingreso/ahorro (incluye datos extraídos)
// - question: pregunta sobre finanzas (requiere historial)
// - chat: conversación casual, saludo, agradecimiento, etc.
async function classify(text) {
  const m = getModel()
  if (!m) return null
  try {
    const prompt = `Eres un clasificador de mensajes para un bot de finanzas personales. Clasifica el mensaje en uno de tres tipos:

REGISTRO: el usuario registra un gasto, ingreso o ahorro. Siempre incluye un monto numérico.
  Ejemplos directos: "gasté 150 en uber", "compré pizza 200", "ingreso 5000 nómina", "ahorro 1000"
  Ejemplos naturales: "el jueves me pagaron 3500", "hoy nos cobraron la renta 8000",
    "ayer gasté como 250 en el super", "me descontaron 1200 del seguro",
    "recibí mi bono de 4000", "transferí 2000 al ahorro"

PREGUNTA: el usuario pregunta sobre sus finanzas.
  Ejemplos: "cuánto gasté esta semana", "cómo voy en el mes", "muéstrame mis gastos de transporte"

CHAT: cualquier otra cosa — saludos, despedidas, gracias, comentarios, preguntas no financieras.
  Ejemplos: "hola", "gracias", "ok", "perfecto", "buenos días", "hasta luego", "qué tal"

Mensaje a clasificar: "${text}"

Categorías válidas (solo para REGISTRO): ${CATEGORIAS.join(', ')}
Formas de pago válidas (solo para REGISTRO): ${FORMAS_PAGO.join(', ')}

Responde SOLO con JSON sin markdown ni explicaciones:
- REGISTRO: {"type":"expense","monto":número,"descripcion":"descripción breve","categoria":"categoría válida","formaPago":"forma válida","tipo":"Gasto|Ingreso|Ahorro"}
- PREGUNTA: {"type":"question"}
- CHAT: {"type":"chat"}`

    const result = await m.generateContent(prompt)
    const raw = result.response.text().trim().replace(/```json\n?|\n?```/g, '').trim()
    const data = JSON.parse(raw)

    if (data.type === 'expense') {
      if (!CATEGORIAS.includes(data.categoria)) data.categoria = 'Personal'
      if (!FORMAS_PAGO.includes(data.formaPago)) data.formaPago = 'Efectivo'
      if (!['Gasto', 'Ingreso', 'Ahorro'].includes(data.tipo)) data.tipo = 'Gasto'
      if (typeof data.monto !== 'number' || data.monto <= 0) data.monto = null
    }

    return data
  } catch (e) {
    console.error('Gemini classify error:', e.message)
    return null
  }
}

// Responde una pregunta sobre finanzas usando el historial de transacciones.
async function answer(text, transactions, senderName) {
  const m = getModel()
  if (!m) return null
  try {
    const rows = transactions.slice(0, 60).map(t =>
      `${t.fecha}|${t.tipo}|$${t.monto}|${t.descripcion}|${t.categoria}|${t.formaPago}`
    ).join('\n')

    const prompt = `Eres el asistente financiero personal de ${senderName}.
Registros recientes (fecha|tipo|monto|descripción|categoría|forma de pago):
${rows}

Hoy: ${new Date().toLocaleDateString('es-MX')}
Pregunta: "${text}"

Responde en español, de forma concisa y útil, usando emojis. Máximo 5 líneas.`

    const result = await m.generateContent(prompt)
    return result.response.text().trim()
  } catch (e) {
    console.error('Gemini answer error:', e.message)
    return null
  }
}

// Responde conversación casual sin necesitar el historial financiero.
async function chat(text, senderName) {
  const m = getModel()
  if (!m) return null
  try {
    const prompt = `Eres un asistente de finanzas personales amigable llamado "GastosBot". El usuario es ${senderName}.

Mensaje: "${text}"

Responde de forma natural, amigable y breve en español con emojis. Si es un saludo, saluda y menciona que puedes ayudar a registrar gastos o responder preguntas sobre sus finanzas. Máximo 3 líneas.`

    const result = await m.generateContent(prompt)
    return result.response.text().trim()
  } catch (e) {
    console.error('Gemini chat error:', e.message)
    return null
  }
}

module.exports = { classify, answer, chat, isEnabled: () => !!GEMINI_API_KEY }
