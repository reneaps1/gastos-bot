// Doble de Prisma en memoria para las pruebas de Milo (test-milo-finanzas,
// test-milo-preguntas). Entiende el subconjunto de Prisma que usan el bot y
// las rutas del dashboard que se comparan contra el: where con igualdad, in,
// not, rangos, contains/equals insensibles y filtros por relacion; include de
// relaciones; groupBy y aggregate que agrupan y suman DE VERDAD.
//
// Por que generico y no un mock por consulta: la prueba de paridad corre el
// mismo doble por la ruta del dashboard y por el cargador del bot. Si cada
// lado tuviera su propio mock, la prueba compararia dos mocks, no dos
// calculos.

const RELACIONES = {
  categoria: { tabla: 'categoria', fk: 'categoriaId' },
  quincena: { tabla: 'quincena', fk: 'quincenaId' },
  presupuesto: { tabla: 'presupuesto', fk: 'presupuestoId' },
  credito: { tabla: 'credito', fk: 'creditoId' },
  user: { tabla: 'user', fk: 'userId' },
  metodoPago: { tabla: 'metodoPago', fk: 'metodoPagoId' },
  cuenta: { tabla: 'cuenta', fk: 'cuentaId' },
  cuentaPago: { tabla: 'cuenta', fk: 'cuentaPagoId' },
  apartado: { tabla: 'apartado', fk: 'apartadoId' },
}

