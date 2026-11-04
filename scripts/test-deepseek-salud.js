#!/usr/bin/env node
// Pruebas de src/deepseek.js sin red: completeDetallado (vacio y corte por
// max_tokens) y verificar() (lo que /health reporta como `ai`). axios se
// reemplaza por un doble antes de cargar el modulo.

const path = require('path')
process.env.DEEPSEEK_API_KEY = 'sk-prueba'
process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash'

let pass = 0
let fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) } else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? `  ->  ${extra}` : ''}`) }
}

const llamadas = []
const axiosDoble = { get: null, post: null }
const pAxios = require.resolve('axios')
require.cache[pAxios] = { id: pAxios, filename: pAxios, loaded: true, exports: {
  get: (...a) => { llamadas.push(['get', ...a]); return axiosDoble.get(...a) },
  post: (...a) => { llamadas.push(['post', ...a]); return axiosDoble.post(...a) },
} }
const deepseek = require(path.join(__dirname, '..', 'src', 'deepseek'))
const errorHttp = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: { message } } } })

async function main() {
  console.log('=== A: completeDetallado distingue vacio, corte y error ===')
  axiosDoble.post = async () => ({ data: { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 2000 } } })
  let r = await deepseek.completeDetallado([], { json: true, maxTokens: 2000 })
  check('vacio por max_tokens: content null y finishReason length', r.content === null && r.finishReason === 'length' && r.tokens === 2000 && r.error === null, JSON.stringify(r))
  axiosDoble.post = async () => ({ data: { choices: [{ message: { content: ' {"a":1} ' }, finish_reason: 'stop' }] } })
  r = await deepseek.completeDetallado([])
  check('respuesta normal: content recortado y stop', r.content === '{"a":1}' && r.finishReason === 'stop', JSON.stringify(r))
  check('complete() sigue devolviendo solo el texto', (await deepseek.complete([])) === '{"a":1}')
  axiosDoble.post = async () => { throw errorHttp(401, 'Authentication Fails') }
  r = await deepseek.completeDetallado([])
  check('error HTTP: error con status y detalle', r.content === null && r.error === '401: Authentication Fails', JSON.stringify(r))

  console.log('\n=== B: verificar() para /health ===')
  deepseek._olvidarSalud()
  axiosDoble.get = async () => ({ data: { data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] } })
  let s = await deepseek.verificar({ ahora: 1000 })
  check('modelo en la lista: ok', s.ok === true && s.modelo === 'deepseek-v4-flash', JSON.stringify(s))
  const antes = llamadas.length
  s = await deepseek.verificar({ ahora: 1000 + 5 * 60 * 1000 })
  check('cache de 10 min: no vuelve a llamar', llamadas.length === antes && s.ok === true, llamadas.length - antes)

  deepseek._olvidarSalud()
  axiosDoble.get = async () => { throw errorHttp(401, 'Authentication Fails') }
  s = await deepseek.verificar()
  check('llave invalida: ok false con el error', s.ok === false && /401/.test(s.error), JSON.stringify(s))

  deepseek._olvidarSalud()
  axiosDoble.get = async () => ({ data: { data: [{ id: 'deepseek-chat' }] } })
  axiosDoble.post = async () => ({ data: { choices: [{ message: { content: 'o' }, finish_reason: 'length' }] } })
  s = await deepseek.verificar()
  check('no esta en la lista pero responde (alias): ok, sin falsa alarma', s.ok === true, JSON.stringify(s))
  check('la confirmacion pide 1 token', llamadas.at(-1)[0] === 'post' && llamadas.at(-1)[2]?.max_tokens === 1, JSON.stringify(llamadas.at(-1)?.[2]))

  deepseek._olvidarSalud()
  axiosDoble.post = async () => { throw errorHttp(400, 'Model Not Exist') }
  s = await deepseek.verificar()
  check('no esta en la lista y no responde: ok false (el caso Gemini)', s.ok === false && /Model Not Exist/.test(s.error) && /deepseek-chat/.test(s.error), JSON.stringify(s))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
