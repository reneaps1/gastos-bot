const axios = require('axios')

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'

function isEnabled() {
  return !!DEEPSEEK_API_KEY
}

async function complete(messages, { json = false, maxTokens = 500 } = {}) {
  if (!DEEPSEEK_API_KEY) return null

  try {
    const { data } = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages,
        thinking: { type: 'disabled' },
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: maxTokens,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    )

    return data?.choices?.[0]?.message?.content?.trim() || null
  } catch (error) {
    const status = error.response?.status || 'network'
    const detail = error.response?.data?.error?.message || error.message
    console.error(`DEEPSEEK_ERROR status=${status}: ${detail}`)
    return null
  }
}

function systemSummary(context) {
  if (!context) return ''

  const parts = []
  if (context.quincenaActiva) {
    parts.push(`Quincena activa: ${context.quincenaActiva.codigo} (${context.quincenaActiva.inicio} a ${context.quincenaActiva.fin})`)
  }
  if (context.resumen) {
    parts.push(`Ingresos: ${context.resumen.ingresos}; gastos: ${context.resumen.gastos}; ahorro: ${context.resumen.ahorro}; saldo: ${context.resumen.saldo}`)
  }
  if (context.gastosPendientes?.length) {
    parts.push(`Pendientes por pagar: ${context.gastosPendientes.map(x => `${x.descripcion} $${x.monto}`).join(', ')}`)
  }
  if (context.presupuestos?.length) {
    parts.push(`Presupuestos: ${context.presupuestos.slice(0, 20).map(x => `${x.descripcion} (${x.categoria}) $${x.monto}`).join(', ')}`)
  }
  return parts.join('\n')
}

async function classify(text, context) {
  const prompt = `Clasifica un mensaje para Milo, un asistente de finanzas familiares en México.
Interpreta lenguaje coloquial, abreviaturas y errores de dedo. Ejemplos: "x" puede significar "por", "ppto" significa "presupuesto", "lana" significa dinero.

Tipos permitidos:
- expense: registrar gasto, ingreso o ahorro. Debe existir un monto claro.
- reassign: mover un gasto YA REGISTRADO a otra línea de presupuesto. No trae monto nuevo.
- question: pregunta financiera.
- task: recordatorio/tarea.
- chat: conversación no financiera.

Para question usa una intención:
- expenses_today
- unassigned_expenses: gastos ya registrados pero sin línea de presupuesto, sin asignar, sueltos o pendientes por asignar
- budget_remaining
- liquidity
- quincena_summary
- recent_transactions
- generic_finance

IMPORTANTE:
- "el gasto de suerox mándalo a diversión" = reassign, referencia "suerox", destino "diversión".
- reassign NUNCA trae monto: si el mensaje trae un monto nuevo es expense, no reassign.
- referencia es el texto para encontrar el gasto existente; destino es la línea a la que va.
- "faltan gastos x asignar?" = question/unassigned_expenses.
- "tengo gastos pendientes x registrar?" = question/generic_finance, porque Milo no puede saber qué gastos nunca fueron registrados.
- No inventes montos.

Contexto disponible:\n${systemSummary(context) || 'sin contexto'}

Mensaje: ${JSON.stringify(text)}

Responde SOLO JSON válido.
Para expense: {"type":"expense","monto":123,"descripcion":"...","categoria":"Hogar|Salud|Familia|Transporte|Suscripciones|Deudas|Personal|Ingresos|Ahorro","formaPago":"Efectivo|Debito|Credito|Spei|Vales","tipo":"Gasto|Ingreso|Ahorro","estatus":"Pagado|Pendiente"}
Para reassign: {"type":"reassign","referencia":"...","destino":"..."}
Para question: {"type":"question","intent":"...","subject":null,"scope":"me|household"}
Para task: {"type":"task","content":"...","due_string":null}
Para chat: {"type":"chat"}`

  const raw = await complete(
    [
      { role: 'system', content: 'Eres un router de intención. Siempre respondes JSON válido y nunca inventas datos.' },
      { role: 'user', content: prompt },
    ],
    { json: true, maxTokens: 450 },
  )

  if (!raw) return null

  try {
    const data = JSON.parse(raw)
    if (!['expense', 'reassign', 'question', 'task', 'chat'].includes(data.type)) return null

    if (data.type === 'expense') {
      const categories = ['Hogar', 'Salud', 'Familia', 'Transporte', 'Suscripciones', 'Deudas', 'Personal', 'Ingresos', 'Ahorro']
      const payments = ['Efectivo', 'Debito', 'Credito', 'Spei', 'Vales']
      if (!categories.includes(data.categoria)) data.categoria = 'Personal'
      if (!payments.includes(data.formaPago)) data.formaPago = 'Efectivo'
      if (!['Gasto', 'Ingreso', 'Ahorro'].includes(data.tipo)) data.tipo = 'Gasto'
      if (typeof data.monto !== 'number' || data.monto <= 0) data.monto = null
      data.estatus = data.estatus === 'Pendiente' ? 'Pendiente' : 'Pagado'
    }

    // Una reasignacion sin las dos referencias no sirve para nada: mejor que
    // caiga al flujo normal que proponer con datos a medias.
    if (data.type === 'reassign') {
      const referencia = typeof data.referencia === 'string' ? data.referencia.trim() : ''
      const destino = typeof data.destino === 'string' ? data.destino.trim() : ''
      if (referencia.length < 3 || destino.length < 3) return null
      data.referencia = referencia
      data.destino = destino
    }

    if (data.type === 'question') {
      const intents = new Set([
        'expenses_today',
        'unassigned_expenses',
        'budget_remaining',
        'liquidity',
        'quincena_summary',
        'recent_transactions',
        'generic_finance',
      ])
      if (!intents.has(data.intent)) data.intent = 'generic_finance'
      data.scope = data.scope === 'me' ? 'me' : 'household'
      data.subject = typeof data.subject === 'string' && data.subject.trim() ? data.subject.trim() : null
    }

    console.log('DEEPSEEK_CLASSIFY_RESULT:', JSON.stringify({ type: data.type, intent: data.intent, monto: data.monto }))
    return data
  } catch (error) {
    console.error('DEEPSEEK_JSON_ERROR:', error.message)
    return null
  }
}

// answer() y chat() se quitaron: las preguntas de Telegram las contesta
// src/financeAgent.js con herramientas, no un prompt con movimientos pegados.

module.exports = { isEnabled, complete, classify }
