const deepseek = require('./deepseek')

// La UNICA decision que la IA toma fuera del agente: si un mensaje ambiguo
// ("super 200 ayer") es un gasto, una pregunta, una tarea o una reasignacion.
// Las respuestas a preguntas las da src/financeAgent.js con herramientas.
//
// DeepSeek es el unico modelo (decision del 2026-11-04: Gemini se retiro; su
// modelo devolvia 404 y el "respaldo" no respaldaba nada). Sin DeepSeek, el
// bot sigue registrando gastos con el parser de palabras clave.
async function classify(text, context = null) {
  if (!deepseek.isEnabled()) return null
  const data = await deepseek.classify(text, context)
  return data ? { ...data, _provider: 'deepseek' } : null
}

function status() {
  return {
    deepseekEnabled: deepseek.isEnabled(),
    primary: deepseek.isEnabled() ? 'deepseek' : null,
  }
}

function isEnabled() {
  return deepseek.isEnabled()
}

// Si DeepSeek responde y el modelo configurado sigue existiendo (cache de 10 min).
function verificar(opts) {
  return deepseek.verificar(opts)
}

module.exports = { classify, status, isEnabled, verificar }
