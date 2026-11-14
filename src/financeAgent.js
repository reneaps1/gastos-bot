// El agente de Milo: el UNICO cerebro para preguntas de Telegram.
//
// Recibe una pregunta en espanol libre, decide que herramientas consultar
// (src/miloTools.js) y contesta con esos datos. En Telegram tambien puede
// PROPONER cambios (proponer_*), que se aplican solo con el boton Confirmar. Antes de el
// habia siete capas en cascada (regex, clasificadores, intents fijos, un
// prompt con 50 movimientos pegados) y cualquiera podia comerse la pregunta:
// "cuanto queda de dinero" caia en un regex que buscaba la linea "dinero".
//
// Reglas que no se relajan:
//   - La IA propone y contesta; NUNCA escribe datos financieros. Las
//     proponer_* solo dejan una propuesta pendiente (src/miloAcciones.js) y el
//     cambio lo aplica el toque humano en "Confirmar". Fuera de Telegram (sin
//     `acciones`) ni siquiera existen.
//   - Los numeros salen de las herramientas, nunca del modelo.
//   - Si la IA falla despues de traer datos, contesta con la plantilla del
//     ultimo resultado (src/plantillasMilo.js, provider 'plantilla'). Si no hay
//     datos devuelve null, y quien llama dice "no pude"; jamas se cae a
//     registrar la pregunta como gasto.

const deepseek = require('./deepseek')
const claude = require('./claude')
const { executeTool, getToolDefinitions, esHerramientaDePropuesta } = require('./miloTools')
const plantillas = require('./plantillasMilo')
const memoriaMilo = require('./memoriaMilo')
const { fechaMexico, ZONA_MEXICO } = require('./financeUtils')

// 8: un cambio necesita buscar el movimiento (o la categoria) y luego
// proponer; con 6 no quedaba aire para una pregunta de seguimiento.
const MAX_STEPS = 8
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
// Las ultimas vueltas por chat viven en src/memoriaMilo.js: un cache en el
// proceso respaldado por la tabla milo_conversacion, para que un reinicio o
// que Render duerma el servicio no corte la platica.
const { recordar, guardarTurno: guardarTurnoEnMemoria, olvidar, MEMORIA_TURNOS, MEMORIA_TTL_MS } = memoriaMilo

// ---- Proveedores ----------------------------------------------------------------

// Claude Sonnet 5.5 primero y DeepSeek de respaldo (decision del dueño,
// 2026-11-13; antes, desde el 2026-11-04, solo DeepSeek, porque Gemini se
// retiro cuando Google dio de baja su modelo). Cada proveedor es una funcion
// que regresa { content, finishReason, error }; si el modulo de DeepSeek solo
// trae complete() (un doble de prueba viejo), se envuelve.
//
// El respaldo existe para que Milo no se quede mudo si Anthropic falla (llave
// invalida, limite de uso, caida). Sin ANTHROPIC_API_KEY la lista arranca en
// DeepSeek y todo funciona como antes.
function proveedorDeepseek() {
  if (!deepseek.isEnabled()) return null
  if (typeof deepseek.completeDetallado === 'function') return deepseek.completeDetallado
  if (typeof deepseek.complete === 'function') {
    return async (messages, opts) => ({ content: await deepseek.complete(messages, opts), finishReason: null })
  }
  return null
}

