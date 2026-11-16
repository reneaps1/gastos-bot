// Acciones de configuracion de Milo (src/miloAccionesConfig.js): cuentas,
// categorias, referencias de quincena, personas y formas de pago. Sin red ni
// Postgres.
//
// POR QUE EXISTE: Rene le pidio a Milo "crea una cuenta" (2026-11-16) y no
// pudo. Que se fija:
//   1. Proponer no escribe; confirmar va por la misma ruta que la pantalla de
//      Configuracion, con el body que esa ruta espera.
//   2. Nombres repetidos se frenan antes (la ruta contesta 409).
//   3. Una cuenta usada en cortes o creditos no se borra: se ofrece desactivar.
//   4. El TIPO de una categoria no se cambia desde el chat.
//   5. Referencias de quincena: solo esos campos viajan (nada de fechas).
//   6. Si el registro cambio desde la propuesta no se aplica; un reintento de
//      un alta que ya se guardo no la duplica.

process.env.TZ = 'America/Mexico_City'
delete process.env.ANTHROPIC_API_KEY
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

let tablas
function reiniciar() {
  tablas = {
    cuenta: [
      { id: 1, nombre: 'BBVA', tipo: 'Debito', activo: true, orden: 1 },
      { id: 2, nombre: 'Banamex', tipo: 'Debito', activo: true, orden: 2 },
      { id: 9, nombre: 'Cuenta vieja', tipo: 'Otro', activo: false, orden: 9 },
    ],
    categoria: [
      { id: 3, nombre: 'Familia', tipo: 'Gasto', clasificacion: 'Variable', ejemplos: null, activo: true, cuentaParaLimite: true },
    ],
    user: [{ id: 1, nombre: 'Rene', phoneWhatsapp: null, activo: true }],
    metodoPago: [{ id: 1, nombre: 'Efectivo' }],
    quincena: [{ id: 39, codigo: 'Q39', ingresoReferencia: 23000, limiteGastoReferencia: null }],
  }
}
reiniciar()
let usoCuenta = { creditos: 0, cortes: 0 }

const modelo = nombre => ({
  findUnique: async ({ where }) => tablas[nombre].find(x => x.id === where.id) || null,
  findMany: async ({ orderBy, take } = {}) => {
    let lista = [...tablas[nombre]]
    if (orderBy?.orden === 'desc') lista.sort((a, b) => b.orden - a.orden)
    return take ? lista.slice(0, take) : lista
  },
  findFirst: async ({ where }) => tablas[nombre].find(x => x.nombre === where.nombre) || null,
})

