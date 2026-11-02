// Pruebas del agente de herramientas (src/financeAgent.js + src/miloTools.js),
// que es la pieza que traduce una pregunta libre en consultas.
//
// Sin red ni Postgres: el proveedor y Prisma son dobles. El doble de Prisma
// calcula los agregados de verdad, porque el defecto que estas pruebas vigilan
// es justo que los totales salieran de la pagina devuelta en vez del filtro
// completo.
//
// Que se prueba y por que:
//   1. search_transactions puede ordenar por monto. Antes solo ordenaba por
//      fecha y cortaba a 20, asi que "cual es el gasto mas alto" solo miraba
//      los ultimos 20 movimientos y el mas alto podia no estar ahi.
//   2. Los totales cubren todo el filtro, no la pagina. Si no, el agente
//      reporta como total la suma de los 20 que le tocaron.
//   3. El agente sobrevive a que un proveedor falle. Antes hablaba solo con
//      DeepSeek y devolvia null al primer error, y Milo caia al catalogo de
//      seis intents fijos sin que nada lo avisara. Ahora cambia de proveedor
//      incluso a media conversacion.
//   4. Un JSON invalido se repara con UN reintento, no con varios.
//   5. Memoria por chat (6 vueltas, 30 min): "¿y la pasada?" sabe de que se
//      hablaba, y un chat no ve la conversacion de otro.
//   6. El prompt trae la fecha de hoy, la quincena y el glosario del dashboard.

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'

const path = require('path')
const Module = require('module')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

