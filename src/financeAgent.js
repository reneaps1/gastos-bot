// El agente de Milo: el UNICO cerebro para preguntas de Telegram.
//
// Recibe una pregunta en espanol libre, decide que herramientas de solo
// lectura consultar (src/miloTools.js) y contesta con esos datos. Antes de el
// habia siete capas en cascada (regex, clasificadores, intents fijos, un
// prompt con 50 movimientos pegados) y cualquiera podia comerse la pregunta:
// "cuanto queda de dinero" caia en un regex que buscaba la linea "dinero".
//
// Reglas que no se relajan:
//   - La IA propone y contesta; NUNCA escribe. Ninguna herramienta escribe.
//   - Los numeros salen de las herramientas, nunca del modelo.
//   - Si la IA falla despues de traer datos, contesta con la plantilla del
//     ultimo resultado (src/plantillasMilo.js, provider 'plantilla'). Si no hay
//     datos devuelve null, y quien llama dice "no pude"; jamas se cae a
//     registrar la pregunta como gasto.

const deepseek = require('./deepseek')
const { executeTool, getToolDefinitions } = require('./miloTools')
const plantillas = require('./plantillasMilo')
const { fechaMexico, ZONA_MEXICO } = require('./financeUtils')

const MAX_STEPS = 6
// Tope de tiempo de UNA respuesta completa. DeepSeek tiene su timeout por
// llamada (15 s), pero son hasta 6 pasos mas un reintento: sin un tope total,
// el usuario veria minutos de "escribiendo..." antes de la respuesta.
const TOPE_MS = Number(process.env.FINANCE_AGENT_DEADLINE_MS) || 45000
const MAX_RESPUESTA = 3500
const MAX_RESULTADO_HERRAMIENTA = 12000
// 900 se quedaba corto: con 29 lineas de presupuesto la respuesta en viñetas
// no cabia. Ver DEEPSEEK_VACIO en src/deepseek.js.
const MAX_TOKENS = 2000
const PIDE_MAS_CORTO = 'SYSTEM: Tu respuesta anterior llegó vacía o cortada. Responde más corto: máximo 10 viñetas, y SOLO el objeto JSON.'

// ---- Memoria de conversacion --------------------------------------------------
//
// Las ultimas vueltas por chat, en memoria del proceso. Es lo que hace que
// "¿y la quincena pasada?" sepa de que se hablaba. Se pierde al reiniciar o
// cuando Render duerme el servicio, y a proposito no toca la base: no requiere
// migracion y no guarda conversaciones para siempre.
const MEMORIA_TURNOS = 6
const MEMORIA_TTL_MS = 30 * 60 * 1000
const memoria = new Map() // chatId -> { turnos: [{ pregunta, respuesta }], actualizado }

function recordar(chatId, ahora = Date.now()) {
  if (chatId == null) return []
  const entrada = memoria.get(String(chatId))
  if (!entrada) return []
  if (ahora - entrada.actualizado > MEMORIA_TTL_MS) {
    memoria.delete(String(chatId))
    return []
  }
  return entrada.turnos
}

function guardarTurno(chatId, pregunta, respuesta, ahora = Date.now()) {
  if (chatId == null) return
  const turnos = [...recordar(chatId, ahora), { pregunta, respuesta }].slice(-MEMORIA_TURNOS)
  memoria.set(String(chatId), { turnos, actualizado: ahora })
  // Limpieza perezosa: que un chat abandonado no se quede para siempre.
  for (const [id, e] of memoria) if (ahora - e.actualizado > MEMORIA_TTL_MS) memoria.delete(id)
}

function olvidar(chatId) {
  if (chatId == null) memoria.clear()
  else memoria.delete(String(chatId))
}

// ---- Proveedores ----------------------------------------------------------------

// Un solo modelo: DeepSeek (decision del dueño, 2026-11-04; Gemini se retiro
// porque Google dio de baja el modelo y fallaba con 404). Devuelve una funcion
// que regresa { content, finishReason }; si el modulo solo trae complete() (un
// doble de prueba viejo), se envuelve.
function proveedor() {
  if (!deepseek.isEnabled()) return null
  if (typeof deepseek.completeDetallado === 'function') return deepseek.completeDetallado
  if (typeof deepseek.complete === 'function') {
    return async (messages, opts) => ({ content: await deepseek.complete(messages, opts), finishReason: null })
  }
  return null
}