const acciones = []
let nextAccion = 1
const fakePrisma = {
  cuenta: modelo('cuenta'),
  categoria: modelo('categoria'),
  user: modelo('user'),
  metodoPago: modelo('metodoPago'),
  quincena: modelo('quincena'),
  credito: { count: async () => usoCuenta.creditos },
  liquidezSnapshotCuenta: { count: async () => usoCuenta.cortes },
  miloAccion: {
    create: async ({ data }) => { const f = { id: nextAccion++, estado: 'pendiente', resultado: null, createdAt: new Date(), ...data }; acciones.push(f); return f },
    findUnique: async ({ where }) => acciones.find(a => a.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      const filas = acciones.filter(a => a.id === where.id && (!where.chatId || a.chatId === where.chatId) &&
        (where.estado?.in ? where.estado.in.includes(a.estado) : typeof where.estado === 'string' ? a.estado === where.estado : true) &&
        (!where.expiraEn?.gt || a.expiraEn > where.expiraEn.gt))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
    update: async ({ where, data }) => Object.assign(acciones.find(a => a.id === where.id), data),
  },
}

const llamadas = []
let alGuardar = null
const fakeDashboardApi = {
  isEnabled: () => true,
  DashboardApiError: Error,
  llamar: async (metodo, ruta, opts = {}) => {
    llamadas.push({ metodo, ruta, ...opts })
    if (alGuardar) alGuardar(metodo, ruta, opts)
    return { id: 50 }
  },
}
const fakeMiloTools = { resolvePeriod: async p => (['actual', undefined, 'q39'].includes(p && p.toLowerCase ? p.toLowerCase() : p) ? tablas.quincena[0] : null) }
for (const [rel, exports] of [['lib/prisma.js', fakePrisma], ['dashboardApi.js', fakeDashboardApi], ['miloTools.js', fakeMiloTools]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const miloAcciones = require(path.join(SRC, 'miloAcciones.js'))
const CTX = { chatId: 'web:abcdef12', userId: 1, solicitante: 'Rene' }
const confirmar = id => miloAcciones.confirmar({ accionId: id, chatId: CTX.chatId, actor: 'Rene', canal: 'web' })
const ultima = () => llamadas.at(-1)

async function main() {
  console.log('=== 1: cuentas ===')
  const c1 = await miloAcciones.proponer('cuenta.crear', { name: 'Nu', type: 'débito' }, CTX)
  check('crear cuenta: propone sin escribir', c1.ok && llamadas.length === 0 && /Crear cuenta: Nu/.test(c1.resumen) && /Debito/.test(c1.resumen), c1.error || c1.resumen)
  await confirmar(c1.accionId)
  check('POST /api/cuentas con nombre, tipo y orden al final', ultima().metodo === 'POST' && ultima().ruta === '/api/cuentas' &&
    ultima().body.nombre === 'Nu' && ultima().body.tipo === 'Debito' && ultima().body.orden === 10, JSON.stringify(ultima().body))
  const dup = await miloAcciones.proponer('cuenta.crear', { name: 'bbva' }, CTX)
  check('nombre repetido (sin importar mayusculas) -> error', !dup.ok && /Ya existe/.test(dup.error))
  const malTipo = await miloAcciones.proponer('cuenta.crear', { name: 'X', type: 'cripto' }, CTX)
  check('tipo invalido -> error con las opciones', !malTipo.ok && /Debito, Credito/.test(malTipo.error))

  const e1 = await miloAcciones.proponer('cuenta.editar', { name: 'banamex', active: false }, CTX)
  check('desactivar: el resumen explica el efecto', e1.ok && /activa → inactiva/.test(e1.resumen) && /cortes nuevos/.test(e1.resumen), e1.error || e1.resumen)
  await confirmar(e1.accionId)
  check('PUT /api/cuentas/2 con activo=false', ultima().metodo === 'PUT' && ultima().ruta === '/api/cuentas/2' && ultima().body.activo === false, JSON.stringify(ultima()))
  const e2 = await miloAcciones.proponer('cuenta.editar', { name: 'cuenta vieja', active: 'activar' }, CTX)
  check('se puede reactivar una cuenta inactiva', e2.ok && /inactiva → activa/.test(e2.resumen), e2.error)
  const e3 = await miloAcciones.proponer('cuenta.editar', { id: 1, newName: 'BBVA Nómina' }, CTX)
  tablas.cuenta[0].nombre = 'BBVA Azul'
  const r3 = await confirmar(e3.accionId)
  check('si la cuenta cambio desde la propuesta, no se aplica', !r3.ok && /cambió/.test(r3.texto), r3.texto)
  reiniciar()

  usoCuenta = { creditos: 0, cortes: 4 }
  const b1 = await miloAcciones.proponer('cuenta.borrar', { name: 'BBVA' }, CTX)
  check('cuenta con cortes: no se borra, se ofrece desactivar', !b1.ok && /4 corte/.test(b1.error) && /active=false/.test(b1.error), b1.error)
  usoCuenta = { creditos: 0, cortes: 0 }
  const b2 = await miloAcciones.proponer('cuenta.borrar', { name: 'cuenta vieja' }, CTX)
  await confirmar(b2.accionId)
  check('sin uso: DELETE /api/cuentas/9', ultima().metodo === 'DELETE' && ultima().ruta === '/api/cuentas/9')

  console.log('\n=== 2: categorias ===')
  const k1 = await miloAcciones.proponer('categoria.crear', { name: 'Mascotas', type: 'gasto', classification: 'variable', examples: 'croquetas, veterinario' }, CTX)
  await confirmar(k1.accionId)
  check('POST /api/categorias con tipo y clasificacion normalizados', ultima().ruta === '/api/categorias' && ultima().body.tipo === 'Gasto' && ultima().body.clasificacion === 'Variable' && /croquetas/.test(ultima().body.ejemplos), JSON.stringify(ultima().body))
  const k2 = await miloAcciones.proponer('categoria.crear', { name: 'Otra' }, CTX)
  check('sin tipo -> error', !k2.ok && /type es requerido/.test(k2.error))
  const k3 = await miloAcciones.proponer('categoria.editar', { name: 'familia', type: 'Ingreso' }, CTX)
  check('cambiar el TIPO de una categoria: no desde el chat', !k3.ok && /no se cambia desde aquí/.test(k3.error))
  const k4 = await miloAcciones.proponer('categoria.editar', { name: 'familia', countsForLimit: false, classification: 'fijo' }, CTX)
  await confirmar(k4.accionId)
  check('PUT /api/categorias/3 solo con lo que cambia', ultima().ruta === '/api/categorias/3' && ultima().body.cuentaParaLimite === false && ultima().body.clasificacion === 'Fijo' && !('tipo' in ultima().body), JSON.stringify(ultima().body))

  console.log('\n=== 3: referencias de quincena ===')
  const q1 = await miloAcciones.proponer('quincena.referencias', { spendingLimit: '18 mil', income: 'ninguna' }, CTX)
  check('el resumen dice antes y despues', q1.ok && /Límite de gasto: sin referencia → \$18,000\.00/.test(q1.resumen) && /Ingreso de referencia: \$23,000\.00 → sin referencia/.test(q1.resumen), q1.error || q1.resumen)
  await confirmar(q1.accionId)
  check('PUT /api/quincenas/39 SOLO con las referencias (sin fechas ni codigo)', ultima().ruta === '/api/quincenas/39' &&
    JSON.stringify(Object.keys(ultima().body).sort()) === JSON.stringify(['ingresoReferencia', 'limiteGastoReferencia']) && ultima().body.ingresoReferencia === null && ultima().body.limiteGastoReferencia === 18000, JSON.stringify(ultima().body))
  const q2 = await miloAcciones.proponer('quincena.referencias', { income: 23000 }, CTX)
  check('sin cambio real -> lo dice', !q2.ok && /nada que cambiar/.test(q2.error))

  console.log('\n=== 4: personas y formas de pago ===')
  const u1 = await miloAcciones.proponer('usuario.crear', { name: 'Mariana', phone: '+52 1 55 1234 5678' }, CTX)
  await confirmar(u1.accionId)
  check('POST /api/users con el telefono limpio', ultima().ruta === '/api/users' && ultima().body.phoneWhatsapp === '+5215512345678', JSON.stringify(ultima().body))
  check('el resumen aclara que no es un acceso al dashboard', /no es un acceso/.test(u1.resumen))
  const m1 = await miloAcciones.proponer('metodo_pago.crear', { name: 'Tarjeta Nu' }, CTX)
  await confirmar(m1.accionId)
  check('POST /api/metodos-pago', ultima().ruta === '/api/metodos-pago' && ultima().body.nombre === 'Tarjeta Nu')

  console.log('\n=== 5: un reintento no duplica un alta ===')
  const c2 = await miloAcciones.proponer('cuenta.crear', { name: 'Ualá', type: 'Debito' }, CTX)
  alGuardar = (metodo, ruta, opts) => {
    if (ruta === '/api/cuentas') {
      tablas.cuenta.push({ id: 77, nombre: opts.body.nombre, tipo: opts.body.tipo, activo: true, orden: opts.body.orden })
      alGuardar = null
      throw new Error('El dashboard no contestó en 90 s.')
    }
  }
  const f1 = await confirmar(c2.accionId)
  const antes = llamadas.length
  const f2 = await confirmar(c2.accionId)
  check('el reintento detecta que ya se creo (#77) y no llama otra vez', !f1.ok && f2.ok && /#77/.test(f2.texto) && llamadas.length === antes, `${f1.texto} | ${f2.texto}`)

  console.log('\n=== 6: el agente las ve ===')
  delete require.cache[require.resolve(path.join(SRC, 'miloTools.js'))]
  const { getToolDefinitions } = require(path.join(SRC, 'miloTools.js'))
  const nombres = getToolDefinitions({ acciones: true }).map(d => d.name)
  const esperadas = ['proponer_crear_cuenta', 'proponer_editar_cuenta', 'proponer_borrar_cuenta', 'proponer_crear_categoria', 'proponer_editar_categoria', 'proponer_referencias_quincena', 'proponer_crear_usuario', 'proponer_editar_usuario', 'proponer_crear_forma_pago']
  check('las 9 herramientas de configuracion existen con acciones', esperadas.every(n => nombres.includes(n)), esperadas.filter(n => !nombres.includes(n)).join(','))
  check('WhatsApp (sin acciones) no las ve', !getToolDefinitions({}).some(d => d.name === 'proponer_crear_cuenta'))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
}

main().catch(error => {
  console.error('El harness truono:', error)
  process.exit(1)
})
