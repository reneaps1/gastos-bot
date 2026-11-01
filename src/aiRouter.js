const deepseek = require('./deepseek')
const gemini = require('./gemini')

// Router de proveedores para la UNICA decision que la IA toma fuera del
// agente: si un mensaje ambiguo de Telegram ("super 200 ayer") es un gasto,
// una pregunta o una reasignacion. Las respuestas a preguntas ya no pasan por
// aqui: las da src/financeAgent.js con herramientas. El viejo `answer` (que
// pegaba 50 movimientos al prompt y dejaba que el modelo sumara) y `chat` se
// quitaron con el ruteo nuevo.
async function classify(text, context = null) {
  if (deepseek.isEnabled()) {
    const data = await deepseek.classify(text, context)
    if (data) return { ...data, _provider: 'deepseek' }
  }

  if (gemini.isEnabled()) {
    const data = await gemini.classify(text, context)
    if (data) return { ...data, _provider: 'gemini' }
  }

  return null
}

function status() {
  return {
    deepseekEnabled: deepseek.isEnabled(),
    geminiEnabled: gemini.isEnabled(),
    primary: deepseek.isEnabled() ? 'deepseek' : gemini.isEnabled() ? 'gemini' : null,
  }
}

function isEnabled() {
  return deepseek.isEnabled() || gemini.isEnabled()
}

module.exports = { classify, status, isEnabled }
