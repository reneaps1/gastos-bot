// Pruebas de la logica del watchdog (src/telegramHealth.js), sin red.
//
// evaluate() es la que decide si Milo esta caido, si se puede reparar solo y
// que decirle a Rene. Un falso negativo aqui son horas de silencio como las del
// 2026-09-12; un falso positivo es una alerta cada 30 minutos sin razon. Por eso
// cada codigo tiene su caso, y tambien lo tienen los casos que NO deben alertar.

const { evaluate, hasErrors, formatAlert } = require('../src/telegramHealth')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const URL_OK = 'https://milo.onrender.com/telegram/webhook'
const AHORA = Date.parse('2026-09-12T21:00:00Z')
const haceMinutos = m => Math.floor((AHORA - m * 60000) / 1000)

function codigos(veredicto) {
  return veredicto.problems.map(p => p.code).sort()
}

// Un servicio sano, para usarlo de base y variar una cosa a la vez.
const SANO = {
  webhookInfo: { url: URL_OK, pending_update_count: 0 },
  expectedUrl: URL_OK,
  health: { ok: true, status: 200 },
  status: { allowedChatIdCount: 1, tokenConfigured: true, secretConfigured: true, registersWebhook: true, urlMatchesExpected: true },
  me: { ok: true },
  now: AHORA,
}

console.log('\n=== A: todo sano no alerta ===')
const a = evaluate(SANO)
check('ok = true', a.ok === true, JSON.stringify(codigos(a)))
check('sin problemas', a.problems.length === 0, JSON.stringify(a.problems))
check('sin reparacion pendiente', a.heal === null, JSON.stringify(a.heal))

console.log('\n=== B: webhook apuntando a otro lado se detecta y se repara ===')
const b = evaluate({ ...SANO, webhookInfo: { url: 'https://otro.onrender.com/telegram/webhook', pending_update_count: 0 } })
check('detecta WEBHOOK_URL_MISMATCH', codigos(b).includes('WEBHOOK_URL_MISMATCH'), JSON.stringify(codigos(b)))
check('propone reapuntar a la URL correcta', b.heal?.url === URL_OK, JSON.stringify(b.heal))
check('es ERROR', hasErrors(b.problems) === true)

console.log('\n=== C: sin webhook registrado ===')
const c = evaluate({ ...SANO, webhookInfo: { url: '', pending_update_count: 0 } })
check('detecta WEBHOOK_MISSING', codigos(c).includes('WEBHOOK_MISSING'), JSON.stringify(codigos(c)))
check('propone registrarlo', c.heal?.url === URL_OK, JSON.stringify(c.heal))

console.log('\n=== D: el servicio no responde (el caso del 2026-09-12) ===')
const d = evaluate({
  ...SANO,
  health: { ok: false, status: 'timeout' },
  status: null,
  webhookInfo: {
    url: URL_OK,
    pending_update_count: 14,
    last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
    last_error_date: haceMinutos(5),
  },
})
check('detecta SERVICE_DOWN', codigos(d).includes('SERVICE_DOWN'), JSON.stringify(codigos(d)))
check('detecta WEBHOOK_DELIVERY_ERROR', codigos(d).includes('WEBHOOK_DELIVERY_ERROR'), JSON.stringify(codigos(d)))
check('detecta la cola de mensajes', codigos(d).includes('WEBHOOK_PENDING_BACKLOG'), JSON.stringify(codigos(d)))
check('NO intenta repararlo solo', d.heal === null, JSON.stringify(d.heal))
const pistaD = d.problems.find(p => p.code === 'WEBHOOK_DELIVERY_ERROR')?.hint || ''
check('la pista habla de servicio caido', /caido|crash loop|despertar/i.test(pistaD), pistaD)

console.log('\n=== E: 403 apunta al secreto del webhook, no al servicio ===')
const e = evaluate({
  ...SANO,
  webhookInfo: {
    url: URL_OK,
    pending_update_count: 0,
    last_error_message: 'Wrong response from the webhook: 403 Forbidden',
    last_error_date: haceMinutos(2),
  },
})
const pistaE = e.problems.find(p => p.code === 'WEBHOOK_DELIVERY_ERROR')?.hint || ''
check('la pista menciona el secreto', /secreto|SECRET/i.test(pistaE), pistaE)