// --- Datos de la quincena de prueba ---------------------------------------
const CATEGORIAS = [
  { id: 1, nombre: 'Hogar', tipo: 'Gasto' },
  { id: 2, nombre: 'Familia', tipo: 'Gasto' },
]
// Fechas relativas a HOY (hora de Mexico): la quincena tiene que estar activa
// de verdad, porque el doble de findFirst respeta el filtro de fechas. Asi
// "Quincena activa: Q35" solo pasa si quincenaActual() filtra bien.
const { fechaMexico: hoyMexico } = require(path.join(SRC, 'financeUtils'))
const diaRelativo = dias => {
  const d = new Date(`${hoyMexico()}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d
}
const QUINCENA = { id: 35, codigo: 'Q35', fechaInicio: diaRelativo(-3), fechaFin: diaRelativo(10) }

// findFirst con los filtros de fecha que usa miloTools (lte/gte/lt/gt).
function cumpleFechas(q, where = {}) {
  for (const campo of ['fechaInicio', 'fechaFin']) {
    const f = where[campo]
    if (!f) continue
    const v = q[campo].getTime()
    if (f.lte && !(v <= f.lte.getTime())) return false
    if (f.gte && !(v >= f.gte.getTime())) return false
    if (f.lt && !(v < f.lt.getTime())) return false
    if (f.gt && !(v > f.gt.getTime())) return false
  }
  return true
}
const TXS = [
  { id: 1, monto: 2850.40, descripcion: 'Super quincenal',  categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-16') },
  { id: 2, monto: 12000.00, descripcion: 'Renta septiembre', categoriaId: 1, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-17') },
  { id: 3, monto: 900.00, descripcion: 'Gasolina',         categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-18') },
  { id: 4, monto: 640.25, descripcion: 'Cena',             categoriaId: 2, tipo: 'Gasto', estatus: 'Pagado', fecha: new Date('2026-09-19') },
]

function conRelaciones(tx) {
  return {
    ...tx,
    categoria: CATEGORIAS.find(c => c.id === tx.categoriaId),
    quincena: QUINCENA,
    user: null,
    metodoPago: null,
    presupuesto: null,
  }
}

function ordenar(lista, orderBy) {
  const campo = Object.keys(orderBy[0])[0]
  const dir = orderBy[0][campo]
  return [...lista].sort((a, b) => {
    const va = campo === 'fecha' ? a.fecha.getTime() : Number(a[campo])
    const vb = campo === 'fecha' ? b.fecha.getTime() : Number(b[campo])
    return dir === 'desc' ? vb - va : va - vb
  })
}

const prismaDoble = {
  quincena: {
    findFirst: async ({ where } = {}) => (cumpleFechas(QUINCENA, where) ? QUINCENA : null),
    findUnique: async () => QUINCENA,
    findMany: async () => [QUINCENA],
  },
  categoria: {
    findMany: async () => CATEGORIAS.map(c => ({ id: c.id, nombre: c.nombre })),
  },
  transaccion: {
    findMany: async ({ orderBy, take } = {}) =>
      ordenar(TXS, orderBy).slice(0, take ?? TXS.length).map(conRelaciones),
    aggregate: async () => ({
      _sum: { monto: TXS.reduce((s, t) => s + t.monto, 0) },
      _count: { _all: TXS.length },
      _max: { monto: Math.max(...TXS.map(t => t.monto)) },
      _min: { monto: Math.min(...TXS.map(t => t.monto)) },
      _avg: { monto: TXS.reduce((s, t) => s + t.monto, 0) / TXS.length },
    }),
    groupBy: async () => {
      const porCat = new Map()
      for (const t of TXS) {
        const acc = porCat.get(t.categoriaId) ?? { monto: 0, n: 0 }
        acc.monto += t.monto; acc.n += 1
        porCat.set(t.categoriaId, acc)
      }
      return [...porCat].map(([categoriaId, v]) => ({ categoriaId, _sum: { monto: v.monto }, _count: { _all: v.n } }))
    },
  },
}

// --- Dobles de proveedor ---------------------------------------------------
// financeAgent captura los modulos al cargarse, asi que el objeto que ve tiene
// que ser siempre el mismo: lo que cambia entre casos es `impl`, y el doble
// delega en el.
const impl = {
  deepseek: { isEnabled: () => false, complete: async () => null },
  gemini: { isEnabled: () => false, complete: async () => null },
}
const proveedorDeepseek = { isEnabled: () => impl.deepseek.isEnabled(), complete: (...a) => impl.deepseek.complete(...a) }
const proveedorGemini = { isEnabled: () => impl.gemini.isEnabled(), complete: (...a) => impl.gemini.complete(...a) }

const requireOriginal = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === './lib/prisma' || id === '../lib/prisma') return prismaDoble
  if (id === './deepseek') return proveedorDeepseek
  if (id === './gemini') return proveedorGemini
  return requireOriginal.apply(this, arguments)
}

const { executeTool } = require(path.join(SRC, 'miloTools'))
const { answer } = require(path.join(SRC, 'financeAgent'))

// Un proveedor que pide el gasto mas alto y luego responde con lo que recibio.
function proveedorQueConsulta(nombre) {
  return {
    isEnabled: () => true,
    complete: async (messages) => {
      const ultimo = messages[messages.length - 1].content
      if (ultimo.includes('TOOL_RESULT')) {
        const json = ultimo.split('TOOL_RESULT search_transactions:\n')[1].split('\n\nContinúa')[0]
        const datos = JSON.parse(json)
        const top = datos.transactions[0]
        return JSON.stringify({ action: 'answer', answer: `El más alto de ${datos.period} fue ${top.description}: $${top.amount}. Total del periodo: $${datos.totals.sum}.` })
      }
      return JSON.stringify({ action: 'tool', tool: 'search_transactions', args: { period: 'current', type: 'Gasto', sort: 'amount_desc', limit: 1 } })
    },
  }
}

async function main() {
  console.log('=== A: search_transactions ordena por monto ===')
  const masAlto = await executeTool('search_transactions', { period: 'current', type: 'Gasto', sort: 'amount_desc', limit: 1 })
  check('devuelve el gasto mas alto, no el mas reciente',
    masAlto.transactions[0]?.description === 'Renta septiembre', masAlto.transactions[0]?.description)
  check('con limit=1 devuelve una sola fila', masAlto.count === 1, masAlto.count)

  const masBajo = await executeTool('search_transactions', { period: 'current', type: 'Gasto', sort: 'amount_asc', limit: 1 })
  check('amount_asc devuelve el mas bajo',
    masBajo.transactions[0]?.description === 'Cena', masBajo.transactions[0]?.description)

  const recientes = await executeTool('search_transactions', { period: 'current', type: 'Gasto', limit: 1 })
  check('sin sort sigue ordenando por fecha (no cambia lo de antes)',
    recientes.transactions[0]?.description === 'Cena', recientes.transactions[0]?.description)

  console.log('\n=== B: los totales cubren el filtro completo, no la pagina ===')
  check('sum es el de los 4 movimientos aunque solo devuelva 1',
    Math.abs(masAlto.totals.sum - 16390.65) < 0.005, masAlto.totals.sum)
  check('count es 4, no 1', masAlto.totals.count === 4, masAlto.totals.count)
  check('max = 12000', masAlto.totals.max === 12000, masAlto.totals.max)
  check('min = 640.25', masAlto.totals.min === 640.25, masAlto.totals.min)
  check('avisa que hubo truncamiento', masAlto.truncated === true, masAlto.truncated)
  check('byCategory viene ordenado de mayor a menor',
    masAlto.totals.byCategory[0].total >= masAlto.totals.byCategory[1].total,
    JSON.stringify(masAlto.totals.byCategory))

  console.log('\n=== C: el agente traduce la pregunta en una consulta ===')
  impl.deepseek = proveedorQueConsulta('deepseek')
  impl.gemini = { isEnabled: () => false, complete: async () => null }
  const r1 = await answer('cual es el gasto mas alto de esta Q?', { senderName: 'Rene' })
  check('responde con el gasto correcto', r1?.reply?.includes('Renta septiembre'), r1?.reply)
  check('uso search_transactions', r1?.trace?.[0]?.tool === 'search_transactions', JSON.stringify(r1?.trace))
  check('reporta el proveedor que respondio', r1?.provider === 'deepseek-agent', r1?.provider)

  console.log('\n=== D: si un proveedor falla, el agente no se apaga ===')
  impl.deepseek = { isEnabled: () => true, complete: async () => null }  // simula DEEPSEEK_MODEL invalido
  impl.gemini = proveedorQueConsulta('gemini')
  const r2 = await answer('cual es el gasto mas alto de esta Q?', { senderName: 'Rene' })
  check('Gemini toma el relevo y contesta', r2?.reply?.includes('Renta septiembre'), r2?.reply)
  check('lo reporta como gemini-agent', r2?.provider === 'gemini-agent', r2?.provider)

  console.log('\n=== E: sin ningun proveedor, devuelve null sin tronar ===')
  impl.deepseek = { isEnabled: () => false, complete: async () => null }
  impl.gemini = { isEnabled: () => false, complete: async () => null }
  const r3 = await answer('cual es el gasto mas alto?', { senderName: 'Rene' })
  check('devuelve null', r3 === null, JSON.stringify(r3))

  console.log('\n=== F: JSON invalido -> un reintento pidiendo solo JSON ===')
  {
    let llamadas = 0
    impl.deepseek = {
      isEnabled: () => true,
      complete: async (messages) => {
        llamadas++
        if (llamadas === 1) return 'Claro, te digo: el gasto mas alto fue la renta'
        const ultimo = messages[messages.length - 1].content
        check('el reintento pide SOLO JSON', /SOLO con un objeto JSON/.test(ultimo), ultimo)
        return JSON.stringify({ action: 'answer', answer: 'La renta.' })
      },
    }
    impl.gemini = { isEnabled: () => false, complete: async () => null }
    const r = await answer('cual es el gasto mas alto?', { senderName: 'Rene' })
    check('contesta despues de reparar', r?.reply === 'La renta.', JSON.stringify(r))
    check('solo hizo dos llamadas', llamadas === 2, llamadas)

    llamadas = 0
    impl.deepseek = { isEnabled: () => true, complete: async () => { llamadas++; return 'nunca json' } }
    const r2 = await answer('cual es el gasto mas alto?', { senderName: 'Rene' })
    check('si tampoco repara, null (un solo reintento)', r2 === null && llamadas === 2, `${JSON.stringify(r2)} llamadas=${llamadas}`)
  }

  console.log('\n=== G: el proveedor falla a media conversacion -> cambia al otro ===')
  {
    let pasoDeepseek = 0
    impl.deepseek = {
      isEnabled: () => true,
      complete: async () => {
        pasoDeepseek++
        // Pide la herramienta y despues se cae (timeout, saldo, lo que sea).
        if (pasoDeepseek === 1) return JSON.stringify({ action: 'tool', tool: 'search_transactions', args: { period: 'current', type: 'Gasto', sort: 'amount_desc', limit: 1 } })
        return null
      },
    }
    impl.gemini = proveedorQueConsulta('gemini')
    const r = await answer('cual es el gasto mas alto de esta Q?', { senderName: 'Rene' })
    check('Gemini termina la respuesta con el historial', r?.reply?.includes('Renta septiembre'), JSON.stringify(r))
    check('reporta gemini-agent', r?.provider === 'gemini-agent', r?.provider)
    check('la herramienta se ejecuto una sola vez', r?.trace?.length === 1, JSON.stringify(r?.trace))
  }

  console.log('\n=== H: memoria por chat: "¿y la pasada?" ve la pregunta anterior ===')
  {
    const { olvidar, _interno } = require(path.join(SRC, 'financeAgent'))
    olvidar(null)
    const vistos = []
    impl.deepseek = {
      isEnabled: () => true,
      complete: async (messages) => {
        vistos.push(messages.map(m => m.content))
        return JSON.stringify({ action: 'answer', answer: `respuesta ${vistos.length}` })
      },
    }
    impl.gemini = { isEnabled: () => false, complete: async () => null }
    await answer('cuanto me queda?', { senderName: 'Rene', chatId: 'chat-1' })
    await answer('y la quincena pasada?', { senderName: 'Rene', chatId: 'chat-1' })
    const segunda = vistos[1].join('\n')
    check('la segunda pregunta lleva la primera en el historial', segunda.includes('cuanto me queda?') && segunda.includes('respuesta 1'), segunda.slice(-300))

    await answer('hola', { senderName: 'Rene', chatId: 'chat-2' })
    check('otro chat no ve esa conversacion', !vistos[2].join('\n').includes('cuanto me queda?'))

    for (let i = 0; i < 10; i++) await answer(`pregunta ${i}`, { senderName: 'Rene', chatId: 'chat-3' })
    check(`guarda solo las ultimas ${_interno.MEMORIA_TURNOS} vueltas`, _interno.recordar('chat-3').length === _interno.MEMORIA_TURNOS, _interno.recordar('chat-3').length)

    const viejo = Date.now() - _interno.MEMORIA_TTL_MS - 1000
    _interno.guardarTurno('chat-4', 'vieja', 'respuesta vieja', viejo)
    check('a los 30 min se olvida', _interno.recordar('chat-4').length === 0, _interno.recordar('chat-4').length)
    check('MAX_STEPS es 6', _interno.MAX_STEPS === 6, _interno.MAX_STEPS)
  }

  console.log('\n=== I: el prompt sabe que dia es y en que quincena va ===')
  {
    let sistema = ''
    impl.deepseek = {
      isEnabled: () => true,
      complete: async (messages) => {
        sistema = messages[0].content
        return JSON.stringify({ action: 'answer', answer: 'ok' })
      },
    }
    await answer('que dia es?', { senderName: 'Rene' })
    const { fechaMexico } = require(path.join(SRC, 'financeUtils'))
    check('incluye la fecha de hoy (hora de Mexico)', sistema.includes(fechaMexico()), sistema.slice(0, 200))
    check('incluye la quincena activa', /Quincena activa: Q35/.test(sistema), sistema.slice(0, 300))
    check('incluye el usuario', /Usuario: Rene/.test(sistema))
    check('trae el glosario del dashboard', /Te sobran/.test(sistema) && /Vas \$X mejor\/peor/.test(sistema))
    check('get_money_status esta entre las herramientas', sistema.includes('get_money_status'))
  }

  console.log('\n=== J: la respuesta sale como texto plano y con tope ===')
  {
    const { _interno } = require(path.join(SRC, 'financeAgent'))
    const limpia = _interno.limpiarRespuesta('**Te faltan $9,075.39**\n- uno\n- dos\n\n\n\n__fin__')
    check('sin asteriscos ni guiones bajos', !/[*_]/.test(limpia), limpia)
    check('las viñetas quedan con •', /• uno/.test(limpia), limpia)
    check('corta a 3500 caracteres', _interno.limpiarRespuesta('x'.repeat(5000)).length <= 3500)
  }

  console.log('\n=== K: entre dos quincenas usa la siguiente, como el dashboard ===')
  {
    // Hoy cae en un hueco: la unica quincena empieza en dos dias. El dashboard
    // (getDefaultQuincenaId) abre esa; antes Milo decia "No encontré el
    // periodo actual".
    const original = { fechaInicio: QUINCENA.fechaInicio, fechaFin: QUINCENA.fechaFin }
    QUINCENA.fechaInicio = diaRelativo(2)
    QUINCENA.fechaFin = diaRelativo(15)
    const periodo = await executeTool('get_current_period')
    check('get_current_period devuelve la siguiente', periodo.ok && periodo.period.code === 'Q35' && periodo.period.isCurrent === false, JSON.stringify(periodo))
    const busqueda = await executeTool('search_transactions', { period: 'current', type: 'Gasto', limit: 1 })
    check('las herramientas no dicen "No encontré el periodo"', busqueda.ok && busqueda.period === 'Q35', JSON.stringify(busqueda).slice(0, 200))

    let sistema = ''
    impl.deepseek = {
      isEnabled: () => true,
      complete: async (messages) => { sistema = messages[0].content; return JSON.stringify({ action: 'answer', answer: 'ok' }) },
    }
    await answer('que dia es?', { senderName: 'Rene' })
    check('el prompt no la llama "activa" y dice que es la del dashboard',
      !/Quincena activa/.test(sistema) && /ninguna quincena.*Q35/.test(sistema), sistema.slice(0, 400))

    // Ya paso todo: la ultima.
    QUINCENA.fechaInicio = diaRelativo(-30)
    QUINCENA.fechaFin = diaRelativo(-16)
    const ultima = await executeTool('get_current_period')
    check('si ya no hay siguiente, la ultima', ultima.ok && ultima.period.code === 'Q35', JSON.stringify(ultima))
    Object.assign(QUINCENA, original)
  }

  console.log('\n=== L: tope de tiempo total para una respuesta ===')
  {
    const { _interno } = require(path.join(SRC, 'financeAgent'))
    check('el tope por default es 45 s', _interno.TOPE_MS === 45000, _interno.TOPE_MS)

    // Los dos proveedores cuelgan mas que el tope: no se espera a sus timeouts.
    const colgado = { isEnabled: () => true, complete: () => new Promise(resolve => setTimeout(() => resolve(null), 3000)) }
    impl.deepseek = colgado
    impl.gemini = colgado
    let t0 = Date.now()
    const r1 = await answer('cuanto me queda?', { senderName: 'Rene', deadlineMs: 200 })
    check('proveedores colgados: null dentro del tope', r1 === null && Date.now() - t0 < 1000, `${Date.now() - t0} ms`)

    // Un proveedor que contesta rapido pero nunca termina (pide herramientas
    // distintas paso tras paso): el tope corta antes de MAX_STEPS.
    let pasos = 0
    impl.deepseek = {
      isEnabled: () => true,
      complete: async () => {
        pasos++
        await new Promise(resolve => setTimeout(resolve, 80))
        return JSON.stringify({ action: 'tool', tool: 'search_transactions', args: { period: 'current', limit: pasos } })
      },
    }
    impl.gemini = { isEnabled: () => false, complete: async () => null }
    t0 = Date.now()
    const r2 = await answer('cuanto me queda?', { senderName: 'Rene', deadlineMs: 200 })
    check('pasos lentos: corta por tiempo, no por MAX_STEPS', r2 === null && pasos < _interno.MAX_STEPS && Date.now() - t0 < 1000, `pasos=${pasos} ${Date.now() - t0} ms`)
  }

  console.log('\n=== Formato: las listas van una por renglon (2026-11-02) ===')
  {
    // El usuario vio "Lo más próximo: Renta $10,500 y Hosting $487 hoy,
    // Colegiatura ... / Luego: ChatGPT ..., YouTube ..." -- quince pagos
    // amontonados con comas porque el prompt topaba en "3 viñetas".
    const { _interno } = require(path.join(SRC, 'financeAgent'))
    const prompt = _interno.buildSystemPrompt('CONTEXTO')
    check('el prompt pide UNA cosa por renglon', /UNA por renglón/.test(prompt) && /NUNCA juntes varias cosas en la misma viñeta/.test(prompt))
    check('ya no topa en 3 viñetas', !/hasta 3 viñetas/.test(prompt))
    check('trae el ejemplo de lista', /• Renta — \$10,500\.00 \(hoy\)\n\s*• Hosting/.test(prompt))
    const limpio = _interno.limpiarRespuesta('Te faltan $8,163.86.\n- Renta — $10,500.00 (hoy)\n* **Hosting** — $487.00 (hoy)')
    check('la limpieza deja viñetas "• " y cada una en su renglon', limpio === 'Te faltan $8,163.86.\n• Renta — $10,500.00 (hoy)\n• Hosting — $487.00 (hoy)', JSON.stringify(limpio))
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
