// Pruebas del proveedor Claude (src/claude.js) y del respaldo a DeepSeek en
// el agente (src/financeAgent.js). Sin red: el SDK de Anthropic y los dos
// proveedores son dobles.
//
// Que se fija y por que:
//   1. La peticion respeta lo que Sonnet 5.5 exige: nada de
//      thinking "disabled" ni temperature (los dos son 400 en este modelo),
//      effort explicito, holgura en max_tokens para el razonamiento, y
//      fallbacks del lado del servidor ante un rechazo de seguridad.
//   2. La respuesta se lee por TIPO de bloque: puede empezar con un bloque
//      `thinking` vacio, y leer content[0] daria una respuesta vacia.
//   3. Ningun error del SDK se escapa como excepcion: el agente espera el
//      contrato { content, finishReason, error } igual que con DeepSeek.
//   4. Si Claude falla, el agente sigue con DeepSeek en la MISMA respuesta y
//      no le vuelve a pegar a Claude en los pasos siguientes. Sin llave de
//      Anthropic, todo funciona como antes (solo DeepSeek).

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'
delete process.env.CLAUDE_MODEL
delete process.env.CLAUDE_EFFORT

const path = require('path')
const Module = require('module')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

// --- Doble del SDK de Anthropic ------------------------------------------------
class APIError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
class AuthenticationError extends APIError {}
class RateLimitError extends APIError {}

const peticiones = []
let respuestaSdk = null // objeto, o Error para lanzar
class FakeAnthropic {
  constructor(opts) {
    this.opts = opts
    this.beta = {
      messages: {
        create: async params => {
          peticiones.push(params)
          if (respuestaSdk instanceof Error) throw respuestaSdk
          return respuestaSdk
        },
      },
    }
  }
}
FakeAnthropic.APIError = APIError
FakeAnthropic.AuthenticationError = AuthenticationError
FakeAnthropic.RateLimitError = RateLimitError

// --- Dobles de proveedor para el agente ------------------------------------------
const llamadas = { claude: 0, deepseek: 0 }
const impl = {
  claude: { isEnabled: () => false, completeDetallado: async () => ({ content: null, error: 'apagado' }) },
  deepseek: { isEnabled: () => false, completeDetallado: async () => ({ content: null, error: 'apagado' }) },
}
const claudeDoble = {
  isEnabled: () => impl.claude.isEnabled(),
  completeDetallado: (...a) => { llamadas.claude++; return impl.claude.completeDetallado(...a) },
}
const deepseekDoble = {
  isEnabled: () => impl.deepseek.isEnabled(),
  completeDetallado: (...a) => { llamadas.deepseek++; return impl.deepseek.completeDetallado(...a) },
}

// Prisma: el agente pide la quincena para el contexto del dia; sin base, eso
// falla y el agente sigue (lo registra y contesta igual).
const prismaDoble = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('sin base en esta prueba') } }) })

let modoAgente = false
const requireOriginal = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === '@anthropic-ai/sdk') return FakeAnthropic
  if (id === './lib/prisma' || id === '../lib/prisma') return prismaDoble
  if (modoAgente && id === './claude') return claudeDoble
  if (modoAgente && id === './deepseek') return deepseekDoble
  return requireOriginal.apply(this, arguments)
}

const silenciar = fn => async (...a) => {
  const { log, error } = console
  console.log = () => {}; console.error = () => {}
  try { return await fn(...a) } finally { console.log = log; console.error = error }
}

