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
// Sin Gemini, la categoria sale solo del keyword matching de src/parser.js.

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
}

// Imita el rechazo de Postgres. Los mensajes replican los codigos reales
// (22001 value too long, 22P02 invalid enum, 23514 check violation).
function validarEscritura(tabla, data) {
  const reglas = COLUMNAS[tabla]
  if (!reglas) return
  for (const [campo, regla] of Object.entries(reglas)) {
    const valor = data[campo]

    if (valor === undefined || valor === null) {
      if (regla.notNull && campo in data) {
        throw new Error(`23502 null value in column "${campo}" of relation "${tabla}" violates not-null constraint`)
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
        `22P02 invalid input value for enum ${regla.enum}: ${JSON.stringify(valor)} -- ${tabla}.${campo}`
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

const transacciones = []
const whatsappMessages = []
let nextTxId = 1, nextMsgId = 1

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

function ultimaConfirmacion() {
  return enviados.at(-1)?.message || ''
}

async function main() {
  require(path.join(SRC, 'index.js'))
  await sleep(300)

  // El bot registra y guarda; la linea de presupuesto se asigna a mano desde
  // el dashboard. El bot nunca debe preguntar nada ni fijar presupuestoId.

  console.log('\n=== A: atajo "930, 3B" (codigo sin categoria) registra directo en Personal ===')
  await send('930, 3B')
  sinErrores('A')
  check('creo la transaccion de inmediato', transacciones.length === 1, transacciones.length)
  const txA = transacciones.at(-1)
  check('categoriaId = Personal (7)', txA?.categoriaId === 7, txA?.categoriaId)
  check('monto = 930', Number(txA?.monto) === 930, txA?.monto)
  check('descripcion = 3B', txA?.descripcion === '3B', txA?.descripcion)
  check('confirmo el registro', ultimaConfirmacion().includes('Gasto registrado'), ultimaConfirmacion())
  check('NO pregunto por linea de presupuesto', !ultimaConfirmacion().includes('línea de presupuesto'), ultimaConfirmacion())

  console.log('\n=== B: atajo "150, super" (codigo que matchea keyword) usa la categoria ===')
  await send('150, super')
  sinErrores('B')
  const txB = transacciones.at(-1)
  check('categoriaId = Familia (3)', txB?.categoriaId === 3, txB?.categoriaId)
  check('monto = 150', Number(txB?.monto) === 150, txB?.monto)

  console.log('\n=== C: lenguaje natural "gaste 150 en uber" ===')
  await send('gaste 150 en uber')
  sinErrores('C')
  const txC = transacciones.at(-1)
  check('categoriaId = Transporte (4)', txC?.categoriaId === 4, txC?.categoriaId)
  check('monto = 150', Number(txC?.monto) === 150, txC?.monto)

  console.log('\n=== D: mensaje sin numero cae en el fallback, sin registrar nada ===')
  const antesD = transacciones.length
  await send('hola como estas')
  sinErrores('D')
  check('no creo transaccion', transacciones.length === antesD, transacciones.length)
  check('respondio que no entendio', ultimaConfirmacion().includes('No entendí'), ultimaConfirmacion())

  console.log('\n=== E: el bot nunca asigna linea de presupuesto (eso es manual) ===')
  const conPresupuesto = transacciones.filter(t => t.presupuestoId != null)
  check('ninguna transaccion trae presupuestoId', conPresupuesto.length === 0, JSON.stringify(conPresupuesto))
  check('se registraron 3 gastos en total', transacciones.length === 3, transacciones.length)

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
