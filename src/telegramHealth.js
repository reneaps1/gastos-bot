// Una sola fuente de verdad sobre "que cuenta como roto" en el bot de Telegram.
//
// SIN DEPENDENCIAS a proposito: lo consumen dos cosas muy distintas.
//   - scripts/watchdog-telegram.js, que corre en GitHub Actions con `fetch`
//     nativo y sin `npm install` (por eso nada de axios aqui).
//   - scripts/diagnose-telegram.js, el diagnostico manual.
// Si la interpretacion viviera duplicada en los dos, el diagnostico automatico
// y el manual podrian contradecirse justo cuando mas importa.
//
// Todo aqui es funcion pura: recibe los datos ya obtenidos y decide. Eso lo
// hace testeable sin red ni Postgres (scripts/test-watchdog.js).

// Un error de entrega mas viejo que esto ya no dice nada del estado actual:
// Telegram conserva last_error_message hasta que una entrega funciona, asi que
// sin ventana estariamos alertando por una caida que ya se resolvio.
const ERROR_WINDOW_MS = 60 * 60 * 1000

// Telegram encola lo que no puede entregar. Unos pocos son normales durante un
// arranque en frio del plan free; una pila sostenida significa que el webhook
// no esta aceptando nada.
const PENDING_THRESHOLD = 5

function problem(code, severity, message, hint) {
  return { code, severity, message, hint }
}

function describeDeliveryError(message) {
  if (/403/.test(message)) {
    return 'El app esta respondiendo 403: el secreto que Telegram guarda no coincide con TELEGRAM_WEBHOOK_SECRET del servicio. Re-registra el webhook.'
  }
  if (/40[14]/.test(message)) {
    return 'La URL del webhook ya no existe en ese servicio. Verifica que el servicio este desplegando el codigo correcto.'
  }
  if (/50[0234]|Gateway|timeout|timed out/i.test(message)) {
    return 'El servicio no contesto: esta caido, en crash loop, o tardo demasiado en despertar (plan free de Render).'
  }
  if (/resolve|DNS|SSL|certificate/i.test(message)) {
    return 'Telegram no pudo ni conectarse al host. Revisa que la URL registrada sea la real del servicio.'
  }
  return 'Revisa los logs del servicio que atiende el webhook.'
}

/**
 * @param {object} input
 * @param {object|null} input.webhookInfo  `result` de getWebhookInfo, o null si no se pudo consultar
 * @param {string|null} input.expectedUrl  URL que DEBE tener registrada el webhook
 * @param {{ok: boolean, status?: number, error?: string}|null} input.health  resultado de GET /health
 * @param {object|null} input.status  payload de GET /telegram/status
 * @param {{ok: boolean, status?: number|string}|null} input.me  resultado de getMe
 * @param {number} input.now  epoch ms (inyectable para pruebas)
 * @returns {{ok: boolean, problems: Array, heal: {url: string}|null}}
 */