async function main() {
  const claude = require(path.join(SRC, 'claude.js'))

  console.log('=== A: sin ANTHROPIC_API_KEY esta apagado y no llama ===')
  delete process.env.ANTHROPIC_API_KEY
  check('isEnabled() false', claude.isEnabled() === false)
  const apagado = await claude.completeDetallado([{ role: 'user', content: 'hola' }])
  check('devuelve error en vez de lanzar', apagado.content === null && /ANTHROPIC_API_KEY/.test(apagado.error), JSON.stringify(apagado))
  check('no hizo peticion', peticiones.length === 0)

  process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba'

  console.log('\n=== B: la peticion cumple con Sonnet 5.5 ===')
  respuestaSdk = {
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"action":"answer","answer":"Hola"}' }],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 90 },
  }
  const r = await silenciar(claude.completeDetallado)([
    { role: 'system', content: 'Eres Milo.' },
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: '{"action":"tool"}' },
    { role: 'user', content: 'TOOL_RESULT x' },
  ], { json: true, maxTokens: 2000 })
  const p = peticiones.at(-1)
  check('modelo claude-sonnet-5-5', p.model === 'claude-sonnet-5-5', p.model)
  check('system va aparte, no como mensaje', p.system === 'Eres Milo.' && p.messages.every(m => m.role !== 'system'), JSON.stringify(p.messages.map(m => m.role)))
  check('conserva el orden user/assistant/user', JSON.stringify(p.messages.map(m => m.role)) === '["user","assistant","user"]')
  check('effort low explicito', p.output_config?.effort === 'low', JSON.stringify(p.output_config))
  check('NO manda thinking disabled (400 en Sonnet 5.5)', !p.thinking || p.thinking.type !== 'disabled', JSON.stringify(p.thinking))
  check('NO manda temperature ni top_p (400 en Sonnet 5.5)', !('temperature' in p) && !('top_p' in p) && !('top_k' in p))
  check('max_tokens con holgura para el razonamiento', p.max_tokens === 2000 + claude._interno.HOLGURA_RAZONAMIENTO, p.max_tokens)
  check('fallbacks del servidor ante rechazos', p.fallbacks === 'default' && p.betas?.includes('server-side-fallback-2026-07-01'), JSON.stringify({ f: p.fallbacks, b: p.betas }))
  check('cache del prefijo', p.cache_control?.type === 'ephemeral')
  check('lee el texto aunque el primer bloque sea thinking', r.content === '{"action":"answer","answer":"Hola"}', JSON.stringify(r))
  check('finishReason end_turn, sin error', r.finishReason === 'end_turn' && r.error === null)

  console.log('\n=== C: cortado, rechazo y errores siguen el contrato ===')
  respuestaSdk = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"action":"ans' }], usage: { output_tokens: 4000 } }
  const cortado = await silenciar(claude.completeDetallado)([{ role: 'user', content: 'x' }])
  check('max_tokens -> finishReason "length" (el agente pide algo mas corto)', cortado.finishReason === 'length', cortado.finishReason)

  respuestaSdk = { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [], usage: {} }
  const rechazo = await silenciar(claude.completeDetallado)([{ role: 'user', content: 'x' }])
  check('refusal -> error con la categoria, sin contenido', rechazo.content === null && rechazo.error === 'refusal: cyber', JSON.stringify(rechazo))

  respuestaSdk = new AuthenticationError(401, 'invalid x-api-key')
  const auth = await silenciar(claude.completeDetallado)([{ role: 'user', content: 'x' }])
  check('401 -> error legible, no excepcion', /401/.test(auth.error || '') && auth.content === null, JSON.stringify(auth))

  respuestaSdk = new RateLimitError(429, 'rate limited')
  const limite = await silenciar(claude.completeDetallado)([{ role: 'user', content: 'x' }])
  check('429 -> error', /429/.test(limite.error || ''), JSON.stringify(limite))

  respuestaSdk = new Error('socket hang up')
  const red = await silenciar(claude.completeDetallado)([{ role: 'user', content: 'x' }])
  check('error de red -> error', /network/.test(red.error || ''), JSON.stringify(red))

  console.log('\n=== D: el agente usa Claude primero y DeepSeek de respaldo ===')
  modoAgente = true
  const { answer } = require(path.join(SRC, 'financeAgent.js'))
  const contesta = texto => async () => ({ content: JSON.stringify({ action: 'answer', answer: texto }), finishReason: 'stop', error: null })

  impl.claude = { isEnabled: () => true, completeDetallado: contesta('Respuesta de Claude') }
  impl.deepseek = { isEnabled: () => true, completeDetallado: contesta('Respuesta de DeepSeek') }
  llamadas.claude = 0; llamadas.deepseek = 0
  const d1 = await silenciar(answer)('hola milo', { senderName: 'Rene', chatId: 'd1' })
  check('con las dos llaves contesta Claude', d1?.reply === 'Respuesta de Claude' && d1.provider === 'claude-agent', JSON.stringify(d1 && { r: d1.reply, p: d1.provider }))
  check('y DeepSeek ni se toca', llamadas.deepseek === 0, llamadas.deepseek)

  impl.claude = { isEnabled: () => true, completeDetallado: async () => ({ content: null, finishReason: null, error: '401: ANTHROPIC_API_KEY invalida' }) }
  llamadas.claude = 0; llamadas.deepseek = 0
  const d2 = await silenciar(answer)('hola milo', { senderName: 'Rene', chatId: 'd2' })
  check('si Claude falla, contesta DeepSeek en la misma respuesta', d2?.reply === 'Respuesta de DeepSeek' && d2.provider === 'deepseek-agent', JSON.stringify(d2 && { r: d2.reply, p: d2.provider }))

  // Varios pasos: tras el fallo de Claude, los pasos siguientes ya no le pegan.
  let pasoDs = 0
  impl.deepseek = {
    isEnabled: () => true,
    completeDetallado: async () => {
      pasoDs++
      return pasoDs === 1
        ? { content: JSON.stringify({ action: 'tool', tool: 'get_system_overview', args: {} }), finishReason: 'stop', error: null }
        : { content: JSON.stringify({ action: 'answer', answer: 'Listo con DeepSeek' }), finishReason: 'stop', error: null }
    },
  }
  llamadas.claude = 0; llamadas.deepseek = 0
  const d3 = await silenciar(answer)('dame el panorama', { senderName: 'Rene', chatId: 'd3' })
  check('termina con DeepSeek', d3?.reply === 'Listo con DeepSeek', JSON.stringify(d3 && d3.reply))
  check('a Claude se le pidio una sola vez', llamadas.claude === 1, llamadas.claude)
  check('DeepSeek hizo los dos pasos', llamadas.deepseek === 2, llamadas.deepseek)

  impl.claude = { isEnabled: () => false, completeDetallado: contesta('no deberia') }
  impl.deepseek = { isEnabled: () => true, completeDetallado: contesta('Solo DeepSeek') }
  llamadas.claude = 0; llamadas.deepseek = 0
  const d4 = await silenciar(answer)('hola', { senderName: 'Rene', chatId: 'd4' })
  check('sin ANTHROPIC_API_KEY funciona como antes (solo DeepSeek)', d4?.reply === 'Solo DeepSeek' && llamadas.claude === 0, JSON.stringify(d4 && d4.reply))

  impl.deepseek = { isEnabled: () => false, completeDetallado: contesta('x') }
  const d5 = await silenciar(answer)('hola', { senderName: 'Rene', chatId: 'd5' })
  check('sin ninguna llave devuelve null (index.js dice "no pude")', d5 === null, JSON.stringify(d5))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
