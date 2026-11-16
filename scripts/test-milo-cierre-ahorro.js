// Cierre de quincena (Fase B2) y ahorro / deudas / creditos (Fase B3) por
// chat. Sin red ni Postgres.
//
// Que se fija:
//   B2. get_closing_status ve las mismas lineas pendientes que el asistente de
//       cierre del dashboard; cada motivo solo admite las opciones que el
//       asistente ofrece; todo va por /resolver; una quincena que no ha
//       terminado no se cierra; si la linea cambio no se aplica; un reintento
//       no repite.
//   B3. Aportes y retiros llevan direccion y apartado (y solo en Ahorro);
//       deudas se liquidan sin borrarse; creditos se dan de alta con su tipo;
//       una compra a meses muestra los mismos pagos que creara la ruta y se
//       frena si algun pago cae en una fecha sin quincena.

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

const { fechaMexico } = require(path.join(SRC, 'financeUtils'))
const HOY = fechaMexico()
const dia = n => { const d = new Date(`${HOY}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d }

// Q38 ya termino (sin cerrar); Q39 es la actual; Q40 la siguiente. No hay
// quincena despues de Q40: un pago que caiga mas alla no tiene donde ir.
const Q38 = { id: 38, codigo: 'Q38', fechaInicio: dia(-30), fechaFin: dia(-16), fechaCierre: null }
const Q39 = { id: 39, codigo: 'Q39', fechaInicio: dia(-15), fechaFin: dia(10), fechaCierre: null }
const Q40 = { id: 40, codigo: 'Q40', fechaInicio: dia(11), fechaFin: dia(70), fechaCierre: null }
const QUINCENAS = [Q38, Q39, Q40]

const CATS = [
  { id: 1, nombre: 'Hogar', tipo: 'Gasto', activo: true },
  { id: 3, nombre: 'Familia', tipo: 'Gasto', activo: true },
  { id: 8, nombre: 'Ingresos', tipo: 'Ingreso', activo: true },
  { id: 9, nombre: 'Ahorro', tipo: 'Ahorro', activo: true },
]

let lineas
function reiniciarLineas() {
  lineas = [
    { id: 20, quincenaId: 38, descripcion: 'Renta', categoriaId: 1, categoria: CATS[0], estadoLinea: 'Abierta', montoEfectivo: 10500, real: 0, pendiente: 0 },
    { id: 21, quincenaId: 38, descripcion: 'Luz', categoriaId: 1, categoria: CATS[0], estadoLinea: 'Abierta', montoEfectivo: 500, real: 450, pendiente: 450 },
    { id: 22, quincenaId: 38, descripcion: 'Super', categoriaId: 3, categoria: CATS[1], estadoLinea: 'Abierta', montoEfectivo: 3000, real: 3400, pendiente: 0 },
    { id: 23, quincenaId: 38, descripcion: 'Salario', categoriaId: 8, categoria: CATS[2], estadoLinea: 'Abierta', montoEfectivo: 20000, real: 0, pendiente: 0 },
    { id: 24, quincenaId: 39, descripcion: 'Gas', categoriaId: 1, categoria: CATS[0], estadoLinea: 'Abierta', montoEfectivo: 400, real: 0, pendiente: 0 },
  ]
}
reiniciarLineas()

// La matematica de real/pendiente ya esta probada en test-milo-finanzas: aqui
// se fija lo que el cierre hace con ella.
const finanzas = require(path.join(SRC, 'lib', 'finanzas-quincena'))
finanzas.cargarLineasDeQuincena = async (_prisma, quincenaId, where = {}) =>
  lineas.filter(l => l.quincenaId === quincenaId && (where.id == null || l.id === where.id)).map(l => ({ ...l }))

const tablas = {
  apartado: [{ id: 1, nombre: 'Viaje', metaMonto: 20000, activo: true }],
  deuda: [{ id: 1, acreedor: 'Tía Lupe', deudaOriginal: 5000, abonoMensual: 500, activo: true, notas: null }],
  credito: [
    { id: 1, nombre: 'Tarjeta BBVA', acreedor: 'BBVA', tipoCredito: 'Tarjeta', diaPago: 5, activo: true },
    { id: 2, nombre: 'Préstamo papá', acreedor: 'Papá', tipoCredito: 'Informal', diaPago: null, activo: true },
  ],
  cuenta: [{ id: 1, nombre: 'BBVA', activo: true }],
}
const modelo = n => ({
  findUnique: async ({ where }) => tablas[n].find(x => x.id === where.id) || null,
  findMany: async () => [...tablas[n]],
  findFirst: async ({ where }) => tablas[n].find(x => Object.entries(where).every(([k, v]) => typeof v !== 'object' || v === null ? x[k] === v : true)) || null,
})

const acciones = []
let nextAccion = 1
const fakePrisma = {
  quincena: {
    findMany: async ({ where }) => QUINCENAS.filter(q => q.fechaFin < where.fechaFin.lt && q.fechaCierre === null),
    findFirst: async ({ where }) => {
      const d = where.fechaInicio.lte
      return QUINCENAS.find(q => q.fechaInicio <= d && q.fechaFin >= d) || null
    },
  },
  presupuesto: {
    findUnique: async ({ where }) => {
      const l = lineas.find(x => x.id === where.id)
      return l ? { ...l, quincena: QUINCENAS.find(q => q.id === l.quincenaId) } : null
    },
  },
  categoria: { findMany: async () => CATS },
  metodoPago: { findMany: async () => [] },
  user: { findMany: async () => [] },
  transaccion: { findFirst: async () => null },
  apartado: modelo('apartado'),
  deuda: modelo('deuda'),
  credito: modelo('credito'),
  cuenta: modelo('cuenta'),
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
let alLlamar = null
const fakeDashboardApi = {
  isEnabled: () => true,
  DashboardApiError: Error,
  llamar: async (metodo, ruta, opts = {}) => {
    llamadas.push({ metodo, ruta, ...opts })
    if (alLlamar) alLlamar(metodo, ruta, opts)
    return { id: 70 }
  },
}
const fakeMiloTools = { resolvePeriod: async p => (String(p || 'actual').toLowerCase() === 'actual' ? Q39 : QUINCENAS.find(q => q.codigo.toLowerCase() === String(p).toLowerCase()) || null) }
for (const [rel, exports] of [['lib/prisma.js', fakePrisma], ['dashboardApi.js', fakeDashboardApi], ['miloTools.js', fakeMiloTools]]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const miloAcciones = require(path.join(SRC, 'miloAcciones.js'))
const { pendientesDeCierre } = require(path.join(SRC, 'miloAccionesCierre.js'))
const CTX = { chatId: '8946880241', userId: 1, solicitante: 'Rene' }
const proponer = (tipo, args) => miloAcciones.proponer(tipo, args, CTX)
const confirmar = id => miloAcciones.confirmar({ accionId: id, chatId: CTX.chatId, actor: 'Rene' })
const ultima = () => llamadas.at(-1)

async function main() {
  console.log('=== B2.1: que esta pendiente de cierre ===')
  const grupos = await pendientesDeCierre(fakePrisma)
  check('solo Q38 (ya termino); Q39 sigue en curso', grupos.length === 1 && grupos[0].period === 'Q38', JSON.stringify(grupos.map(g => g.period)))
  const porNombre = Object.fromEntries((grupos[0]?.lines || []).map(l => [l.line, l]))
  check('Renta sin registrar: registrar, mover o cancelar', porNombre.Renta?.reason === 'sin registrar' && porNombre.Renta.options.join() === 'registrar_pagado,mover,cancelar')
  check('Luz pendiente de pago: marcar pagado o mover', porNombre.Luz?.reason === 'pendiente de pago' && porNombre.Luz.options.join() === 'pagar_existente,mover')
  check('Super excedido por $400: solo aceptar la variacion', porNombre.Super?.reason === 'excedido' && porNombre.Super.amount === 400 && porNombre.Super.options.join() === 'absorber')
  check('las de Ingreso no entran al cierre', !porNombre.Salario)

  console.log('\n=== B2.2: resolver ===')
  const r1 = await proponer('cierre.resolver', { line: 'renta', period: 'Q38', action: 'registrar como pagado' })
  check('registrar_pagado: el resumen dice monto y fecha', r1.ok && /\$10,500\.00/.test(r1.resumen) && /cierra sola/.test(r1.resumen), r1.error || r1.resumen)
  await confirmar(r1.accionId)
  check('POST /resolver con accion, fecha (fin de Q38) y monto', ultima().ruta === '/api/presupuestos/20/resolver' && ultima().body.accion === 'registrar_pagado' &&
    ultima().body.monto === 10500 && ultima().body.fecha === Q38.fechaFin.toISOString().slice(0, 10), JSON.stringify(ultima().body))
  const r2 = await proponer('cierre.resolver', { lineId: 20, action: 'pagar_existente' })
  check('una opcion que no aplica al motivo -> error con las validas', !r2.ok && /registrar_pagado, mover, cancelar/.test(r2.error), r2.error)
  const r3 = await proponer('cierre.resolver', { lineId: 21, action: 'mover' })
  await confirmar(r3.accionId)
  check('mover: a la quincena actual (Q39)', ultima().body.accion === 'mover' && ultima().body.targetQuincenaId === 39 && /Q39/.test(r3.resumen))
  const r4 = await proponer('cierre.resolver', { lineId: 22, action: 'mover' })
  check('excedido + mover -> error que sugiere el traspaso', !r4.ok && /proponer_traspaso/.test(r4.error), r4.error)
  const r5 = await proponer('cierre.resolver', { lineId: 22, action: 'aceptar', note: 'compras de fin de mes' })
  await confirmar(r5.accionId)
  check('absorber con nota', ultima().body.accion === 'absorber' && ultima().body.nota === 'compras de fin de mes')
  const r6 = await proponer('cierre.resolver', { lineId: 24, action: 'registrar_pagado' })
  check('una quincena que no ha terminado no se cierra', !r6.ok && /todavía no termina/.test(r6.error), r6.error)

  const r7 = await proponer('cierre.resolver', { lineId: 21, action: 'pagar_existente' })
  lineas.find(l => l.id === 21).pendiente = 0
  const c7 = await confirmar(r7.accionId)
  check('si la linea cambio (ya no esta pendiente de pago), no se aplica', !c7.ok && /cambió/.test(c7.texto), c7.texto)
  reiniciarLineas()

  const r8 = await proponer('cierre.resolver', { lineId: 20, action: 'cancelar' })
  alLlamar = (metodo, ruta) => {
    if (ruta.endsWith('/resolver')) {
      lineas.find(l => l.id === 20).estadoLinea = 'Cancelada'
      alLlamar = null
      throw new Error('El dashboard no contestó en 90 s.')
    }
  }
  const f1 = await confirmar(r8.accionId)
  const antes = llamadas.length
  const f2 = await confirmar(r8.accionId)
  check('reintento de un cierre que SI se aplico: no repite', !f1.ok && f2.ok && /ya estaba resuelta/.test(f2.texto) && llamadas.length === antes, `${f1.texto} | ${f2.texto}`)
  reiniciarLineas()

  console.log('\n=== B3.1: ahorro ===')
  const a1 = await proponer('apartado.crear', { name: 'Fondo de emergencia', goal: '50 mil' })
  await confirmar(a1.accionId)
  check('crear apartado con meta', ultima().ruta === '/api/apartados' && ultima().body.nombre === 'Fondo de emergencia' && ultima().body.metaMonto === 50000, JSON.stringify(ultima().body))
  const a2 = await proponer('apartado.editar', { name: 'viaje', active: false })
  await confirmar(a2.accionId)
  check('desactivar apartado: PUT activo=false', ultima().ruta === '/api/apartados/1' && ultima().body.activo === false)
  const ap = await proponer('transaccion.registrar', { amount: 500, description: 'para el viaje', category: 'Ahorro', savingsBucket: 'viaje' })
  check('aporte: el resumen lo dice y nombra el apartado', ap.ok && /aporte a ahorro/.test(ap.resumen) && /Apartado: Viaje/.test(ap.resumen), ap.error || ap.resumen)
  await confirmar(ap.accionId)
  check('POST transacciones con direccion Aporte y apartadoId', ultima().ruta === '/api/transacciones' && ultima().body.direccion === 'Aporte' && ultima().body.apartadoId === 1, JSON.stringify(ultima().body))
  const re = await proponer('transaccion.registrar', { amount: 300, description: 'saqué', category: 'Ahorro', direction: 'retiro' })
  await confirmar(re.accionId)
  check('retiro: direccion Retiro', ultima().body.direccion === 'Retiro' && /retiro de ahorro/.test(re.resumen))
  const mal = await proponer('transaccion.registrar', { amount: 300, description: 'super', category: 'Familia', savingsBucket: 'viaje' })
  check('apartado en un gasto -> error', !mal.ok && /solo para la categoría de Ahorro/.test(mal.error))

  console.log('\n=== B3.2: deudas ===')
  const d1 = await proponer('deuda.crear', { creditor: 'Mi hermano', amount: 8000, monthlyPayment: 1000 })
  await confirmar(d1.accionId)
  check('crear deuda', ultima().ruta === '/api/deudas' && ultima().body.acreedor === 'Mi hermano' && ultima().body.deudaOriginal === 8000 && ultima().body.abonoMensual === 1000)
  const d2 = await proponer('deuda.editar', { name: 'tia lupe', active: 'liquidada' })
  check('liquidar: se aclara que no se borra', d2.ok && /no se borra/.test(d2.resumen), d2.error)
  await confirmar(d2.accionId)
  check('liquidar = PUT activo=false (nunca DELETE)', ultima().metodo === 'PUT' && ultima().ruta === '/api/deudas/1' && ultima().body.activo === false)

  console.log('\n=== B3.3: creditos ===')
  const k1 = await proponer('credito.crear', { name: 'Tarjeta Nu', creditor: 'Nu', type: 'tarjeta de credito', limit: 30000, cutDay: 20, payDay: 10, payAccount: 'bbva' })
  await confirmar(k1.accionId)
  check('alta de credito con tipo, dias y cuenta de pago', ultima().ruta === '/api/creditos' && ultima().body.tipoCredito === 'Tarjeta' && ultima().body.diaPago === 10 && ultima().body.cuentaPagoId === 1 && ultima().body.limiteCredito === 30000, JSON.stringify(ultima().body))
  const k2 = await proponer('credito.editar', { name: 'prestamo papa', active: false })
  await confirmar(k2.accionId)
  check('archivar credito: PUT activo=false', ultima().ruta === '/api/creditos/2' && ultima().body.activo === false)

  const compraHoy = HOY
  const k3 = await proponer('credito.compra', { credit: 'tarjeta bbva', amount: 1000, description: 'refri', category: 'Hogar', installments: 1, date: compraHoy })
  check('compra a 1 pago con dia de pago: primer pago el 5 del mes siguiente', k3.ok && /5-/.test(k3.resumen), k3.error || k3.resumen)
  if (k3.ok) {
    await confirmar(k3.accionId)
    check('POST transacciones con creditoId, totalPagos y fechaPagoProgramada, Pendiente', ultima().ruta === '/api/transacciones' && ultima().body.creditoId === 1 && ultima().body.totalPagos === 1 && ultima().body.estatus === 'Pendiente' && /-05$/.test(ultima().body.fechaPagoProgramada), JSON.stringify(ultima().body))
  }
  const k4 = await proponer('credito.compra', { credit: 'tarjeta bbva', amount: 1000, description: 'tele', category: 'Hogar', installments: 6 })
  check('a 6 meses: un pago cae sin quincena -> no propone y lo dice', !k4.ok && /sin quincena/.test(k4.error), k4.error)
  const k45 = await proponer('credito.compra', { credit: 'tarjeta bbva', amount: 1000.01, description: 'lavadora', category: 'Hogar', installments: 2 })
  check('a 2 meses: el residuo va al ultimo pago, como en la ruta', k45.ok && /— \$500\.00/.test(k45.resumen) && /— \$500\.01/.test(k45.resumen), k45.error || k45.resumen)
  tablas.credito[1].activo = false
  const k5 = await proponer('credito.compra', { credit: 'préstamo papá', amount: 300, description: 'x', category: 'Hogar' })
  check('credito archivado -> no', !k5.ok && /archivado/.test(k5.error), k5.error)
  tablas.credito[1].activo = true
  const k6 = await proponer('credito.compra', { credit: 'préstamo papá', amount: 300, description: 'x', category: 'Hogar' })
  check('sin dia de pago: pide la fecha del primer pago', !k6.ok && /firstPaymentDate/.test(k6.error), k6.error)

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
}

main().catch(error => {
  console.error('El harness truono:', error)
  process.exit(1)
})
