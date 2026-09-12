// Diagnostico del bot de Telegram: por que dejo de responder.
//
// El handler de /telegram/webhook tiene dos puertas que descartan mensajes
// SIN responder nada en el chat y (antes de este script) sin dejar rastro:
//
//   1. TELEGRAM_WEBHOOK_SECRET: si lo que Telegram manda en el header
//      X-Telegram-Bot-Api-Secret-Token no coincide con el env del servicio,
//      el app contesta 403 a todos los updates.
//   2. TELEGRAM_ALLOWED_CHAT_IDS: lista blanca fail-closed. Vacia o sin el id
//      del chat, el mensaje se ignora en silencio.
//
// Ambas se agregaron en #103 (2026-09-12). Este script dice cual de las dos
// (o cual otra causa) esta activa.
//
// Uso:
//   node scripts/diagnose-telegram.js
//   node scripts/diagnose-telegram.js --chat -1001234567890
//   node scripts/diagnose-telegram.js --service https://gastos-bot.onrender.com
//   node scripts/diagnose-telegram.js --fix-webhook
//
// Necesita TELEGRAM_BOT_TOKEN en el entorno (.env local o el shell de Render).

require('dotenv').config()
const axios = require('axios')

const args = process.argv.slice(2)
function flag(name) {
  return args.includes(`--${name}`)
}
function option(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const ALLOWED = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')

const findings = []
function note(level, message, hint) {
  findings.push({ level, message, hint })
}

function mask(value) {
  if (!value) return 'no configurado'
  const text = String(value)
  if (text.length <= 8) return `${text.slice(0, 2)}… (${text.length} chars)`
  return `${text.slice(0, 4)}…${text.slice(-4)} (${text.length} chars)`
}

function title(text) {
  console.log(`\n${'='.repeat(70)}\n${text}\n${'='.repeat(70)}`)
}

async function telegramApi(method, payload) {
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`
  try {
    const { data } = payload
      ? await axios.post(url, payload, { timeout: 15000 })
      : await axios.get(url, { timeout: 15000 })
    return { ok: true, result: data?.result }
  } catch (error) {
    return {
      ok: false,
      status: error.response?.status || 'network',
      error: error.response?.data?.description || error.response?.data || error.message,
    }
  }
}

async function main() {
  title('1. Variables de entorno')

  console.log(`TELEGRAM_BOT_TOKEN        : ${mask(TOKEN)}`)
  console.log(`TELEGRAM_WEBHOOK_SECRET   : ${mask(SECRET)}`)
  console.log(`TELEGRAM_ALLOWED_CHAT_IDS : ${ALLOWED || 'no configurado'}`)
  console.log(`DEEPSEEK_API_KEY          : ${mask(process.env.DEEPSEEK_API_KEY)}`)
  console.log(`GEMINI_API_KEY            : ${mask(process.env.GEMINI_API_KEY)}`)
  console.log(`DATABASE_URL              : ${process.env.DATABASE_URL ? 'configurado' : 'no configurado'}`)
  console.log(`RENDER_EXTERNAL_URL       : ${process.env.RENDER_EXTERNAL_URL || 'no configurado'}`)

  if (!TOKEN) {
    note('ERROR', 'TELEGRAM_BOT_TOKEN no esta configurado.', 'Sin token el bot no arranca la integracion: telegram.isEnabled() es false y nunca registra el webhook.')
    report()
    process.exit(1)
  }

  const allowedIds = ALLOWED.split(',').map(x => x.trim()).filter(Boolean)
  if (allowedIds.length === 0) {
    note(
      'ERROR',
      'TELEGRAM_ALLOWED_CHAT_IDS esta vacia: la lista blanca es fail-closed, asi que el bot ignora TODOS los mensajes en silencio.',
      'Pon el id del grupo (negativo) en el Environment de gastos-bot en Render. El id exacto aparece en los logs como TELEGRAM_UNAUTHORIZED_CHAT.',
    )
  } else {
    console.log(`\nChats autorizados (${allowedIds.length}): ${allowedIds.join(', ')}`)
    const grupos = allowedIds.filter(id => id.startsWith('-'))
    if (grupos.length === 0) {
      note(
        'WARN',
        'Ningun id autorizado es negativo, o sea que no hay ningun GRUPO en la lista blanca.',
        'El chat "Control de gastos" es un grupo: su id es negativo (-100… si es supergrupo). Un id positivo solo autoriza el chat privado con el bot.',
      )
    }
  }

  title('2. Token: getMe')

  const me = await telegramApi('getMe')
  if (me.ok) {
    console.log(`Bot @${me.result?.username} (id ${me.result?.id}) — token valido`)
    console.log(`can_read_all_group_messages: ${me.result?.can_read_all_group_messages}`)
    if (me.result?.can_read_all_group_messages === false) {
      note(
        'WARN',
        'El bot tiene el modo privacidad ACTIVO (can_read_all_group_messages=false): en grupos solo recibe comandos, mensajes que lo mencionen o respuestas a el.',
        'En @BotFather: /setprivacy → Disable. Sin eso, "30, suerox" escrito suelto en el grupo nunca llega al webhook.',
      )
    }
  } else {
    console.log(`FALLO: status=${me.status} ${JSON.stringify(me.error)}`)
    // 401/404 los contesta Telegram y significan token muerto. Cualquier otra
    // cosa (timeout, 403 de un proxy, DNS) es que no se pudo llegar a la API:
    // no hay que acusar al token por un problema de red del que corre esto.
    if (me.status === 401 || me.status === 404) {
      note(
        'ERROR',
        `Telegram rechaza el token (${me.status}): esta invalido o fue revocado.`,
        'Genera uno nuevo en @BotFather (/token) y actualiza TELEGRAM_BOT_TOKEN en Render. Con un token muerto el servicio se ve sano pero no puede responder nada.',
      )
    } else {
      note(
        'WARN',
        `No pude llegar a api.telegram.org (${me.status}): no puedo verificar el token ni el webhook desde aqui.`,
        'Corre este script donde haya salida a api.telegram.org (tu maquina o el shell de Render). Los chequeos de variables de entorno de arriba si son validos.',
      )
    }
  }

  title('3. Webhook: getWebhookInfo')

  const info = await telegramApi('getWebhookInfo')
  if (!info.ok) {
    console.log(`FALLO: status=${info.status} ${JSON.stringify(info.error)}`)
  } else {
    const w = info.result || {}
    const expected = process.env.TELEGRAM_WEBHOOK_URL
      || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/telegram/webhook` : null)

    console.log(`url                  : ${w.url || '(ninguna)'}`)
    console.log(`esperada             : ${expected || '(no calculable desde aqui)'}`)
    console.log(`pending_update_count : ${w.pending_update_count ?? 0}`)
    console.log(`ip_address           : ${w.ip_address || 'n/a'}`)
    console.log(`max_connections      : ${w.max_connections ?? 'n/a'}`)
    console.log(`last_error_date      : ${w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : 'ninguno'}`)
    console.log(`last_error_message   : ${w.last_error_message || 'ninguno'}`)
    console.log(`last_synchronization_error_date: ${w.last_synchronization_error_date ? new Date(w.last_synchronization_error_date * 1000).toISOString() : 'ninguno'}`)

    if (!w.url) {
      note('ERROR', 'No hay webhook registrado: Telegram no tiene a donde entregar los mensajes.', 'Reinicia gastos-bot (registra el webhook al arrancar) o corre este script con --fix-webhook.')
    } else if (expected && w.url !== expected) {
      note('ERROR', `El webhook registrado (${w.url}) no es el esperado (${expected}).`, 'Corre --fix-webhook para reapuntarlo.')
    }

    const lastError = String(w.last_error_message || '')

    // Este es el sintoma exacto del secreto desfasado: el app contesta 403 a
    // Telegram porque el header no coincide con TELEGRAM_WEBHOOK_SECRET.
    if (/403/.test(lastError)) {
      note(
        'ERROR',
        `Telegram recibe 403 del webhook ("${lastError}"): el app esta rechazando los updates antes de procesarlos.`,
        SECRET
          ? 'Es TELEGRAM_WEBHOOK_SECRET desfasado: el secreto que Telegram guarda no es el que tiene el servicio. Corre --fix-webhook (o reinicia gastos-bot) para volver a mandarle el secreto actual a Telegram.'
          : 'El servicio no tiene TELEGRAM_WEBHOOK_SECRET configurado, asi que el 403 viene de otra capa (proxy/WAF). Revisa los logs de Render.',
      )
    }

    if (/502|503|504|timeout|Gateway|failed to resolve|connection/i.test(lastError)) {
      note(
        'ERROR',
        `Telegram no pudo entregar los updates ("${lastError}"): el servicio estaba caido o dormido.`,
        'gastos-bot esta en plan free: Render lo suspende a los 15 min sin trafico y el arranque en frio corre prisma generate + migrate deploy antes de escuchar. Los updates que llegan en esa ventana se pierden. Revisa en Render si el servicio esta Live o suspendido (limite de horas del plan free).',
      )
    }

    if ((w.pending_update_count ?? 0) > 0) {
      note(
        'WARN',
        `Hay ${w.pending_update_count} updates pendientes: Telegram los tiene encolados porque el webhook no los acepta.`,
        'Se entregan solos en cuanto el webhook responda 200.',
      )
    }
  }

  const chat = option('chat')
  if (chat) {
    title('4. Chat especifico')
    const permitido = allowedIds.includes(String(chat).trim())
    console.log(`chat ${chat}: ${permitido ? 'AUTORIZADO' : 'NO autorizado (los mensajes se descartan en silencio)'}`)
    if (!permitido) {
      note(
        'ERROR',
        `El chat ${chat} no esta en TELEGRAM_ALLOWED_CHAT_IDS.`,
        `Agrega ${chat} a TELEGRAM_ALLOWED_CHAT_IDS en Render. Ojo: si el grupo se volvio supergrupo, el id cambio a -100…`,
      )
    }

    const chatInfo = await telegramApi('getChat', { chat_id: chat })
    if (chatInfo.ok) {
      console.log(`Telegram lo reporta como: type=${chatInfo.result?.type} title=${JSON.stringify(chatInfo.result?.title)}`)
    } else {
      console.log(`getChat fallo: ${JSON.stringify(chatInfo.error)}`)
    }
  }

  const service = option('service')
  if (service) {
    title('5. Servicio en vivo')
    for (const path of ['/health', '/telegram/status']) {
      try {
        const { data } = await axios.get(`${service.replace(/\/$/, '')}${path}`, { timeout: 60000 })
        console.log(`${path}: ${JSON.stringify(data, null, 2)}`)
        if (path === '/telegram/status' && data?.urlMatchesExpected === false) {
          note('ERROR', 'El servicio reporta urlMatchesExpected=false.', 'El webhook de Telegram apunta a otra URL. Corre --fix-webhook.')
        }
        if (path === '/telegram/status' && data?.allowedChatIdCount === 0) {
          note('ERROR', 'El servicio reporta allowedChatIdCount=0: la lista blanca esta vacia en produccion.', 'Configura TELEGRAM_ALLOWED_CHAT_IDS en el Environment de gastos-bot.')
        }
      } catch (error) {
        console.log(`${path}: FALLO ${error.response?.status || error.message}`)
        note(
          'ERROR',
          `El servicio no responde en ${path} (${error.response?.status || error.message}).`,
          'Si tarda mas de 60s es arranque en frio del plan free; si nunca responde, el servicio esta caido o suspendido en Render.',
        )
      }
    }
  }

  if (flag('fix-webhook')) {
    title('6. Re-registrando el webhook')
    const url = process.env.TELEGRAM_WEBHOOK_URL
      || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/telegram/webhook` : null)
      || (service ? `${service.replace(/\/$/, '')}/telegram/webhook` : null)

    if (!url) {
      console.log('No pude calcular la URL. Pasa --service https://gastos-bot.onrender.com o define TELEGRAM_WEBHOOK_URL.')
    } else {
      const payload = { url }
      if (SECRET) payload.secret_token = SECRET
      const result = await telegramApi('setWebhook', payload)
      console.log(result.ok ? `setWebhook OK → ${url} (secret=${SECRET ? 'si' : 'no'})` : `setWebhook FALLO: ${JSON.stringify(result.error)}`)
    }
  }

  report()
}

function report() {
  title('Resultado')

  if (findings.length === 0) {
    console.log('No encontre ninguna causa de silencio en la configuracion ni en el webhook.')
    console.log('Siguiente paso: manda un mensaje al grupo y busca en los logs de Render la linea TELEGRAM_UPDATE_IN.')
    console.log('  - Si NO aparece: el update nunca llego (servicio dormido/caido, o modo privacidad del bot en grupos).')
    console.log('  - Si aparece y despues TELEGRAM_UNAUTHORIZED_CHAT: el id del chat no esta en la lista blanca.')
    console.log('  - Si aparece TELEGRAM_SECRET_MISMATCH: el secreto del webhook esta desfasado.')
    return
  }

  const orden = { ERROR: 0, WARN: 1 }
  findings.sort((a, b) => orden[a.level] - orden[b.level])
  for (const f of findings) {
    console.log(`\n[${f.level}] ${f.message}`)
    if (f.hint) console.log(`        → ${f.hint}`)
  }
  console.log()
}

main().catch(error => {
  console.error('\nEl diagnostico truono:', error.message)
  process.exit(1)
})
