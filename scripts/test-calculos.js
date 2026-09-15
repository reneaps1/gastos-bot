// Pruebas de las reglas de calculo que sostienen las cifras del sistema.
//
// Cubren los defectos que encontro la auditoria de integridad (ver
// scripts/audit-datos.md). No necesitan Postgres ni red: cada caso arma sus
// datos y llama a la funcion real, con un doble de Prisma que se comporta como
// el motor de verdad (groupBy agrupa, aggregate suma).
//
// Que se prueba y por que:
//   1. El `real` de una linea netea los Retiros de ahorro. Sumar en bruto
//      inflaba el real justo por el doble de cada retiro, porque `monto`
//      siempre se guarda positivo y el signo vive en `direccion`.
//   2. El parser distingue "meti al ahorro" de "saque del ahorro". Antes todo
//      se guardaba como Aporte, asi que cada retiro subia el saldo.
//   3. El tipo de una linea de presupuesto lo manda la categoria, no la copia
//      que vive en la fila.

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

// --- Doble de Prisma que imita al motor real -------------------------------
// Ojo: groupBy AGRUPA de verdad. Un doble que devuelva [] siempre deja pasar
// exactamente el bug que estas pruebas vigilan.

let transacciones = []
let presupuestos = []
let quincenaActiva = null

const prismaDoble = {
  transaccion: {
    groupBy: async ({ by, where } = {}) => {
      const filtradas = transacciones.filter(t =>
        where?.presupuestoId === undefined || t.presupuestoId === where.presupuestoId)
      const grupos = new Map()
      for (const t of filtradas) {
        const clave = by.map(campo => t[campo] ?? null)
        const k = JSON.stringify(clave)
        const acc = grupos.get(k) ?? { fila: Object.fromEntries(by.map((c, i) => [c, clave[i]])), monto: 0 }
        acc.monto += Number(t.monto)
        grupos.set(k, acc)
      }
      return [...grupos.values()].map(g => ({ ...g.fila, _sum: { monto: g.monto } }))
    },
    aggregate: async ({ where } = {}) => ({
      _sum: {
        monto: transacciones
          .filter(t => where?.presupuestoId === undefined || t.presupuestoId === where.presupuestoId)
          .reduce((s, t) => s + Number(t.monto), 0),
      },
    }),
  },
  quincena: {
    findFirst: async () => quincenaActiva,
  },
  presupuesto: {
    findUnique: async ({ where }) => presupuestos.find(p => p.id === where.id) ?? null,
    findMany: async ({ where } = {}) => presupuestos.filter(p =>
      (where?.quincenaId === undefined || p.quincenaId === where.quincenaId) &&
      (where?.categoriaId === undefined || p.categoriaId === where.categoriaId) &&
      (where?.categoria?.tipo === undefined || p.categoria?.tipo === where.categoria.tipo) &&
      (where?.estadoLinea?.not === undefined || p.estadoLinea !== where.estadoLinea.not)),
  },
}

// Intercepta require('./lib/prisma') dentro de src/ para inyectar el doble.
const requireOriginal = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === './lib/prisma' || id === '../lib/prisma') return prismaDoble
  return requireOriginal.apply(this, arguments)
}

const { getBudgetLineStatus } = require(path.join(SRC, 'budgetTracker'))
const { parseMessage } = require(path.join(SRC, 'parser'))
const { resolverTipoYDireccion } = require(path.join(SRC, 'tipoAhorro'))