// Red de seguridad: si la IA ya trajo datos pero no pudo redactar, se arma la
// respuesta con la plantilla del ultimo resultado bueno que tenga una.
function respuestaDePlantilla(trace) {
  for (let i = trace.length - 1; i >= 0; i--) {
    const paso = trace[i]
    if (!paso.ok) continue
    const texto = plantillas.formatear(paso.tool, paso.result)
    if (texto) return { texto: limpiarRespuesta(texto), tool: paso.tool }
  }
  return null
}

function safeJsonParse(raw) {
  if (!raw) return null
  const texto = String(raw).trim().replace(/```json\n?|\n?```/g, '').trim()
  try {
    return JSON.parse(texto)
  } catch {
    // Un modelo que antepone una frase al JSON: se rescata el objeto.
    const i = texto.indexOf('{')
    const j = texto.lastIndexOf('}')
    if (i >= 0 && j > i) {
      try { return JSON.parse(texto.slice(i, j + 1)) } catch { return null }
    }
    return null
  }
}

// ---- Prompt ---------------------------------------------------------------------

function fechaLarga(fecha = new Date()) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA_MEXICO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(fecha)
}

async function contextoDelDia(senderName) {
  const hoy = fechaMexico()
  let periodo = 'No hay una quincena activa para hoy.'
  try {
    const r = await executeTool('get_current_period')
    if (r?.ok) {
      const p = r.period
      periodo = p.isCurrent
        ? `Quincena activa: ${p.code}, del ${p.start} al ${p.end}; faltan ${p.daysLeft} día(s) contando hoy.`
        // Hoy cae entre dos quincenas: se usa la que abre el dashboard.
        : `Hoy no cae dentro de ninguna quincena. La que se consulta por defecto (la misma que abre el dashboard) es ${p.code}, del ${p.start} al ${p.end}.`
    }
  } catch (error) {
    console.error('FINANCE_AGENT_CONTEXT_ERROR:', error.message)
  }
  return `Hoy es ${fechaLarga()} (${hoy}, hora de México).\n${periodo}\nUsuario: ${senderName || 'usuario'}.`
}

const GLOSARIO = `GLOSARIO (las palabras del dashboard; úsalas igual):
- "Te sobran $X" / "Te faltan $X": el veredicto del panel "¿Cuadra tu dinero?": lo que hay en cuentas menos lo que falta por pagar.
- "en cuentas": el saldo del último corte de liquidez.
- "por pagar": lo registrado pendiente de pago más lo presupuestado que todavía no se registra (líneas de Gasto).
- "según tu presupuesto": ingresos menos lo comprometido; dice Sobra o Falta.
- "Vas $X mejor/peor": cuánto se separan tus cuentas de tu presupuesto.
- "remaining"/"Restante" de una línea NO es "lo que me queda": es presupuesto de ESA línea sin ejercer. "Cuánto me queda" siempre es get_money_status.
- Si el corte de cuentas es viejo (cutIsOld) dilo; si no hay corte, da "según tu presupuesto" y sugiere capturar el corte.`

const EJEMPLOS = `EJEMPLOS (pregunta -> herramienta):
- "cuánto me queda" / "cuánto queda de dinero" / "cómo voy" / "resumen" -> get_money_status {}
- "me alcanza para 5000 de la tarjeta?" -> get_money_status {"amount":5000}
- "cuánto puedo gastar al día" -> get_money_status {} (usa perDay; si falta dinero, dilo)
- "qué pagos vienen" / "qué falta pagar" -> get_upcoming_payments {}
- "y la quincena pasada?" (después de hablar de dinero) -> la misma herramienta con {"period":"anterior"}
- "cómo voy vs la pasada" -> compare_periods {}
- "en qué gasté más" -> search_transactions {"period":"current","type":"Gasto","limit":1} y mira totals.byCategory
- "cuánto gasté hoy" -> search_transactions {"dateFrom":"<hoy>","dateTo":"<hoy>","type":"Gasto"}
- "qué gastos tengo sin asignar" -> search_transactions {"period":"current","type":"Gasto","unassigned":true}
- "cuánto queda en gasolina" -> list_budget_lines {"search":"gasolina"} (si no aparece, prueba con "category")`