function evaluate({ webhookInfo = null, expectedUrl = null, health = null, status = null, me = null, now = Date.now() } = {}) {
  const problems = []
  let heal = null

  // 1. Token. Solo 401/404 los contesta Telegram; cualquier otro fallo es de
  //    red del que corre el chequeo y no acusa al token.
  if (me && !me.ok) {
    if (me.status === 401 || me.status === 404) {
      problems.push(problem(
        'TOKEN_INVALID',
        'ERROR',
        `Telegram rechaza el token (${me.status})`,
        'El token fue revocado o cambiado. Genera uno nuevo en @BotFather y actualizalo en Render.',
      ))
    } else {
      problems.push(problem(
        'TELEGRAM_UNREACHABLE',
        'WARN',
        `No se pudo consultar la API de Telegram (${me.status})`,
        'Problema de red del watchdog, no necesariamente del bot. Si se repite, revisa api.telegram.org.',
      ))
    }
  }

  // 2. Webhook registrado.
  if (webhookInfo) {
    if (!webhookInfo.url) {
      problems.push(problem(
        'WEBHOOK_MISSING',
        'ERROR',
        'Telegram no tiene ningun webhook registrado: no hay a donde entregar los mensajes',
        'Se re-registra solo si hay una URL esperada configurada.',
      ))
      if (expectedUrl) heal = { url: expectedUrl }
    } else if (expectedUrl && webhookInfo.url !== expectedUrl) {
      problems.push(problem(
        'WEBHOOK_URL_MISMATCH',
        'ERROR',
        `El webhook apunta a ${webhookInfo.url} en vez de ${expectedUrl}`,
        'Otra instancia se lo llevo, o alguien corrio setWebhook a mano. Se reapunta solo.',
      ))
      heal = { url: expectedUrl }
    }

    const lastError = String(webhookInfo.last_error_message || '')
    if (lastError) {
      const errorAt = webhookInfo.last_error_date ? webhookInfo.last_error_date * 1000 : null
      const reciente = errorAt === null || now - errorAt < ERROR_WINDOW_MS
      if (reciente) {
        problems.push(problem(
          'WEBHOOK_DELIVERY_ERROR',
          'ERROR',
          `Telegram no pudo entregar: ${lastError}`,
          describeDeliveryError(lastError),
        ))
      }
    }

    const pending = Number(webhookInfo.pending_update_count || 0)
    if (pending > PENDING_THRESHOLD) {
      problems.push(problem(
        'WEBHOOK_PENDING_BACKLOG',
        'WARN',
        `${pending} mensajes encolados sin entregar`,
        'Se entregan solos en cuanto el webhook vuelva a responder 200.',
      ))
    }
  }

  // 3. El servicio responde.
  if (health && !health.ok) {
    problems.push(problem(
      'SERVICE_DOWN',
      'ERROR',
      `El servicio no responde en /health (${health.status || health.error || 'sin respuesta'})`,
      'Deploy fallido, crash loop, o servicio suspendido. Revisa Render: Events y Logs.',
    ))
  }

  // 4. El servicio responde pero esta mal configurado. Este bloque cubre el
  //    caso mas traicionero: todo "verde" y aun asi el bot ignora todo.
  if (status) {
    if (status.allowedChatIdCount === 0) {
      problems.push(problem(
        'SERVICE_MISCONFIGURED',
        'ERROR',
        'TELEGRAM_ALLOWED_CHAT_IDS esta vacia en el servicio: la lista blanca es fail-closed y descarta TODOS los mensajes en silencio',
        'Pon el id del grupo (negativo) en el Environment del servicio.',
      ))
    }
    if (status.tokenConfigured === false) {
      problems.push(problem(
        'SERVICE_MISCONFIGURED',
        'ERROR',
        'El servicio no tiene TELEGRAM_BOT_TOKEN: nunca registra el webhook ni puede responder',
        'Configura TELEGRAM_BOT_TOKEN en el Environment del servicio.',
      ))
    }
    if (status.registersWebhook === false) {
      problems.push(problem(
        'SERVICE_NOT_OWNER',
        'WARN',
        'El servicio tiene TELEGRAM_REGISTER_WEBHOOK=false: no reclama el webhook',
        'Correcto si este NO es el servicio de Telegram. Si si lo es, quita esa variable.',
      ))
    }
  }

  return { ok: problems.length === 0, problems, heal }
}

function hasErrors(problems) {
  return problems.some(p => p.severity === 'ERROR')
}

// Mensaje corto para mandar al chat de Telegram. Sin Markdown a proposito: el
// texto trae URLs y mensajes de error de terceros que rompen el parser.
function formatAlert({ problems, healed = null, serviceName = 'el bot' }) {
  const lines = [`Milo no esta respondiendo (${serviceName})`, '']

  for (const p of problems) {
    lines.push(`- ${p.message}`)
    if (p.hint) lines.push(`  ${p.hint}`)
  }

  if (healed) {
    lines.push('', `Ya reapunte el webhook a ${healed.url}. Si el servicio esta vivo, deberia volver solo.`)
  }

  return lines.join('\n')
}

module.exports = { evaluate, hasErrors, formatAlert, describeDeliveryError, ERROR_WINDOW_MS, PENDING_THRESHOLD }
