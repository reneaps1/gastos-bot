// Prueba de integracion del flujo de WhatsApp, sin red ni Postgres.
//
// Levanta el servidor real de src/index.js y le manda webhooks de Meta
// simulados, reemplazando src/database.js y src/whatsapp.js por dobles en
// memoria.
//
// IMPORTANTE: el doble de la base valida cada escritura contra las
// restricciones REALES del esquema (largos de VARCHAR, valores de enum,
// CHECK monto > 0) antes de aceptarla. Un doble que solo guarda objetos en un
// arreglo deja pasar codigo que Postgres rechaza: asi se colo a produccion un
// `tipo` de 21 caracteres en whatsapp_messages.tipo, que es VARCHAR(20).
// Si agregas columnas o cambias limites en prisma/migrations, actualiza
// COLUMNAS aqui.

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.GOOGLE_SHEETS_ENABLED = 'false'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'
process.env.PORT = process.env.TEST_PORT || '34567'
// GEMINI_API_KEY / TODOIST_API_TOKEN / META_* quedan sin definir a proposito:
// esas integraciones se deshabilitan solas y nunca intentan salir a la red.

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

// --- Restricciones reales, copiadas de prisma/migrations ---

const ENUMS = {
  TipoMovimiento: ['Gasto', 'Ingreso', 'Ahorro'],
  ClasificacionGasto: ['Fijo', 'Variable'],
  EstatusPago: ['Pagado', 'Pendiente'],
}

const COLUMNAS = {
  whatsapp_messages: {
    waMessageId: { varchar: 100 },
    fromNumber: { varchar: 20, notNull: true },
    fromName: { varchar: 100 },
    body: { text: true, notNull: true },
    tipo: { varchar: 20 },
    error: { text: true },
  },
  transacciones: {
    descripcion: { varchar: 200, notNull: true },
    clasificacion: { enum: 'ClasificacionGasto' },
    tipo: { enum: 'TipoMovimiento', notNull: true },
    monto: { decimal: [12, 2], positivo: true, notNull: true },
    estatus: { enum: 'EstatusPago' },
    source: { varchar: 20 },
  },
  pending_expenses: {
    phone: { varchar: 20, notNull: true },
    senderName: { varchar: 100 },
    originalMessageId: { varchar: 100 },
    rawText: { text: true, notNull: true },
    descripcion: { varchar: 200, notNull: true },
    monto: { decimal: [12, 2], positivo: true, notNull: true },
    formaPago: { varchar: 30, notNull: true },
    estatus: { enum: 'EstatusPago', notNull: true },
    quincenaCodigo: { varchar: 5, notNull: true },
    source: { varchar: 20, notNull: true },
  },
}

// Imita el rechazo de Postgres. Los mensajes replican los codigos reales
// (22001 value too long, 22P02 invalid enum, 23514 check violation).
function validarEscritura(tabla, data) {
  const reglas = COLUMNAS[tabla]
  if (!reglas) return
  for (const [campo, regla] of Object.entries(reglas)) {
    const valor = data[campo]

    if (valor === undefined || valor === null) {
      if (regla.notNull && !('default' in regla)) {
        // saveTransaccion/saveMessage rellenan varios defaults; solo marcamos
        // los que llegan explicitamente vacios y no tienen default en el codigo.
        if (campo in data) {
          throw new Error(`23502 null value in column "${campo}" of relation "${tabla}" violates not-null constraint`)
        }
      }
      continue
    }

    if (regla.varchar && String(valor).length > regla.varchar) {
      throw new Error(
        `22001 value too long for type character varying(${regla.varchar}) ` +
        `-- ${tabla}.${campo} recibio ${String(valor).length} caracteres: ${JSON.stringify(valor)}`
      )
    }

    if (regla.enum && !ENUMS[regla.enum].includes(valor)) {
      throw new Error(
        `22P02 invalid input value for enum ${regla.enum}: ${JSON.stringify(valor)} ` +
        `-- ${tabla}.${campo}`
      )
    }

    if (regla.positivo && !(Number(valor) > 0)) {
      throw new Error(`23514 new row for relation "${tabla}" violates check constraint on ${campo} (> 0), recibio ${valor}`)
    }

    if (regla.decimal) {
      const [precision, escala] = regla.decimal
      const entero = Math.trunc(Math.abs(Number(valor))).toString().length
      if (entero > precision - escala) {
        throw new Error(`22003 numeric field overflow -- ${tabla}.${campo} excede DECIMAL(${precision},${escala})`)
      }
    }
  }
}

// --- Doble de src/database.js ---