console.log('\n=== F: un error viejo ya no alerta ===')
// Telegram conserva last_error_message hasta que una entrega funciona. Sin
// ventana de tiempo, una caida resuelta ayer alertaria para siempre.
const f = evaluate({
  ...SANO,
  webhookInfo: {
    url: URL_OK,
    pending_update_count: 0,
    last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
    last_error_date: haceMinutos(180),
  },
})
check('ok = true con error de hace 3 horas', f.ok === true, JSON.stringify(codigos(f)))

console.log('\n=== G: servicio arriba pero con la lista blanca vacia ===')
// El caso traicionero: /health responde 200 y aun asi el bot ignora todo.
const g = evaluate({ ...SANO, status: { ...SANO.status, allowedChatIdCount: 0 } })
check('detecta SERVICE_MISCONFIGURED', codigos(g).includes('SERVICE_MISCONFIGURED'), JSON.stringify(codigos(g)))
check('es ERROR', hasErrors(g.problems) === true)

console.log('\n=== H: servicio sin token ===')
const h = evaluate({ ...SANO, status: { ...SANO.status, tokenConfigured: false } })
check('detecta SERVICE_MISCONFIGURED', codigos(h).includes('SERVICE_MISCONFIGURED'), JSON.stringify(codigos(h)))

console.log('\n=== I: token revocado vs. watchdog sin red ===')
const i1 = evaluate({ ...SANO, me: { ok: false, status: 401 } })
check('401 de Telegram = TOKEN_INVALID (ERROR)', codigos(i1).includes('TOKEN_INVALID') && hasErrors(i1.problems), JSON.stringify(codigos(i1)))
const i2 = evaluate({ ...SANO, me: { ok: false, status: 'network' } })
check('fallo de red = TELEGRAM_UNREACHABLE (WARN, no acusa al token)', codigos(i2).includes('TELEGRAM_UNREACHABLE') && !hasErrors(i2.problems), JSON.stringify(codigos(i2)))

console.log('\n=== J: el servicio que NO es dueño del webhook solo avisa, no es error ===')
const j = evaluate({ ...SANO, status: { ...SANO.status, registersWebhook: false } })
check('detecta SERVICE_NOT_OWNER', codigos(j).includes('SERVICE_NOT_OWNER'), JSON.stringify(codigos(j)))
check('es WARN, no ERROR', hasErrors(j.problems) === false, JSON.stringify(j.problems))

console.log('\n=== K: sin datos del servicio el webhook solo ya delata la caida ===')
// Si no hay TELEGRAM_SERVICE_URL configurada, health y status llegan en null.
const k = evaluate({
  webhookInfo: { url: URL_OK, pending_update_count: 30, last_error_message: 'Connection timed out', last_error_date: haceMinutos(3) },
  expectedUrl: URL_OK,
  me: { ok: true },
  now: AHORA,
})
check('sigue detectando el problema', codigos(k).includes('WEBHOOK_DELIVERY_ERROR'), JSON.stringify(codigos(k)))
check('no truena con health/status en null', k.problems.length >= 1)

console.log('\n=== L: el mensaje de alerta es legible y accionable ===')
const alerta = formatAlert({ problems: d.problems, healed: null, serviceName: 'milo-telegram-bot' })
check('nombra el servicio', alerta.includes('milo-telegram-bot'), alerta)
check('trae el error de Telegram', alerta.includes('502 Bad Gateway'), alerta)
check('sin markdown que Telegram pueda romper', !/[*_`[\]]/.test(alerta), alerta)
const alertaReparada = formatAlert({ problems: b.problems, healed: b.heal, serviceName: 'milo-telegram-bot' })
check('dice que ya reapunto el webhook', alertaReparada.includes('reapunte'), alertaReparada)

console.log(`\n${pass} pasaron, ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)
