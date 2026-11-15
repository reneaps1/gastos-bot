// Proveedor Claude (Anthropic) para el agente de Milo (src/financeAgent.js).
//
// Decision del dueño (2026-11-13): Claude Sonnet 5.5 como modelo principal del
// agente, DeepSeek como respaldo. El agente ya no solo contesta: tambien
// PROPONE cambios (src/miloAcciones.js), y para eso importa mas que elija bien
// el movimiento y la herramienta que ahorrar centavos.
//
// Mismo contrato que deepseek.completeDetallado: devuelve
// { content, finishReason, tokens, error } y NUNCA lanza. financeAgent no
// sabe que proveedor contesto; solo ve el contrato.
//
// Configuracion:
//   ANTHROPIC_API_KEY  sin ella el proveedor esta apagado y el agente usa
//                      DeepSeek como antes.
//   CLAUDE_MODEL       default claude-sonnet-5-5
//   CLAUDE_EFFORT      default low: preguntas y propuestas cortas. Con low el
//                      modelo se salta el razonamiento en lo simple.
//
// Detalles del modelo que este archivo respeta:
//   - En Sonnet 5.5 el razonamiento no se apaga con "disabled" (400). Se usa
//     el adaptativo (default) con effort low.
//   - El razonamiento cuenta contra max_tokens aunque no se devuelva su texto:
//     por eso se suma HOLGURA_RAZONAMIENTO al tope que pide el agente.
//   - Se leen los bloques por tipo: la respuesta puede empezar con un bloque
//     `thinking` vacio.
//   - stop_reason "refusal" (los filtros de seguridad) se trata como error, y
//     con `fallbacks: "default"` la API reintenta sola en otro modelo antes.
//   - No se mandan temperature/top_p: en este modelo un valor distinto al de
//     default es un 400.

const Anthropic = require('@anthropic-ai/sdk')

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'
const CLAUDE_EFFORT = process.env.CLAUDE_EFFORT || 'low'
const HOLGURA_RAZONAMIENTO = 2000
// El agente tiene su propio tope total (45 s); una llamada no debe comerselo.
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 25000

// La llave tal como debe verse: "sk-ant-" y sin espacios ni saltos de linea.
// En produccion (2026-11-14) la variable traia pegado un comando curl completo:
// cada llamada fallaba con "Headers.append: Bearer curl ..." -- que ademas
// imprimia en los logs el contenido de la variable -- y todo caia a DeepSeek
// sin que nadie lo notara. Una llave con mala forma apaga el proveedor y lo
// dice UNA vez, sin mostrar su valor.
function llave() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim()
}

function problemaDeLlave(valor = llave()) {
  if (!valor) return null
  if (/\s/.test(valor)) return 'trae espacios o saltos de línea (¿se pegó un comando completo en vez de solo la llave?)'
  if (!valor.startsWith('sk-ant-')) return 'no empieza con "sk-ant-"'
  if (valor.length < 40) return 'es demasiado corta'
  return null
}

let avisado = false
function isEnabled() {
  const valor = llave()
  if (!valor) return false
  const problema = problemaDeLlave(valor)
  if (problema) {
    if (!avisado) {
      avisado = true
      console.error(`CLAUDE_LLAVE_INVALIDA: ANTHROPIC_API_KEY ${problema} (longitud ${valor.length}). Claude queda apagado y el agente usa el respaldo. Corrige la variable en Render.`)
    }
    return false
  }
  return true
}

let cliente = null
function obtenerCliente() {
  // apiKey explicita (ya recortada) y authToken nulo: que el SDK no tome por su
  // cuenta otra variable del entorno (ANTHROPIC_AUTH_TOKEN).
  if (!cliente) cliente = new Anthropic({ apiKey: llave(), authToken: null, timeout: TIMEOUT_MS, maxRetries: 1 })
  return cliente
}

// Un error de red puede traer el valor de una cabecera (la llave) en el texto.
// Nunca llega a los logs ni al modelo.
function mensajeSeguro(texto) {
  const t = String(texto || '')
  if (/headers?\.(append|set)|bearer|sk-ant-|x-api-key/i.test(t)) return 'cabecera inválida (revisa ANTHROPIC_API_KEY)'
  return t.slice(0, 200)
}