const categorias = [
  { id: 1, nombre: 'Hogar', tipo: 'Gasto', clasificacion: 'Fijo', activo: true },
  { id: 2, nombre: 'Salud', tipo: 'Gasto', clasificacion: 'Fijo', activo: true },
  { id: 3, nombre: 'Familia', tipo: 'Gasto', clasificacion: 'Variable', activo: true },
  { id: 4, nombre: 'Transporte', tipo: 'Gasto', clasificacion: 'Variable', activo: true },
  { id: 5, nombre: 'Suscripciones', tipo: 'Gasto', clasificacion: 'Fijo', activo: true },
  { id: 6, nombre: 'Deudas', tipo: 'Gasto', clasificacion: 'Fijo', activo: true },
  { id: 7, nombre: 'Personal', tipo: 'Gasto', clasificacion: 'Variable', activo: true },
  { id: 8, nombre: 'Ingresos', tipo: 'Ingreso', clasificacion: null, activo: true },
  { id: 9, nombre: 'Ahorro', tipo: 'Ahorro', clasificacion: null, activo: true },
]

const metodosPago = [
  { id: 1, nombre: 'SPEI' }, { id: 2, nombre: 'Efectivo' }, { id: 3, nombre: 'Debito' },
  { id: 4, nombre: 'Vales' }, { id: 5, nombre: 'Credito' },
]

// La quincena se resuelve con la fecha real de hoy (src/quincenas.js), asi que
// registramos todas las del catalogo para que el test no caduque.
const { QUINCENAS } = require(path.join(SRC, 'quincenas'))
const quincenas = QUINCENAS.map((q, i) => ({
  id: i + 1, codigo: q.codigo, fechaInicio: new Date(q.inicio), fechaFin: new Date(q.fin),
}))
const quincenaActual = require(path.join(SRC, 'quincenas')).getCurrentQuincena()
const quincenaActualId = quincenas.find(q => q.codigo === quincenaActual)?.id

let presupuestos = [
  { id: 12, quincenaId: quincenaActualId, descripcion: 'Renta', categoriaId: 1, categoria: categorias[0], clasificacion: 'Fijo', montoPresupuestado: 8000 },
  { id: 7, quincenaId: quincenaActualId, descripcion: 'Súper', categoriaId: 3, categoria: categorias[2], clasificacion: 'Variable', montoPresupuestado: 3000 },
]

const transacciones = []
const whatsappMessages = []
const pendingExpenses = []
let nextTxId = 1, nextMsgId = 1, nextPendingId = 1

const fakeDb = {
  findUserByPhone: async () => null,
  findUserByName: async () => null,
  findCategoria: async (nombre) => nombre
    ? categorias.find(c => c.nombre.toLowerCase() === String(nombre).toLowerCase() && c.activo) || null
    : null,
  findMetodoPago: async (nombre) => nombre
    ? metodosPago.find(m => m.nombre.toLowerCase() === String(nombre).toLowerCase()) || null
    : null,
  findQuincenaByCodigo: async (codigo) => quincenas.find(q => q.codigo === codigo) || null,
  findQuincenaByDate: async () => null,
  findPresupuestosByQuincena: async (quincenaId) => presupuestos
    .filter(p => p.quincenaId === quincenaId)
    .sort((a, b) => b.montoPresupuestado - a.montoPresupuestado),
  messageExists: async (waMessageId) => whatsappMessages.some(m => m.waMessageId === waMessageId),
  saveMessage: async (data) => {
    validarEscritura('whatsapp_messages', data)
    const row = { id: nextMsgId++, ...data }
    whatsappMessages.push(row)
    return row
  },
  saveTransaccion: async (data) => {
    validarEscritura('transacciones', data)
    const row = { id: nextTxId++, ...data }
    transacciones.push(row)
    return row
  },
  upsertPendingExpense: async (data) => {
    validarEscritura('pending_expenses', data)
    const idx = pendingExpenses.findIndex(p => p.phone === data.phone)
    if (idx >= 0) {
      pendingExpenses[idx] = { ...pendingExpenses[idx], ...data, createdAt: new Date() }
      return pendingExpenses[idx]
    }
    const row = { id: nextPendingId++, createdAt: new Date(), ...data }
    pendingExpenses.push(row)
    return row
  },
  findPendingExpenseByPhone: async (phone) => pendingExpenses.find(p => p.phone === phone) || null,
  deletePendingExpense: async (id) => {
    const idx = pendingExpenses.findIndex(p => p.id === id)
    if (idx >= 0) pendingExpenses.splice(idx, 1)
  },
  getTransaccionesByQuincena: async () => [],
  getResumenQuincena: async () => ({ ingresos: 0, gastos: 0, ahorro: 0 }),
}

// --- Doble de src/whatsapp.js ---

const enviados = []
const reacciones = []

const fakeWa = {
  sendWhatsAppMessage: async (to, message) => { enviados.push({ to, message }); return { ok: true, data: {} } },
  extractPhoneNumber: (value) => (value ? String(value).replace(/\D/g, '') : null),
  markAsRead: async () => true,
  react: async (to, messageId, emoji) => { reacciones.push({ to, messageId, emoji }); return true },
  getMediaUrl: async () => null,
  downloadMedia: async () => null,
}