async function main() {
  console.log('=== A: el real de una linea de Ahorro resta los retiros ===')
  presupuestos = [{
    id: 1, quincenaId: 1, categoriaId: 3, tipo: 'Ahorro', estadoLinea: 'Abierta',
    descripcion: 'Ahorro viaje', montoPresupuestado: 2000, montoRevisado: null,
    categoria: { tipo: 'Ahorro', nombre: 'Ahorro' }, quincena: { codigo: 'Q41' },
  }]
  transacciones = [
    { id: 1, presupuestoId: 1, monto: 2000, direccion: 'Aporte', estatus: 'Pagado' },
    { id: 2, presupuestoId: 1, monto: 600, direccion: 'Retiro', estatus: 'Pagado' },
  ]

  const ahorro = await getBudgetLineStatus(1)
  check('gastado = 2000 - 600 = 1400 (no 2600)', ahorro.gastado === 1400, ahorro.gastado)
  check('restante = 2000 - 1400 = 600', ahorro.restante === 600, ahorro.restante)
  check('no marca excedido', ahorro.excedido === 0, ahorro.excedido)

  console.log('\n=== B: una linea de Gasto no cambia de comportamiento ===')
  presupuestos = [{
    id: 2, quincenaId: 1, categoriaId: 1, tipo: 'Gasto', estadoLinea: 'Abierta',
    descripcion: 'Despensa', montoPresupuestado: 1000, montoRevisado: null,
    categoria: { tipo: 'Gasto', nombre: 'Super' }, quincena: { codigo: 'Q41' },
  }]
  transacciones = [
    { id: 3, presupuestoId: 2, monto: 700, direccion: null, estatus: 'Pagado' },
    { id: 4, presupuestoId: 2, monto: 500, direccion: null, estatus: 'Pendiente' },
  ]

  const gasto = await getBudgetLineStatus(2)
  check('gastado = 1200', gasto.gastado === 1200, gasto.gastado)
  check('detecta el excedido de 200', gasto.excedido === 200, gasto.excedido)

  console.log('\n=== C: el Vigente (montoRevisado) manda sobre el Original ===')
  presupuestos = [{
    id: 3, quincenaId: 1, categoriaId: 1, tipo: 'Gasto', estadoLinea: 'Abierta',
    descripcion: 'Despensa', montoPresupuestado: 1000, montoRevisado: 1500,
    categoria: { tipo: 'Gasto', nombre: 'Super' }, quincena: { codigo: 'Q41' },
  }]
  transacciones = [{ id: 5, presupuestoId: 3, monto: 1200, direccion: null, estatus: 'Pagado' }]

  const revisado = await getBudgetLineStatus(3)
  check('compara contra 1500, no contra 1000', revisado.presupuesto === 1500, revisado.presupuesto)
  check('no marca excedido porque el traspaso ya lo cubrio', revisado.excedido === 0, revisado.excedido)

  console.log('\n=== D: un montoRevisado de 0 NO cae al Original ===')
  presupuestos = [{
    id: 4, quincenaId: 1, categoriaId: 1, tipo: 'Gasto', estadoLinea: 'Abierta',
    descripcion: 'Cancelada de hecho', montoPresupuestado: 900, montoRevisado: 0,
    categoria: { tipo: 'Gasto', nombre: 'Super' }, quincena: { codigo: 'Q41' },
  }]
  transacciones = []
  const cero = await getBudgetLineStatus(4)
  check('presupuesto = 0 (usa ?? y no ||)', cero.presupuesto === 0, cero.presupuesto)

  console.log('\n=== E: el parser distingue aportar de retirar ===')
  const meter = parseMessage('meti 500 al ahorro', 'Rene', null, null)
  check('"meti al ahorro" no marca retiro', meter.direccion === null, meter.direccion)

  for (const frase of ['saque 500 del ahorro', 'saqué 500 del ahorro', 'retire 300 del ahorro']) {
    const p = parseMessage(frase, 'Rene', null, null)
    check(`"${frase}" -> Retiro`, p.direccion === 'Retiro', p.direccion)
  }

  console.log('\n=== F: la direccion solo aplica si la categoria es Ahorro ===')
  const enAhorro = resolverTipoYDireccion('Ahorro', 'Gasto', 'Retiro')
  check('categoria Ahorro + Retiro -> tipo Ahorro, direccion Retiro',
    enAhorro.tipo === 'Ahorro' && enAhorro.direccion === 'Retiro', JSON.stringify(enAhorro))

  const enGasto = resolverTipoYDireccion('Gasto', 'Gasto', 'Retiro')
  check('categoria Gasto ignora la direccion',
    enGasto.tipo === 'Gasto' && enGasto.direccion === null, JSON.stringify(enGasto))

  console.log('\n=== G: el tipo de una linea lo manda la categoria ===')
  presupuestos = [
    { id: 5, quincenaId: 1, categoriaId: 1, tipo: 'Ingreso', estadoLinea: 'Abierta',
      descripcion: 'Bono', categoria: { tipo: 'Gasto', nombre: 'Super' } },
  ]
  const { resolveBudgetLine } = require(path.join(SRC, 'budgetTracker'))
  const linea = await resolveBudgetLine({ quincenaId: 1, categoriaId: 1, descripcion: 'Bono' })
  check('una linea con categoria de Gasto sigue siendo candidata de Gasto',
    linea != null && linea.id === 5, JSON.stringify(linea))

  console.log('\n=== H: Milo no mete los ingresos en el total de gasto a cubrir ===')
  // Caso real de Q35: las lineas de sueldo tenian categoria de Ingreso pero
  // `Presupuesto.tipo` habia quedado en 'Gasto'. Filtrando por el campo de la
  // fila, Milo sumaba sueldos + gastos y contestaba "hay que cubrir 40,881.65"
  // cuando el gasto presupuestado eran 17,446.65 (lo que ya mostraba el
  // dashboard, que si clasifica por categoria).
  quincenaActiva = { id: 35, codigo: 'Q35', fechaInicio: '2026-09-15', fechaFin: '2026-09-29' }
  presupuestos = [
    { id: 10, quincenaId: 35, categoriaId: 2, tipo: 'Gasto', estadoLinea: 'Abierta',
      descripcion: 'Sueldo Rene', montoPresupuestado: 15000, montoRevisado: null,
      categoria: { tipo: 'Ingreso', nombre: 'Sueldo' } },
    { id: 11, quincenaId: 35, categoriaId: 2, tipo: 'Gasto', estadoLinea: 'Abierta',
      descripcion: 'Sueldo Mariana', montoPresupuestado: 8435, montoRevisado: null,
      categoria: { tipo: 'Ingreso', nombre: 'Sueldo' } },
    { id: 12, quincenaId: 35, categoriaId: 1, tipo: 'Gasto', estadoLinea: 'Abierta',
      descripcion: 'Renta', montoPresupuestado: 12000, montoRevisado: null,
      categoria: { tipo: 'Gasto', nombre: 'Hogar' } },
    { id: 13, quincenaId: 35, categoriaId: 1, tipo: 'Gasto', estadoLinea: 'Abierta',
      descripcion: 'Despensa', montoPresupuestado: 5446.65, montoRevisado: null,
      categoria: { tipo: 'Gasto', nombre: 'Familia' } },
  ]
  transacciones = []

  const { answerQuestion } = require(path.join(SRC, 'telegramBrain'))
  const respuesta = await answerQuestion('cuanto queda de presupuesto?', null)
  check('suma solo el gasto (17,446.65), no los sueldos',
    respuesta.includes('17,446.65'), respuesta)
  check('ya no reporta la suma de todo (40,881.65)',
    !respuesta.includes('40,881.65'), respuesta)

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