const FORMATO = `FORMATO DE LA RESPUESTA:
- Primera línea: el veredicto o la respuesta directa (p. ej. "Te faltan $9,075.39 para cubrir lo que te queda por pagar esta quincena.").
- Si la respuesta enumera varias cosas (pagos, líneas, gastos, categorías, movimientos), pon UNA por renglón, cada una como viñeta "• Nombre — $monto (cuándo o detalle)", en el orden en que vienen de la herramienta. Hasta 10 viñetas; si hay más, termina con "• y N más". NUNCA juntes varias cosas en la misma viñeta separadas por comas, ni las agrupes en "Lo más próximo: ..., Luego: ...".
  Ejemplo:
  Te faltan $8,163.86 para cubrir los $26,050.00 por pagar en Q38.
  • Renta — $10,500.00 (hoy)
  • Hosting — $487.00 (hoy)
  • Colegiatura — $1,300.00 (2 de nov.)
  • y 9 más
- Si no hay nada que enumerar: máximo 4 líneas.
- Montos como $1,234.56. Si la herramienta trae frases en "summary" o textos ya formateados, cópialos tal cual.
- Texto plano: sin asteriscos, sin guiones bajos, sin Markdown, sin tablas.
- Sin preámbulos ("Claro", "Según los datos"). Español mexicano, natural.`

function buildSystemPrompt(contexto) {
  const tools = getToolDefinitions()
  return `Eres Milo, el asistente financiero de una familia mexicana, conectado a sus datos reales.
Entiendes la pregunta, consultas herramientas de solo lectura y contestas con esos datos.

${contexto}

REGLAS:
- Nunca inventes montos, saldos, líneas ni movimientos: todo número sale de una herramienta.
- Para cualquier dato financiero consulta una herramienta antes de responder. Puedes usar varias.
- Si no dicen periodo, usa la quincena actual. "La pasada"/"la anterior" = period "anterior".
- Si la pregunta es de seguimiento ("¿y la pasada?", "¿y en super?"), usa la conversación previa para saber de qué se habla.
- No puedes registrar, borrar ni mover nada. Si te piden registrar un gasto, di que lo manden empezando con el monto, por ejemplo "200 super". Si piden mover un gasto a otra línea, di que lo escriban así: "el gasto de <qué> mándalo a <línea>" (eso arma un botón para confirmar).
- Si una herramienta no tiene el dato, dilo claro en una línea.

${GLOSARIO}

${EJEMPLOS}

${FORMATO}

HERRAMIENTAS:
${JSON.stringify(tools)}

En CADA paso responde SOLO un objeto JSON válido, con uno de estos formatos:
{"action":"tool","tool":"nombre_herramienta","args":{}}
{"action":"answer","answer":"respuesta final para el usuario"}`
}