for (const [rel, exports] of [['database.js', fakeDb], ['whatsapp.js', fakeWa]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

// --- Runner ---

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const PHONE = '5215512345678'
let n = 0

async function send(text, from = PHONE) {
  n++
  const id = `wamid.TEST${n}`
  await fetch(`http://localhost:${process.env.PORT}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: 'Rene' } }],
        messages: [{ id, from, type: 'text', text: { body: text } }],
      } }] }],
    }),
  }).then(r => r.text())
  await sleep(150) // el handler responde 200 antes de terminar de procesar
  return id
}

// Falla el test si el bot respondio con el mensaje generico de error: eso
// significa que una escritura violo el esquema (justo el bug que se fue a prod).
function sinErrores(etiqueta) {
  const err = enviados.find(m => m.message.includes('Error al procesar tu mensaje'))
  check(`${etiqueta}: el bot no respondio con error generico`, !err, err && err.message)
}

async function main() {
  require(path.join(SRC, 'index.js'))
  await sleep(300)

  console.log(`\n=== A: atajo "930, 3B" (codigo sin categoria) pregunta la linea ===`)
  await send('930, 3B')
  sinErrores('A')
  check('no se creo transaccion todavia', transacciones.length === 0)
  check('quedo una pregunta pendiente', !!pendingExpenses.find(p => p.phone === PHONE))
  const preguntaA = enviados.at(-1)
  check('mando la lista de lineas de presupuesto', preguntaA?.message.includes('línea de presupuesto'), preguntaA?.message)
  check('lista Renta', preguntaA?.message.includes('1) Renta'))
  check('lista Súper', preguntaA?.message.includes('2) Súper'))
  check('ofrece Otro/Personal', preguntaA?.message.includes('0) Otro / Personal'))

  console.log(`\n=== B: responder "2" registra ligado a esa linea ===`)
  await send('2')
  sinErrores('B')
  check('ya no hay pregunta pendiente', !pendingExpenses.find(p => p.phone === PHONE))
  const txB = transacciones.at(-1)
  check('categoriaId = Familia (3)', txB?.categoriaId === 3, txB?.categoriaId)
  check('presupuestoId = Súper (7)', txB?.presupuestoId === 7, txB?.presupuestoId)
  check('monto = 930', Number(txB?.monto) === 930, txB?.monto)
  check('confirmacion menciona la linea', enviados.at(-1)?.message.includes('Súper'))

  console.log(`\n=== C: respuesta invalida "99" reintenta sin perder la pregunta ===`)
  await send('390, 3B')
  const antesC = transacciones.length
  await send('99')
  sinErrores('C')
  check('sigue pendiente', !!pendingExpenses.find(p => p.phone === PHONE))
  check('no creo transaccion', transacciones.length === antesC)
  check('reenvio la lista con aviso', enviados.at(-1)?.message.includes('No reconozco esa opción'))

  console.log(`\n=== D: responder "0" cae en Personal sin linea ===`)
  await send('0')
  sinErrores('D')
  const txD = transacciones.at(-1)
  check('categoriaId = Personal (7)', txD?.categoriaId === 7, txD?.categoriaId)
  check('presupuestoId nulo', txD?.presupuestoId == null, txD?.presupuestoId)

  console.log(`\n=== E: "150, super" (matchea keyword) registra directo, sin preguntar ===`)
  const antesE = transacciones.length
  await send('150, super')
  sinErrores('E')
  check('no quedo pregunta pendiente', !pendingExpenses.find(p => p.phone === PHONE))
  check('registro de inmediato', transacciones.length === antesE + 1)
  check('categoriaId = Familia (3)', transacciones.at(-1)?.categoriaId === 3)

  console.log(`\n=== F: mensaje no relacionado abandona la pregunta pendiente ===`)
  await send('930, 3B')
  check('hay pregunta pendiente', !!pendingExpenses.find(p => p.phone === PHONE))
  await send('hola como estas')
  sinErrores('F')
  check('la pregunta vieja se abandono', !pendingExpenses.find(p => p.phone === PHONE))
  await send('1')
  check('un "1" tardio no se ligo a la pregunta abandonada', transacciones.at(-1)?.presupuestoId == null)

  console.log(`\n=== G: quincena sin lineas de presupuesto cae a Personal con nota ===`)
  presupuestos = []
  const antesG = transacciones.length
  await send('770, 9Z')
  sinErrores('G')
  check('no quedo pregunta pendiente', !pendingExpenses.find(p => p.phone === PHONE))
  check('registro de inmediato', transacciones.length === antesG + 1)
  check('categoriaId = Personal (7)', transacciones.at(-1)?.categoriaId === 7)
  check('la confirmacion explica por que', enviados.at(-1)?.message.includes('Sin líneas de presupuesto'))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
