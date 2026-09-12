// Watchdog del bot de Telegram: detecta que Milo dejo de responder y avisa POR
// TELEGRAM, sin que nadie tenga que abrir Render.
//
// POR QUE EXISTE: el 2026-09-12 el bot estuvo caido 7 horas y nadie se entero
// hasta que un humano noto que no contestaba. El servicio estaba en crash loop
// (`Missing script: "start:telegram"`), Telegram acumulaba updates sin entregar,
// y no habia una sola señal fuera del dashboard de Render.
//
// Corre en GitHub Actions cada 30 min (.github/workflows/telegram-watchdog.yml).
// SIN DEPENDENCIAS: usa `fetch` nativo (Node 18+) para que el workflow no tenga
// que hacer `npm install`. La logica de "que cuenta como roto" vive en
// src/telegramHealth.js, compartida con scripts/diagnose-telegram.js.
//
// Uso local (con las variables en .env o exportadas):
//   node scripts/watchdog-telegram.js
//   node scripts/watchdog-telegram.js --dry-run   (no re-registra ni avisa)
//
// Salida: 0 si todo bien o si lo pudo reparar solo; 1 si queda algo roto (asi
// GitHub tambien manda su correo de "workflow failed" como segunda red).

const { evaluate, hasErrors, formatAlert } = require('../src/telegramHealth')

const DRY_RUN = process.argv.includes('--dry-run')

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID
const EXPECTED_URL = process.env.TELEGRAM_EXPECTED_WEBHOOK_URL || null
const SERVICE_URL = (process.env.TELEGRAM_SERVICE_URL || '').replace(/\/$/, '') || null
const SERVICE_NAME = process.env.TELEGRAM_SERVICE_NAME || 'milo-telegram-bot'

// El plan free de Render tarda hasta ~50s en despertar un servicio dormido (lo
// dice el propio aviso del dashboard). Con menos timeout confundiriamos
// "dormido" con "caido" y alertariamos en falso cada media hora.
const SERVICE_TIMEOUT_MS = 90000
const TELEGRAM_TIMEOUT_MS = 15000

function log(...args) {
  console.log(...args)
}

async function httpJson(url, { method = 'GET', body = null, timeout = TELEGRAM_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    return { ok: response.ok, status: response.status, data }
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 'timeout' : 'network', error: error.message }
  } finally {
    clearTimeout(timer)
  }
}

async function telegram(method, body = null) {
  const result = await httpJson(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: body ? 'POST' : 'GET',
    body,
  })
  return { ok: result.ok, status: result.status, result: result.data?.result, error: result.error }
}

// La alerta va en texto plano: trae URLs y mensajes de error de terceros que
// rompen el parser de Markdown de Telegram.
async function sendAlert(text) {
  if (!ALERT_CHAT_ID) {
    log('SIN TELEGRAM_ALERT_CHAT_ID: no hay a donde avisar. La alerta era:\n' + text)
    return false
  }
  if (DRY_RUN) {
    log('[dry-run] Habria mandado esta alerta:\n' + text)
    return true
  }
  const sent = await telegram('sendMessage', { chat_id: ALERT_CHAT_ID, text })
  if (!sent.ok) log(`No se pudo mandar la alerta (${sent.status})`)
  return sent.ok
}

async function main() {
  if (!TOKEN) {
    console.error('Falta TELEGRAM_BOT_TOKEN. Sin token el watchdog no puede consultar nada.')
    process.exit(1)
  }

  log(`Watchdog de ${SERVICE_NAME} — ${new Date().toISOString()}`)
  log(`URL esperada del webhook: ${EXPECTED_URL || '(no configurada)'}`)

  const me = await telegram('getMe')
  const webhook = await telegram('getWebhookInfo')

  // El servicio solo se consulta si sabemos donde vive. Sin TELEGRAM_SERVICE_URL
  // el watchdog sigue sirviendo: el estado del webhook en Telegram ya delata una
  // caida (last_error_message y pending_update_count).
  let health = null
  let status = null
  if (SERVICE_URL) {
    const healthResponse = await httpJson(`${SERVICE_URL}/health`, { timeout: SERVICE_TIMEOUT_MS })
    health = { ok: healthResponse.ok, status: healthResponse.status, error: healthResponse.error }
    log(`GET /health -> ${healthResponse.status}`)

    if (healthResponse.ok) {
      const statusResponse = await httpJson(`${SERVICE_URL}/telegram/status`, { timeout: SERVICE_TIMEOUT_MS })
      if (statusResponse.ok) status = statusResponse.data
      log(`GET /telegram/status -> ${statusResponse.status}`)
    }
  }

  const verdict = evaluate({
    webhookInfo: webhook.ok ? webhook.result : null,
    expectedUrl: EXPECTED_URL,
    health,
    status,
    me,
  })

  if (verdict.ok) {
    log('Todo en orden. Sin alerta.')
    process.exit(0)
  }

  for (const p of verdict.problems) log(`[${p.severity}] ${p.code}: ${p.message}`)

  // Auto-sanacion: si el webhook apunta a otro lado (o no existe), lo reapunta.
  // Es la unica falla que el watchdog puede arreglar solo; las demas necesitan
  // manos en Render.
  let healed = null
  if (verdict.heal) {
    if (DRY_RUN) {
      log(`[dry-run] Habria re-registrado el webhook en ${verdict.heal.url}`)
      healed = verdict.heal
    } else {
      const payload = { url: verdict.heal.url }
      if (SECRET) payload.secret_token = SECRET
      const fixed = await telegram('setWebhook', payload)
      if (fixed.ok) {
        log(`Webhook re-registrado en ${verdict.heal.url}`)
        healed = verdict.heal
      } else {
        log(`No se pudo re-registrar el webhook (${fixed.status})`)
      }
    }
  }

  await sendAlert(formatAlert({ problems: verdict.problems, healed, serviceName: SERVICE_NAME }))

  // Si lo unico roto era el webhook y ya se reapunto, el run es verde: no hay
  // nada pendiente que un humano tenga que hacer.
  const soloEraElWebhook = healed && verdict.problems.every(p => p.code === 'WEBHOOK_MISSING' || p.code === 'WEBHOOK_URL_MISMATCH')
  if (soloEraElWebhook) {
    log('Reparado por el watchdog.')
    process.exit(0)
  }

  process.exit(hasErrors(verdict.problems) ? 1 : 0)
}

main().catch(error => {
  console.error('El watchdog truono:', error.message)
  process.exit(1)
})