function proveedores() {
  const lista = []
  if (claude.isEnabled()) lista.push({ nombre: 'claude', completar: claude.completeDetallado })
  const ds = proveedorDeepseek()
  if (ds) lista.push({ nombre: 'deepseek', completar: ds })
  return lista
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

const REGLA_SOLO_LECTURA = '- No puedes registrar, borrar ni mover nada. Si te piden registrar un gasto, di que lo manden empezando con el monto, por ejemplo "200 super". Si piden mover un gasto a otra línea, di que lo escriban así: "el gasto de <qué> mándalo a <línea>" (eso arma un botón para confirmar).'

const REGLAS_DE_CAMBIOS = `- Puedes PROPONER cambios con las herramientas proponer_*. Nada cambia hasta que el usuario toca "Confirmar" en el mensaje: NUNCA digas que algo ya quedó hecho; di "Te dejo el cambio para confirmar" o similar.
- Para editar o borrar necesitas el id: primero search_transactions. Si hay más de un candidato y no es obvio cuál, NO propongas: lista los candidatos (con fecha y monto) y pregunta cuál.
- Una propuesta por cosa. Si piden varias, propone cada una (hasta 3).
- Si la herramienta de propuesta devuelve un error, corrige con otra herramienta o pregunta lo que falta; no lo inventes.
- Un gasto con formato "200 super" el bot ya lo registra solo; usa proponer_registrar_movimiento cuando te lo pidan con otras palabras, o cuando el mensaje sea claramente un gasto nuevo que no responde a tu pregunta anterior.
- Puedes proponer cambios a MOVIMIENTOS (registrar, editar, borrar) y a CORTES DE LIQUIDEZ (nuevo, corregir, borrar). Presupuesto, traspasos, deudas, créditos, cuentas y configuración todavía NO se pueden cambiar desde aquí: dilo en una línea y manda al dashboard, sin pedir datos para algo que no puedes guardar.
- Corte de liquidez: consulta list_accounts para saber qué cuentas hay. Si el usuario no dio los saldos, pídeselos: puede mandarlos todos en un mensaje o cuenta por cuenta, como prefiera. Junta lo que ya te dijo en la conversación (no lo vuelvas a preguntar) y, cuando tengas todas las cuentas, propone UNA sola vez con proponer_corte_liquidez. "0", "nada" o "no hay" es saldo 0. Para corregir un saldo de un corte ya guardado usa proponer_editar_corte_liquidez, no uno nuevo.`

function buildSystemPrompt(contexto, { acciones = false } = {}) {
  const tools = getToolDefinitions({ acciones })
  return `Eres Milo, el asistente financiero de una familia mexicana, conectado a sus datos reales.
Entiendes lo que te piden, consultas herramientas y contestas con esos datos.${acciones ? ' También puedes proponer cambios que el usuario confirma con un botón.' : ''}

${contexto}

REGLAS:
- Nunca inventes montos, saldos, líneas ni movimientos: todo número sale de una herramienta.
- Para cualquier dato financiero consulta una herramienta antes de responder. Puedes usar varias.
- Si no dicen periodo, usa la quincena actual. "La pasada"/"la anterior" = period "anterior".
- Si la pregunta es de seguimiento ("¿y la pasada?", "¿y en super?"), usa la conversación previa para saber de qué se habla.
- Si tu mensaje anterior terminó con una pregunta, lee el mensaje nuevo como su respuesta, aunque sea solo un número ("0", "4690.34") o un par de palabras. No lo trates como un tema nuevo ni vuelvas a preguntar lo que ya te contestaron.
- Solo pregunta algo si de verdad lo necesitas para contestar o proponer. No pidas datos para algo que no puedes hacer.
${acciones ? REGLAS_DE_CAMBIOS : REGLA_SOLO_LECTURA}
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

// `acciones` ({ chatId, userId, solicitante }) solo lo pasa Telegram: habilita
// las proponer_*. Devuelve tambien `acciones: [id...]`, las propuestas que
// quedaron pendientes en este turno, para que index.js les ponga botones.
async function answer(question, { senderName, chatId = null, deadlineMs = TOPE_MS, acciones = null, autor = null } = {}) {
  const limite = Date.now() + deadlineMs
  const quedaTiempo = () => limite - Date.now()
  const lista = proveedores()
  // Indice del proveedor en uso. Si uno falla con error, el resto de ESTA
  // respuesta sigue con el siguiente: no se vuelve a pegar al que fallo.
  let actual = 0
  if (!lista.length) {
    console.error('FINANCE_AGENT_SIN_PROVEEDOR: falta ANTHROPIC_API_KEY o DEEPSEEK_API_KEY')
    return null
  }

  // Quien hablo queda en cada vuelta: en un grupo, la respuesta a una pregunta
  // de Milo solo cuenta si viene de la misma persona.
  const guardarTurno = (id, pregunta, respuesta) => guardarTurnoEnMemoria(id, pregunta, respuesta, Date.now(), { autor })

  // Si el proceso reinicio, las vueltas recientes salen de la base.
  await memoriaMilo.cargar(chatId)
  const historial = recordar(chatId).flatMap(t => [
    { role: 'user', content: t.pregunta },
    { role: 'assistant', content: JSON.stringify({ action: 'answer', answer: t.respuesta }) },
  ])

  const messages = [
    { role: 'system', content: buildSystemPrompt(await contextoDelDia(senderName), { acciones: Boolean(acciones) }) },
    ...historial,
    { role: 'user', content: question },
  ]

  const seenCalls = new Set()
  // Cada herramienta que corrio, CON su resultado: si al final la IA no
  // contesta, de aqui sale la respuesta de plantilla.
  const trace = []
  let reparado = false
  let reintentoCorto = false
  const propuestas = () => trace
    .filter(t => esHerramientaDePropuesta(t.tool) && t.result?.ok && t.result.accionId)
    .map(t => t.result.accionId)

  // Cuando la IA no contesta: si ya hay datos, se responden con plantilla; si
  // no, null (index.js dice "No pude contestar").
  function rendirse(motivo) {
    // Si ya quedo una propuesta, se manda aunque la IA no haya redactado: el
    // resumen de cada propuesta va en su propio mensaje con sus botones.
    if (propuestas().length) {
      const texto = 'Te dejo el cambio para confirmar:'
      console.log(`FINANCE_AGENT_PROPUESTA_SIN_TEXTO: ${motivo}`)
      guardarTurno(chatId, question, texto)
      return { reply: texto, provider: 'propuesta', trace, acciones: propuestas() }
    }
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
      const prov = lista[actual]
      const r = await conTope(prov.completar(messages, { json: true, maxTokens: MAX_TOKENS }), quedaTiempo())
      // null = se agoto el tope de tiempo: reintentar no cabe.
      if (r == null) return null
      const content = r.content || null
      const cortado = r.finishReason === 'length'
      if (content && !cortado) return content
      // Un error (no un vacio) del proveedor principal: el mismo paso se pide
      // al siguiente, sin gastar el reintento "mas corto".
      if (r.error && actual < lista.length - 1) {
        console.error(`FINANCE_AGENT_RESPALDO: ${prov.nombre} fallo (${r.error}); sigue ${lista[actual + 1].nombre}`)
        actual += 1
        continue
      }
      if (reintentoCorto || r.error) {
        console.error(`FINANCE_AGENT_PROVIDER_FAILED: ${prov.nombre} (${r.error ? `error: ${r.error}` : cortado ? 'cortado, ya reintentado' : 'vacio, ya reintentado'})`)
        // Un JSON cortado a veces sigue sirviendo; si no, null.
        return content
      }
      reintentoCorto = true
      console.error(`FINANCE_AGENT_REINTENTO: ${prov.nombre} ${cortado ? 'cortado por max_tokens' : 'vacio'}; se pide mas corto`)
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
      return { reply: finalAnswer, provider: `${lista[actual].nombre}-agent`, trace, acciones: propuestas() }
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
    const result = await executeTool(plan.tool, args, { acciones })
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
  _interno: { recordar, guardarTurno: guardarTurnoEnMemoria, limpiarRespuesta, safeJsonParse, buildSystemPrompt, respuestaDePlantilla, MAX_STEPS, MAX_TOKENS, TOPE_MS, MEMORIA_TURNOS, MEMORIA_TTL_MS },
}
