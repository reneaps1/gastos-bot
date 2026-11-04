const axios = require('axios')

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'

function isEnabled() {
  return !!DEEPSEEK_API_KEY
}

// La llamada con todo el detalle: `content` (o null), `finishReason` y
// `tokens`. Existe porque una respuesta VACIA no lanza error: antes solo
// volvia null y el agente lo registraba como "fallo" sin saber si DeepSeek se
// corto por max_tokens ("length"), si el modo JSON vino vacio ("stop"), o si
// hubo error de red. Visto el 2026-11-02/04: 3 de 3 fallos de Milo fueron
// contenido vacio, sin ningun DEEPSEEK_ERROR.
async function completeDetallado(messages, { json = false, maxTokens = 500 } = {}) {
  if (!DEEPSEEK_API_KEY) return { content: null, finishReason: null, tokens: null, error: 'sin DEEPSEEK_API_KEY' }

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

    const choice = data?.choices?.[0]
    const content = choice?.message?.content?.trim() || null
    const finishReason = choice?.finish_reason || null
    const tokens = data?.usage?.completion_tokens ?? null
    if (!content) {
      console.error(`DEEPSEEK_VACIO finish_reason=${finishReason} tokens=${tokens} max_tokens=${maxTokens} json=${json}`)
    }
    return { content, finishReason, tokens, error: null }
  } catch (error) {
    const status = error.response?.status || 'network'
    const detail = error.response?.data?.error?.message || error.message
    console.error(`DEEPSEEK_ERROR status=${status}: ${detail}`)
    return { content: null, finishReason: null, tokens: null, error: `${status}: ${detail}` }
  }
}

// La forma de siempre: solo el texto, o null.
async function complete(messages, opciones = {}) {
  return (await completeDetallado(messages, opciones)).content
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

// ¿DeepSeek esta vivo y el modelo sigue existiendo? GET /models no gasta
// tokens. Se revisa tambien que DEEPSEEK_MODEL este en la lista: asi murio
// Gemini (su modelo se retiro y nadie se entero en dias). Cache de 10 min
// para que /health no le pegue a la API en cada consulta del watchdog.
const SALUD_TTL_MS = 10 * 60 * 1000
let salud = null

async function verificar({ ahora = Date.now() } = {}) {
  if (salud && ahora - salud.t < SALUD_TTL_MS) return salud.r
  let r
  if (!DEEPSEEK_API_KEY) {
    r = { ok: false, error: 'sin DEEPSEEK_API_KEY' }
  } else {
    try {
      const { data } = await axios.get(`${DEEPSEEK_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        timeout: 8000,
      })
      const ids = (data?.data || []).map(m => m.id)
      if (!ids.length || ids.includes(DEEPSEEK_MODEL)) {
        r = { ok: true, error: null }
      } else {
        // No aparece en la lista (puede ser un alias): antes de declarar el
        // modelo muerto, una llamada de 1 token lo confirma. Sin esto, un alias
        // valido daria una falsa alarma en cada corrida del watchdog.
        const prueba = await completeDetallado([{ role: 'user', content: 'ok' }], { maxTokens: 1 })
        r = prueba.error
          ? { ok: false, error: `el modelo ${DEEPSEEK_MODEL} no responde (${prueba.error}); DeepSeek lista: ${ids.join(', ')}` }
          : { ok: true, error: null }
      }
    } catch (error) {
      const status = error.response?.status || 'network'
      r = { ok: false, error: `${status}: ${error.response?.data?.error?.message || error.message}` }
    }
  }
  r = { ...r, modelo: DEEPSEEK_MODEL, revisadoEn: new Date(ahora).toISOString() }
  salud = { t: ahora, r }
  return r
}

module.exports = { isEnabled, complete, completeDetallado, classify, verificar, DEEPSEEK_MODEL, _olvidarSalud: () => { salud = null } }