// El agente arma mensajes estilo chat (system/user/assistant, contenido en
// texto). La API de Anthropic lleva el system aparte.
function convertir(messages) {
  const system = []
  const resto = []
  for (const m of messages || []) {
    const texto = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    if (m.role === 'system') system.push(texto)
    else resto.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: texto })
  }
  return { system: system.join('\n\n'), messages: resto }
}

function textoDe(response) {
  return (response?.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim() || null
}

// `json` se acepta por compatibilidad con el contrato de DeepSeek: el prompt
// del agente ya exige "SOLO un objeto JSON" y financeAgent rescata el objeto
// si el modelo antepone una frase.
async function completeDetallado(messages, { maxTokens = 500 } = {}) {
  if (!isEnabled()) return { content: null, finishReason: null, tokens: null, error: 'sin ANTHROPIC_API_KEY' }

  const { system, messages: msgs } = convertir(messages)
  try {
    const response = await obtenerCliente().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens + HOLGURA_RAZONAMIENTO,
      ...(system ? { system } : {}),
      messages: msgs,
      output_config: { effort: CLAUDE_EFFORT },
      // Cachea el prefijo: cada paso del agente reenvia el mismo system
      // (herramientas incluidas) mas la conversacion, y la lectura de cache
      // cuesta una fraccion de la entrada normal.
      cache_control: { type: 'ephemeral' },
      // Si los filtros de seguridad rechazan, la API reintenta sola en el
      // modelo que corresponda a la categoria.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })

    const tokens = response.usage?.output_tokens ?? null
    if (response.stop_reason === 'refusal') {
      const categoria = response.stop_details?.category || 'sin categoria'
      console.error(`CLAUDE_REFUSAL categoria=${categoria}`)
      // Una negativa de seguridad NO es una falla tecnica: mandarle lo mismo a
      // DeepSeek seria brincarse la negativa. Se contesta que no.
      return {
        content: JSON.stringify({ action: 'answer', answer: 'Con eso no te puedo ayudar.' }),
        finishReason: 'refusal',
        tokens,
        error: null,
      }
    }

    const content = textoDe(response)
    // financeAgent reconoce 'length' como "cortado por tope" (el nombre de
    // DeepSeek/OpenAI) y reintenta pidiendo algo mas corto.
    const finishReason = response.stop_reason === 'max_tokens' ? 'length' : (response.stop_reason || null)
    if (!content) {
      console.error(`CLAUDE_VACIO stop_reason=${response.stop_reason} tokens=${tokens} max_tokens=${maxTokens}`)
    }
    const u = response.usage || {}
    console.log(`CLAUDE_USO modelo=${response.model} entrada=${u.input_tokens ?? '-'} cache_lectura=${u.cache_read_input_tokens ?? '-'} cache_escritura=${u.cache_creation_input_tokens ?? '-'} salida=${tokens ?? '-'}`)
    return { content, finishReason, tokens, error: null }
  } catch (error) {
    // Clases tipadas del SDK: la falla se reporta con su status, sin
    // adivinar por el texto del mensaje.
    let detalle
    if (error instanceof Anthropic.AuthenticationError) detalle = `401: ANTHROPIC_API_KEY invalida`
    else if (error instanceof Anthropic.RateLimitError) detalle = `429: limite de uso`
    else if (error instanceof Anthropic.APIError) detalle = `${error.status ?? 'network'}: ${mensajeSeguro(error.message)}`
    else detalle = `network: ${mensajeSeguro(error.message)}`
    console.error(`CLAUDE_ERROR ${detalle}`)
    return { content: null, finishReason: null, tokens: null, error: detalle }
  }
}

module.exports = {
  isEnabled,
  completeDetallado,
  CLAUDE_MODEL,
  _interno: { problemaDeLlave, mensajeSeguro, convertir, textoDe, HOLGURA_RAZONAMIENTO, CLAUDE_EFFORT, _reiniciarCliente: () => { cliente = null; avisado = false } },
}