// Texto seguro para Telegram: se manda sin parse_mode, asi que cualquier
// marca de Markdown se veria literal. Se limpia y se corta al tope.
function limpiarRespuesta(texto) {
  let out = String(texto || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S[^*\n]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/`+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (out.length > MAX_RESPUESTA) out = `${out.slice(0, MAX_RESPUESTA - 1).trimEnd()}…`
  return out
}

function recortarResultado(result) {
  const json = JSON.stringify(result)
  if (json.length <= MAX_RESULTADO_HERRAMIENTA) return json
  return `${json.slice(0, MAX_RESULTADO_HERRAMIENTA)}... [recortado: usa filtros o limit para pedir menos]`
}

// ---- Bucle ------------------------------------------------------------------------

// Espera una promesa hasta `ms`; despues resuelve null. La llamada de abajo
// sigue en vuelo (no hay como cancelarla), pero ya nadie la espera.
function conTope(promesa, ms) {
  let timer
  const tope = new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, ms)) })
  return Promise.race([Promise.resolve(promesa), tope]).finally(() => clearTimeout(timer))
}

async function answer(question, { senderName, chatId = null, deadlineMs = TOPE_MS } = {}) {
  const limite = Date.now() + deadlineMs
  const quedaTiempo = () => limite - Date.now()
  const completar = proveedor()
  if (!completar) {
    console.error('FINANCE_AGENT_SIN_PROVEEDOR: falta DEEPSEEK_API_KEY')
    return null
  }

  const historial = recordar(chatId).flatMap(t => [
    { role: 'user', content: t.pregunta },
    { role: 'assistant', content: JSON.stringify({ action: 'answer', answer: t.respuesta }) },
  ])

  const messages = [
    { role: 'system', content: buildSystemPrompt(await contextoDelDia(senderName)) },
    ...historial,
    { role: 'user', content: question },
  ]

  const seenCalls = new Set()
  // Cada herramienta que corrio, CON su resultado: si al final la IA no
  // contesta, de aqui sale la respuesta de plantilla.
  const trace = []
  let reparado = false
  let reintentoCorto = false

  // Cuando la IA no contesta: si ya hay datos, se responden con plantilla; si
  // no, null (index.js dice "No pude contestar").
  function rendirse(motivo) {
    const plantilla = respuestaDePlantilla(trace)
    if (!plantilla) {
      console.error(`FINANCE_AGENT_FALLO: ${motivo}; sin datos para plantilla`)
      return null
    }
    console.log(`FINANCE_AGENT_PLANTILLA: ${motivo}; tool=${plantilla.tool}`)
    guardarTurno(chatId, question, plantilla.texto)
    return { reply: plantilla.texto, provider: 'plantilla', trace }
  }

  // El siguiente paso. Un vacio o un corte por max_tokens se reintenta UNA vez
  // pidiendo una respuesta mas corta: el 2026-11-04 cuatro preguntas fallaron
  // asi, con los datos ya en la mano.
  async function pedir() {
    for (;;) {
      if (quedaTiempo() <= 0) {
        console.error(`FINANCE_AGENT_DEADLINE: se agotaron ${deadlineMs} ms`)
        return null
      }
      const r = await conTope(completar(messages, { json: true, maxTokens: MAX_TOKENS }), quedaTiempo())
      // null = se agoto el tope de tiempo: reintentar no cabe.
      if (r == null) return null
      const content = r.content || null
      const cortado = r.finishReason === 'length'
      if (content && !cortado) return content
      if (reintentoCorto || r.error) {
        console.error(`FINANCE_AGENT_PROVIDER_FAILED: deepseek (${r.error ? `error: ${r.error}` : cortado ? 'cortado, ya reintentado' : 'vacio, ya reintentado'})`)
        // Un JSON cortado a veces sigue sirviendo; si no, null.
        return content
      }
      reintentoCorto = true
      console.error(`FINANCE_AGENT_REINTENTO: deepseek ${cortado ? 'cortado por max_tokens' : 'vacio'}; se pide mas corto`)
      messages.push({ role: 'user', content: PIDE_MAS_CORTO })
    }
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const raw = await pedir()
    if (!raw) return rendirse('sin respuesta del modelo')

    const plan = safeJsonParse(raw)

    if (!plan || !plan.action) {
      // Un solo reintento pidiendo JSON. Mas de uno es gastar tiempo en un
      // modelo que no esta siguiendo el formato.
      if (!reparado) {
        reparado = true
        console.error('FINANCE_AGENT_PLAN_ERROR: invalid JSON plan, retrying once')
        messages.push({ role: 'assistant', content: String(raw).slice(0, 1500) })
        messages.push({ role: 'user', content: 'SYSTEM: Tu respuesta no fue JSON válido. Responde SOLO con un objeto JSON: {"action":"tool",...} o {"action":"answer","answer":"..."}.' })
        continue
      }
      return rendirse('JSON invalido')
    }

    if (plan.action === 'answer') {
      const finalAnswer = limpiarRespuesta(typeof plan.answer === 'string' ? plan.answer : '')
      if (!finalAnswer) return rendirse('respuesta vacia')
      console.log('FINANCE_AGENT_ANSWER:', finalAnswer.substring(0, 180))
      guardarTurno(chatId, question, finalAnswer)
      return { reply: finalAnswer, provider: 'deepseek-agent', trace }
    }

    if (plan.action !== 'tool' || typeof plan.tool !== 'string') {
      return rendirse('accion invalida')
    }

    const args = plan.args && typeof plan.args === 'object' && !Array.isArray(plan.args) ? plan.args : {}
    const signature = `${plan.tool}:${JSON.stringify(args)}`

    if (seenCalls.has(signature)) {
      messages.push({
        role: 'user',
        content: `SYSTEM: Ya ejecutaste exactamente ${signature}. No la repitas. Usa el resultado previo o responde con lo que ya sabes.`,
      })
      continue
    }

    seenCalls.add(signature)
    console.log('FINANCE_AGENT_TOOL_CALL:', JSON.stringify({ tool: plan.tool, args }))
    const result = await executeTool(plan.tool, args)
    trace.push({ tool: plan.tool, args, ok: result?.ok !== false, result })

    messages.push({ role: 'assistant', content: JSON.stringify(plan) })
    messages.push({
      role: 'user',
      content: `TOOL_RESULT ${plan.tool}:\n${recortarResultado(result)}\n\nContinúa. Si ya tienes suficiente información, responde con action=answer.`,
    })
  }

  return rendirse('MAX_STEPS')
}

module.exports = {
  answer,
  olvidar,
  // Para pruebas.
  _interno: { recordar, guardarTurno, limpiarRespuesta, safeJsonParse, buildSystemPrompt, respuestaDePlantilla, MAX_STEPS, MAX_TOKENS, TOPE_MS, MEMORIA_TURNOS, MEMORIA_TTL_MS },
}
