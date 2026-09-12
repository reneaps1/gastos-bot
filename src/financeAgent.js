const deepseek = require('./deepseek')
const { executeTool, getToolDefinitions } = require('./miloTools')

const MAX_STEPS = 5

function safeJsonParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(String(raw).trim().replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    return null
  }
}

function buildSystemPrompt(senderName) {
  const tools = getToolDefinitions()
  return `Eres Milo, un agente financiero familiar conectado al sistema real de Milo.
Tu trabajo es entender la pregunta, decidir qué información necesitas, consultar herramientas seguras y responder con datos reales.

REGLAS CRÍTICAS:
- Nunca inventes saldos, presupuestos, movimientos, deudas, cuentas ni ahorros.
- Para cualquier dato financiero del usuario, consulta una herramienta antes de responder.
- Puedes usar varias herramientas en secuencia si la pregunta lo requiere.
- No generes SQL ni pidas acceso directo a la base de datos.
- Si una herramienta no contiene el dato necesario, dilo claramente.
- Distingue presupuesto de liquidez: presupuesto es plan; liquidez es dinero real del último corte.
- Por defecto, si el usuario no menciona periodo, usa "current" cuando la herramienta lo permita.
- Responde en español mexicano, natural y conciso.
- Usuario actual: ${senderName || 'usuario'}.

HERRAMIENTAS DISPONIBLES:
${JSON.stringify(tools, null, 2)}

En CADA paso responde SOLO JSON válido con uno de estos formatos:

Para usar una herramienta:
{"action":"tool","tool":"nombre_herramienta","args":{},"reason":"por qué la necesitas"}

Cuando ya tengas suficiente información:
{"action":"answer","answer":"respuesta final para el usuario"}

No pongas markdown fuera del JSON.`
}

async function answer(question, { senderName } = {}) {
  if (!deepseek.isEnabled() || typeof deepseek.complete !== 'function') return null

  const messages = [
    { role: 'system', content: buildSystemPrompt(senderName) },
    { role: 'user', content: question },
  ]

  const seenCalls = new Set()
  const trace = []

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const raw = await deepseek.complete(messages, { json: true, maxTokens: 700 })
    const plan = safeJsonParse(raw)

    if (!plan || !plan.action) {
      console.error('FINANCE_AGENT_PLAN_ERROR: invalid JSON plan')
      return null
    }

    if (plan.action === 'answer') {
      const finalAnswer = typeof plan.answer === 'string' ? plan.answer.trim() : ''
      if (!finalAnswer) return null
      console.log('FINANCE_AGENT_ANSWER:', finalAnswer.substring(0, 180))
      return { reply: finalAnswer, provider: 'deepseek-agent', trace }
    }

    if (plan.action !== 'tool' || typeof plan.tool !== 'string') {
      console.error('FINANCE_AGENT_PLAN_ERROR: invalid action')
      return null
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
    trace.push({ tool: plan.tool, args, ok: result?.ok !== false })

    messages.push({ role: 'assistant', content: JSON.stringify(plan) })
    messages.push({
      role: 'user',
      content: `TOOL_RESULT ${plan.tool}:\n${JSON.stringify(result)}\n\nContinúa. Si ya tienes suficiente información, responde con action=answer.`,
    })
  }

  console.error('FINANCE_AGENT_MAX_STEPS reached')
  return null
}

module.exports = { answer }