function valorComparable(v) {
  if (v instanceof Date) return v.getTime()
  if (v != null && typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber()
  return v
}

function normal(s, insensible) {
  const t = String(s ?? '')
  return insensible ? t.toLowerCase() : t
}

function crearFakePrisma(datos = {}) {
  const tablas = {
    quincena: [], categoria: [], presupuesto: [], transaccion: [], liquidezSnapshot: [],
    creditoPago: [], credito: [], cuenta: [], apartado: [], deuda: [], user: [], metodoPago: [],
    ...datos,
  }
  const consultas = []   // bitacora de llamadas: [tabla, metodo, args]
  const escrituras = []  // solo create/update
  let siguienteId = 100000

  function relacion(fila, nombre) {
    const rel = RELACIONES[nombre]
    if (!rel) return fila[nombre]
    if (fila[nombre] !== undefined && fila[rel.fk] === undefined) return fila[nombre]
    const id = fila[rel.fk]
    if (id == null) return null
    return tablas[rel.tabla].find(r => r.id === id) ?? null
  }

  function cumpleCondicion(valor, cond) {
    if (cond === undefined) return true
    if (cond === null) return valor == null
    if (cond instanceof Date || typeof cond !== 'object') return valorComparable(valor) === valorComparable(cond)
    const ins = cond.mode === 'insensitive'
    for (const [op, arg] of Object.entries(cond)) {
      if (op === 'mode') continue
      const v = valorComparable(valor)
      const a = valorComparable(arg)
      if (op === 'equals' && normal(valor, ins) !== normal(arg, ins) && !(typeof v === 'number' && v === a)) return false
      if (op === 'in' && !arg.map(valorComparable).includes(v)) return false
      if (op === 'notIn' && arg.map(valorComparable).includes(v)) return false
      if (op === 'not' && (arg === null ? valor == null : v === a)) return false
      if (op === 'gte' && !(v >= a)) return false
      if (op === 'gt' && !(v > a)) return false
      if (op === 'lte' && !(v <= a)) return false
      if (op === 'lt' && !(v < a)) return false
      if (op === 'contains' && !normal(valor, ins).includes(normal(arg, ins))) return false
    }
    return true
  }

  function cumple(fila, where) {
    if (!where) return true
    for (const [campo, cond] of Object.entries(where)) {
      if (campo === 'AND') { if (![].concat(cond).every(w => cumple(fila, w))) return false; continue }
      if (campo === 'OR') { if (!cond.some(w => cumple(fila, w))) return false; continue }
      if (campo === 'NOT') { if ([].concat(cond).some(w => cumple(fila, w))) return false; continue }
      if (RELACIONES[campo] && cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const rel = relacion(fila, campo)
        if (!rel || !cumple(rel, cond)) return false
        continue
      }
      if (!cumpleCondicion(fila[campo], cond)) return false
    }
    return true
  }

  function hidratar(fila, include) {
    if (!include) return { ...fila }
    const out = { ...fila }
    for (const [nombre, sub] of Object.entries(include)) {
      if (!sub) continue
      if (Array.isArray(fila[nombre])) {
        out[nombre] = fila[nombre].map(f => hidratar(f, sub.include))
        continue
      }
      const rel = relacion(fila, nombre)
      out[nombre] = rel ? hidratar(rel, sub.include) : null
    }
    return out
  }

  function ordenar(filas, orderBy) {
    if (!orderBy) return filas
    const claves = (Array.isArray(orderBy) ? orderBy : [orderBy])
      .map(o => Object.entries(o)[0])
      .filter(([, dir]) => typeof dir === 'string')
    return [...filas].sort((a, b) => {
      for (const [campo, dir] of claves) {
        const va = valorComparable(a[campo]); const vb = valorComparable(b[campo])
        if (va === vb) continue
        if (va == null) return 1
        if (vb == null) return -1
        const c = va < vb ? -1 : 1
        return dir === 'desc' ? -c : c
      }
      return 0
    })
  }

  function modelo(nombre) {
    const filas = () => tablas[nombre]
    const log = (metodo, args) => consultas.push([nombre, metodo, args])
    return {
      findMany: async (args = {}) => {
        log('findMany', args)
        let r = ordenar(filas().filter(f => cumple(f, args.where)), args.orderBy)
        if (args.skip) r = r.slice(args.skip)
        if (args.take != null) r = r.slice(0, args.take)
        return r.map(f => hidratar(f, args.include))
      },
      findFirst: async (args = {}) => {
        log('findFirst', args)
        const r = ordenar(filas().filter(f => cumple(f, args.where)), args.orderBy)
        return r[0] ? hidratar(r[0], args.include) : null
      },
      findUnique: async (args = {}) => {
        log('findUnique', args)
        const f = filas().find(x => cumple(x, args.where))
        return f ? hidratar(f, args.include) : null
      },
      count: async (args = {}) => {
        log('count', args)
        return filas().filter(f => cumple(f, args.where)).length
      },
      create: async ({ data, include } = {}) => {
        const fila = { id: siguienteId++, ...data }
        filas().push(fila)
        escrituras.push([nombre, 'create', fila])
        return hidratar(fila, include)
      },
      update: async ({ where, data } = {}) => {
        const fila = filas().find(x => cumple(x, where))
        if (!fila) throw new Error(`${nombre} no encontrado`)
        Object.assign(fila, data)
        escrituras.push([nombre, 'update', { ...where, ...data }])
        return { ...fila }
      },
      groupBy: async ({ by, where, _sum, _count } = {}) => {
        log('groupBy', { by, where })
        const grupos = new Map()
        for (const f of filas().filter(x => cumple(x, where))) {
          const clave = by.map(c => f[c] ?? null)
          const k = JSON.stringify(clave)
          if (!grupos.has(k)) grupos.set(k, { base: Object.fromEntries(by.map((c, i) => [c, clave[i]])), filas: [] })
          grupos.get(k).filas.push(f)
        }
        return [...grupos.values()].map(({ base, filas: fs }) => {
          const out = { ...base }
          if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map(c => [c, fs.reduce((s, f) => s + Number(f[c] ?? 0), 0)]))
          if (_count) out._count = { _all: fs.length }
          return out
        })
      },
      aggregate: async ({ where, _sum, _count, _max, _min, _avg } = {}) => {
        log('aggregate', { where })
        const fs = filas().filter(x => cumple(x, where))
        const nums = c => fs.map(f => Number(f[c] ?? 0))
        const out = {}
        if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map(c => [c, fs.length ? nums(c).reduce((a, b) => a + b, 0) : null]))
        if (_count) out._count = _count === true ? fs.length : { _all: fs.length }
        if (_max) out._max = Object.fromEntries(Object.keys(_max).map(c => [c, fs.length ? Math.max(...nums(c)) : null]))
        if (_min) out._min = Object.fromEntries(Object.keys(_min).map(c => [c, fs.length ? Math.min(...nums(c)) : null]))
        if (_avg) out._avg = Object.fromEntries(Object.keys(_avg).map(c => [c, fs.length ? nums(c).reduce((a, b) => a + b, 0) / fs.length : null]))
        return out
      },
    }
  }

  const prisma = {}
  for (const nombre of Object.keys(tablas)) prisma[nombre] = modelo(nombre)
  prisma.$transaction = async fn => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))
  prisma.$executeRaw = async () => 1
  prisma.$queryRaw = async () => [{ ok: 1 }]
  prisma._tablas = tablas
  prisma._consultas = consultas
  prisma._escrituras = escrituras
  return prisma
}

module.exports = { crearFakePrisma }
