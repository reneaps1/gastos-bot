// Pruebas de la memoria de conversacion de Milo (src/memoriaMilo.js).
//
// Sin red ni Postgres: la tabla milo_conversacion es un doble.
//
// Que se prueba y por que:
//   1. La conversacion SOBREVIVE a un reinicio. Antes vivia solo en el proceso
//      y Render la borraba al dormir el servicio (15 min) o en cada deploy.
//   2. La base es respaldo, no requisito: si falla, la respuesta sale igual.
//   3. No se guarda para siempre, ni se lee lo que ya vencio.
//   4. "Milo espera respuesta" solo cuando termino con pregunta, es reciente y
//      contesta la misma persona.

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const filas = []
let nextId = 1
let baseCaida = false
const fakePrisma = {
  miloConversacion: {
    create: async ({ data }) => {
      if (baseCaida) throw new Error('base caida')
      const fila = { id: nextId++, ...data }
      filas.push(fila)
      return fila
    },
    findMany: async ({ where, take }) => {
      if (baseCaida) throw new Error('base caida')
      return filas
        .filter(f => f.chatId === where.chatId && f.createdAt >= where.createdAt.gte)
        .sort((a, b) => b.id - a.id)
        .slice(0, take)
    },
    deleteMany: async ({ where }) => {
      const antes = filas.length
      for (let i = filas.length - 1; i >= 0; i--) if (filas[i].createdAt < where.createdAt.lt) filas.splice(i, 1)
      return { count: antes - filas.length }
    },
  },
}
const p = require.resolve(path.join(SRC, 'lib/prisma.js'))
require.cache[p] = { id: p, filename: p, loaded: true, exports: fakePrisma }

const m = require(path.join(SRC, 'memoriaMilo.js'))
const errores = []
const errorOriginal = console.error
console.error = (...a) => { errores.push(a.join(' ')) }

async function main() {
  console.log('\n=== M1: la conversacion sobrevive a un reinicio ===')
  await m.guardarTurno('chat-1', 'ayudame con el corte de liquidez', 'Va. ¿Qué saldo hay en BBVA?', Date.now(), { autor: '42' })
  check('la vuelta quedo en la base', filas.length === 1 && filas[0].chatId === 'chat-1' && filas[0].autor === '42', JSON.stringify(filas))
  m.olvidar(null) // el proceso reinicia: el cache se pierde
  check('recien reiniciado el cache esta vacio', m.recordar('chat-1').length === 0)
  await m.cargar('chat-1')
  check('cargar() la trae de la base', m.recordar('chat-1').at(-1)?.respuesta === 'Va. ¿Qué saldo hay en BBVA?', JSON.stringify(m.recordar('chat-1')))
  check('y Milo sigue esperando la respuesta', m.preguntaPendiente('chat-1', { autor: '42' }) !== null)
  await m.cargar('chat-2')
  check('otro chat no ve esa conversacion', m.recordar('chat-2').length === 0)

  console.log('\n=== M2: orden y tope de vueltas al cargar ===')
  m.olvidar(null)
  filas.length = 0
  const base = Date.now() - 60_000
  for (let i = 0; i < 9; i++) await m.guardarTurno('chat-3', `pregunta ${i}`, `respuesta ${i}`, base + i * 1000)
  m.olvidar(null)
  await m.cargar('chat-3')
  const t = m.recordar('chat-3')
  check(`trae solo las ultimas ${m.MEMORIA_TURNOS}`, t.length === m.MEMORIA_TURNOS, t.length)
  check('en orden cronologico', t[0].pregunta === 'pregunta 3' && t.at(-1).pregunta === 'pregunta 8', t.map(x => x.pregunta).join(','))

  console.log('\n=== M3: no lee lo vencido ni guarda para siempre ===')
  m.olvidar(null)
  filas.length = 0
  await m.guardarTurno('chat-4', 'vieja', 'respuesta vieja', Date.now() - m.MEMORIA_TTL_MS - 5000)
  m.olvidar(null)
  await m.cargar('chat-4')
  check('una vuelta de hace mas de 30 min no se carga', m.recordar('chat-4').length === 0)
  await m.guardarTurno('chat-5', 'antigua', 'x', Date.now() - m.RETENCION_MS - 5000)
  await m.guardarTurno('chat-5', 'nueva', 'y')
  check('al escribir se borra lo de mas de 24 h', !filas.some(f => f.pregunta === 'antigua') && filas.some(f => f.pregunta === 'nueva'), JSON.stringify(filas.map(f => f.pregunta)))

  console.log('\n=== M4: con la base caida la memoria sigue funcionando ===')
  m.olvidar(null)
  baseCaida = true
  await m.guardarTurno('chat-6', 'hola', '¿En qué te ayudo?')
  check('guardar no lanza y el cache tiene la vuelta', m.recordar('chat-6').length === 1)
  await m.cargar('chat-7')
  check('cargar no lanza', m.recordar('chat-7').length === 0)
  check('y queda en el log', errores.filter(e => e.includes('MILO_MEMORIA_ERROR')).length === 2, errores.join(' | '))
  baseCaida = false

  console.log('\n=== M5: cuando espera respuesta Milo ===')
  m.olvidar(null)
  const ahora = Date.now()
  m.guardarTurno('c', 'p', '¿Cuál de los dos?', ahora, { autor: '42' })
  check('termino con pregunta -> espera', m.preguntaPendiente('c', { autor: '42', ahora }) !== null)
  check('otra persona del grupo -> no', m.preguntaPendiente('c', { autor: '77', ahora }) === null)
  check('sin saber quien escribe -> espera', m.preguntaPendiente('c', { ahora }) !== null)
  check('pasados 10 min -> ya no', m.preguntaPendiente('c', { autor: '42', ahora: ahora + m.ESPERA_TTL_MS + 1000 }) === null)
  m.guardarTurno('c', 'p2', 'Te sobran $100.00.', ahora, { autor: '42' })
  check('la ultima respuesta no es pregunta -> no', m.preguntaPendiente('c', { autor: '42', ahora }) === null)
  check('chat sin memoria -> no', m.preguntaPendiente('nadie') === null)

  console.error = errorOriginal
  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error = errorOriginal; console.error('El harness truono:', e); process.exit(1) })
