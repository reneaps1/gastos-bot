const deepseek = require('./deepseek')
const gemini = require('./gemini')

async function getSystemContext(prisma) {
  // El constructor de contexto actual vive en gemini.js, pero es agnóstico al
  // proveedor: solo consulta PostgreSQL y arma un snapshot financiero.
  return gemini.getSystemContext(prisma)
}

async function classify(text, context) {
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

async function answer(text, transactions, senderName, context) {
  if (deepseek.isEnabled()) {
    const reply = await deepseek.answer(text, transactions, senderName, context)
    if (reply) return { reply, provider: 'deepseek' }
  }

  if (gemini.isEnabled()) {
    const reply = await gemini.answer(text, transactions, senderName, context)
    if (reply) return { reply, provider: 'gemini' }
  }

  return null
}

async function chat(text, senderName, context) {
  if (deepseek.isEnabled()) {
    const reply = await deepseek.chat(text, senderName, context)
    if (reply) return { reply, provider: 'deepseek' }
  }

  if (gemini.isEnabled()) {
    const reply = await gemini.chat(text, senderName, context)
    if (reply) return { reply, provider: 'gemini' }
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

module.exports = { getSystemContext, classify, answer, chat, status, isEnabled }
