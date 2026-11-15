// Acciones que el agente de Milo PROPONE y que solo se ejecutan con el toque
// de "Confirmar" en Telegram.
//
// Flujo:
//   1. El agente llama una herramienta proponer_* (src/miloTools.js).
//   2. proponer() valida los argumentos contra la base, resuelve nombres a ids
//      y guarda UNA fila `pendiente` en milo_acciones con el resumen exacto que
//      vera el usuario. NO toca ningun dato financiero.
//   3. index.js manda el resumen con dos botones: ax:<id> (Confirmar) y
//      ac:<id> (Cancelar).
//   4. confirmar() reclama la fila con un UPDATE condicional (pendiente ->
//      ejecutando): dos toques no ejecutan dos veces. Revisa que el registro no
//      haya cambiado desde la propuesta y ejecuta con la API del dashboard
//      (src/dashboardApi.js), que tiene la unica implementacion de cada
//      operacion y escribe su bitacora (audit_log).
//
// Reglas que no se relajan:
//   - La IA nunca escribe datos financieros. Lo unico que escribe el camino de
//     la IA es la fila pendiente en milo_acciones.
//   - Se ejecuta exactamente lo que el usuario vio (payload + resumen), no lo
//     que la IA diga despues.
//   - callback_data es entrada no confiable: la accion tiene que ser del mismo
//     chat y estar pendiente y vigente.

const prisma = require('./lib/prisma')
const dashboardApi = require('./dashboardApi')
const { fechaMexico, dbDate, normalize } = require('./financeUtils')
const { resolveBudgetLineByName, getActiveBudgetLines } = require('./budgetTracker')
const { formatMXN } = require('./lib/finanzas-quincena')

const TTL_MS = 30 * 60 * 1000

const PREFIJO_CONFIRMAR = 'ax'
const PREFIJO_CANCELAR = 'ac'
const ACCIONES_CALLBACK = new Set([PREFIJO_CONFIRMAR, PREFIJO_CANCELAR])

// ---- Utilidades -----------------------------------------------------------------

function dateOnly(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null
}

function fechaCorta(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d}-${meses[m - 1]}-${y}`
}

function parseMonto(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null
  const texto = String(value).toLowerCase().replace(/\$/g, '').trim()
  const mil = /\bmil\b|k$/.test(texto)
  const limpio = texto.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!limpio) return null
  const n = Number(limpio[0]) * (mil ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

// "hoy", "ayer", "antier" o YYYY-MM-DD. null si no se entiende.
function parseFecha(value, hoy = fechaMexico()) {
  if (value == null || value === '') return null
  const t = normalize(String(value)).trim()
  const desplazar = dias => {
    const d = dbDate(hoy)
    d.setUTCDate(d.getUTCDate() - dias)
    return dateOnly(d)
  }
  if (t === 'hoy') return hoy
  if (t === 'ayer') return desplazar(1)
  if (t === 'antier' || t === 'anteayer') return desplazar(2)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim())
  if (!m) return null
  const d = dbDate(m[0])
  return Number.isNaN(d.getTime()) || dateOnly(d) !== m[0] ? null : m[0]
}

function parseId(value) {
  const n = Number.parseInt(String(value ?? '').replace(/^#/, ''), 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

const SIN_LINEA = new Set(['ninguna', 'sin linea', 'sin línea', 'quitar', 'ninguno', 'none', 'null'])

// Busca por nombre en una lista: exacto (sin acentos ni mayusculas) y, si no,
// "contiene" con una sola coincidencia. Con varias, error con las opciones.
function elegirPorNombre(lista, nombre, etiqueta, campo = 'nombre') {
  const buscado = normalize(nombre)
  if (!buscado) return { ok: false, error: `Falta el nombre de la ${etiqueta}.` }
  const exacto = lista.filter(x => normalize(x[campo]) === buscado)
  if (exacto.length === 1) return { ok: true, valor: exacto[0] }
  const parecidos = lista.filter(x => normalize(x[campo]).includes(buscado) || buscado.includes(normalize(x[campo])))
  if (parecidos.length === 1) return { ok: true, valor: parecidos[0] }
  if (parecidos.length > 1) {
    return { ok: false, error: `"${nombre}" coincide con varias ${etiqueta}s: ${parecidos.slice(0, 8).map(x => x[campo]).join(', ')}. Pregunta cuál.` }
  }
  return { ok: false, error: `No encontré la ${etiqueta} "${nombre}". Opciones: ${lista.slice(0, 15).map(x => x[campo]).join(', ')}.` }
}

async function resolverCategoria(nombre) {
  const lista = await prisma.categoria.findMany({ where: { activo: true }, orderBy: { id: 'asc' } })
  return elegirPorNombre(lista, nombre, 'categoría')
}

async function resolverMetodoPago(nombre) {
  const lista = await prisma.metodoPago.findMany({ orderBy: { id: 'asc' } })
  return elegirPorNombre(lista, nombre, 'forma de pago')
}

async function resolverUsuario(nombre) {
  const lista = await prisma.user.findMany({ where: { activo: true }, orderBy: { id: 'asc' } })
  return elegirPorNombre(lista, nombre, 'persona')
}

async function quincenaParaFecha(fecha) {
  const d = dbDate(fecha)
  return prisma.quincena.findFirst({
    where: { fechaInicio: { lte: d }, fechaFin: { gte: d } },
    orderBy: { fechaInicio: 'asc' },
  })
}

async function resolverLinea(nombre, quincenaId, tipo) {
  const porSimilitud = await resolveBudgetLineByName({ quincenaId, destino: nombre, tipo })
  if (porSimilitud) return { ok: true, valor: porSimilitud }
  const lineas = await getActiveBudgetLines({ quincenaId, tipo })
  if (lineas.length === 0) return { ok: false, error: 'Esa quincena no tiene líneas de presupuesto de ese tipo.' }
  return elegirPorNombre(lineas, nombre, 'línea', 'descripcion')
}

function describirMovimiento(tx) {
  const partes = [`${tx.descripcion} — ${formatMXN(Number(tx.monto))}`, fechaCorta(dateOnly(tx.fecha))]
  if (tx.categoria?.nombre) partes.push(tx.categoria.nombre)
  return partes.join(', ')
}

// Lo que se compara al ejecutar: si cambio desde la propuesta, no se ejecuta.
function huella(tx) {
  return {
    monto: Number(tx.monto),
    descripcion: tx.descripcion,
    fecha: dateOnly(tx.fecha),
    categoriaId: tx.categoriaId,
    presupuestoId: tx.presupuestoId ?? null,
    metodoPagoId: tx.metodoPagoId ?? null,
    estatus: tx.estatus,
  }
}

// JSON con las llaves ordenadas. La huella viaja en milo_acciones.payload, una
// columna JSONB, y Postgres REORDENA las llaves de un objeto jsonb (primero las
// cortas). Comparar con JSON.stringify a secas hacia que TODA confirmacion de
// editar o borrar fallara con "el movimiento cambio" aunque nadie lo tocara
// (produccion, 2026-11-14: acciones #1 y #2).
function jsonCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(',')}}`
  }
  return JSON.stringify(valor === undefined ? null : valor)
}

// Una huella guardada antes de que existiera un campo no lo trae: ese campo no
// se compara (no se bloquea una propuesta vieja por un campo que no conocia).
function mismaHuella(actual, guardada) {
  if (!guardada || typeof guardada !== 'object') return false
  const comparable = Object.fromEntries(Object.keys(guardada).map(k => [k, actual[k] === undefined ? null : actual[k]]))
  return jsonCanonico(comparable) === jsonCanonico(guardada)
}

async function cargarMovimiento(id) {
  return prisma.transaccion.findUnique({
    where: { id },
    include: { categoria: true, presupuesto: true, metodoPago: true, quincena: true },
  })
}

// ---- Liquidez ---------------------------------------------------------------------

// Un saldo puede ser 0 o negativo (a diferencia de un monto de movimiento).
function parseSaldo(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  const texto = String(value).toLowerCase().replace(/[$\s]/g, '')
  const mil = /(?:mil|k)$/.test(texto)
  const m = texto.replace(/,/g, '').match(/^-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0]) * (mil ? 1000 : 1)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function aBooleano(value) {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value
  const t = normalize(String(value))
  if (['true', 'si', 'sí', '1', 'validado'].includes(t)) return true
  if (['false', 'no', '0'].includes(t)) return false
  return null
}

async function cuentasActivas() {
  return prisma.cuenta.findMany({ where: { activo: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] })
}

// `balances` llega del modelo como lista [{ account, amount, note }] o como
// objeto { "BBVA": 0, "Banamex": 4690.34 }. Devuelve un Map cuentaId -> saldo.
async function resolverSaldos(balances, cuentas) {
  let lista = balances
  if (lista && !Array.isArray(lista) && typeof lista === 'object') {
    lista = Object.entries(lista).map(([account, amount]) => ({ account, amount }))
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, error: 'Faltan los saldos. Manda balances como lista: [{"account":"BBVA","amount":0}, ...].' }
  }
  const porCuenta = new Map()
  for (const item of lista) {
    const nombre = item?.account ?? item?.cuenta ?? item?.name
    const r = elegirPorNombre(cuentas, nombre, 'cuenta')
    if (!r.ok) return r
    const monto = parseSaldo(item.amount ?? item.monto ?? item.saldo)
    if (monto == null) return { ok: false, error: `No entendí el saldo de ${r.valor.nombre}. Pregúntalo.` }
    if (porCuenta.has(r.valor.id)) return { ok: false, error: `La cuenta ${r.valor.nombre} viene dos veces.` }
    const nota = item.note ?? item.nota
    porCuenta.set(r.valor.id, { monto, nota: nota ? String(nota).trim().slice(0, 200) : null })
  }
  return { ok: true, porCuenta }
}

const ORDEN_DE_CORTES = [{ fechaCorte: 'desc' }, { fechaRegistro: 'desc' }, { id: 'desc' }]

// Con id, ese corte; sin id, el mas reciente.
async function cargarCorte(id) {
  const include = { quincena: true, montos: { include: { cuenta: true } } }
  if (id) return prisma.liquidezSnapshot.findUnique({ where: { id }, include })
  return prisma.liquidezSnapshot.findFirst({ include, orderBy: ORDEN_DE_CORTES })
}

function totalDeCorte(corte) {
  return (corte?.montos || []).reduce((s, m) => s + (Number(m.monto) || 0), 0)
}

function huellaCorte(corte) {
  return {
    fecha: dateOnly(corte.fechaCorte),
    quincenaId: corte.quincenaId,
    validado: Boolean(corte.validado),
    notas: corte.notas || null,
    montos: (corte.montos || []).map(m => [m.cuentaId, Number(m.monto)]).sort((a, b) => a[0] - b[0]),
  }
}

// ---- Tipos de accion --------------------------------------------------------------
//
// Cada tipo tiene:
//   preparar(args, ctx) -> { ok, payload, resumen } | { ok:false, error }
//     Lee la base, NUNCA escribe. El error va de regreso al agente para que
//     pregunte o corrija.
//   ejecutar(payload, ctx) -> { mensaje, resultado }
//     Solo corre despues del toque. Lanza error si algo falla.

const TIPOS = {
  'transaccion.registrar': {
    async preparar(args, ctx) {
      const monto = parseMonto(args.amount)
      if (!monto) return { ok: false, error: 'Falta el monto (mayor que cero).' }
      const descripcion = String(args.description || '').trim().slice(0, 200)
      if (!descripcion) return { ok: false, error: 'Falta la descripción.' }
      if (!args.category) return { ok: false, error: 'Falta la categoría. Usa list_categories si no la sabes.' }

      const cat = await resolverCategoria(args.category)
      if (!cat.ok) return cat
      const categoria = cat.valor

      const fecha = args.date ? parseFecha(args.date) : fechaMexico()
      if (!fecha) return { ok: false, error: `No entendí la fecha "${args.date}". Usa YYYY-MM-DD, hoy o ayer.` }
      const quincena = await quincenaParaFecha(fecha)
      if (!quincena) return { ok: false, error: `No hay quincena dada de alta para el ${fecha}.` }

      let metodoPago = null
      if (args.paymentMethod) {
        const r = await resolverMetodoPago(args.paymentMethod)
        if (!r.ok) return r
        metodoPago = r.valor
      }

      let usuario = null
      if (args.user) {
        const r = await resolverUsuario(args.user)
        if (!r.ok) return r
        usuario = r.valor
      }

      let linea = null
      if (args.budgetLine && !SIN_LINEA.has(normalize(args.budgetLine))) {
        const r = await resolverLinea(args.budgetLine, quincena.id, categoria.tipo)
        if (!r.ok) return r
        linea = r.valor
      }

      const estatus = args.status === 'Pendiente' ? 'Pendiente' : 'Pagado'
      const userId = usuario?.id ?? ctx.userId ?? null
      const payload = {
        fecha,
        quincenaId: quincena.id,
        descripcion,
        categoriaId: categoria.id,
        tipo: categoria.tipo,
        monto,
        metodoPagoId: metodoPago?.id ?? null,
        presupuestoId: linea?.id ?? null,
        estatus,
        userId,
      }
      const renglones = [
        `Registrar ${categoria.tipo === 'Gasto' ? 'gasto' : categoria.tipo === 'Ingreso' ? 'ingreso' : 'ahorro'}: ${descripcion} — ${formatMXN(monto)}`,
        `• Fecha: ${fechaCorta(fecha)} (${quincena.codigo})`,
        `• Categoría: ${categoria.nombre}`,
        `• Estatus: ${estatus}`,
      ]
      if (metodoPago) renglones.push(`• Forma de pago: ${metodoPago.nombre}`)
      if (linea) renglones.push(`• Línea: ${linea.descripcion}`)
      if (usuario) renglones.push(`• Persona: ${usuario.nombre}`)
      return { ok: true, payload, resumen: renglones.join('\n') }
    },

    // Reintento de una confirmacion que quedo a medias (timeout del dashboard
    // despues de guardar, reinicio del bot): si el movimiento ya existe, no se
    // registra otra vez.
    async yaAplicada(payload, fila) {
      const existente = await prisma.transaccion.findFirst({
        where: {
          fecha: dbDate(payload.fecha),
          monto: payload.monto,
          descripcion: payload.descripcion,
          categoriaId: payload.categoriaId,
          fechaRegistro: { gte: fila.createdAt },
        },
        orderBy: { id: 'desc' },
      })
      if (!existente) return null
      return { mensaje: `Ya estaba registrado: ${payload.descripcion} por ${formatMXN(payload.monto)} (#${existente.id}).`, resultado: { transaccionId: existente.id } }
    },

    async ejecutar(payload, ctx) {
      const creada = await dashboardApi.llamar('POST', '/api/transacciones', {
        body: { ...payload, source: ctx.canal === 'web' ? 'web-milo' : 'telegram' },
        actor: ctx.actor,
        userId: ctx.userId,
      })
      return {
        mensaje: `Listo: registré ${payload.descripcion} por ${formatMXN(payload.monto)}.`,
        resultado: { transaccionId: creada?.id ?? null },
      }
    },
  },

  'transaccion.editar': {
    async preparar(args) {
      const id = parseId(args.id)
      if (!id) return { ok: false, error: 'Falta el id del movimiento. Búscalo primero con search_transactions.' }
      const tx = await cargarMovimiento(id)
      if (!tx) return { ok: false, error: `No existe el movimiento #${id}.` }

      const cambios = {}
      const renglones = []

      if (args.amount != null && args.amount !== '') {
        const monto = parseMonto(args.amount)
        if (!monto) return { ok: false, error: `Monto inválido: ${args.amount}.` }
        if (monto !== Number(tx.monto)) {
          cambios.monto = monto
          renglones.push(`• Monto: ${formatMXN(Number(tx.monto))} → ${formatMXN(monto)}`)
        }
      }

      if (args.description) {
        const descripcion = String(args.description).trim().slice(0, 200)
        if (descripcion && descripcion !== tx.descripcion) {
          cambios.descripcion = descripcion
          renglones.push(`• Descripción: ${tx.descripcion} → ${descripcion}`)
        }
      }

      let quincenaFinal = tx.quincena
      if (args.date) {
        const fecha = parseFecha(args.date)
        if (!fecha) return { ok: false, error: `No entendí la fecha "${args.date}". Usa YYYY-MM-DD, hoy o ayer.` }
        if (fecha !== dateOnly(tx.fecha)) {
          const q = await quincenaParaFecha(fecha)
          if (!q) return { ok: false, error: `No hay quincena dada de alta para el ${fecha}.` }
          cambios.fecha = fecha
          if (q.id !== tx.quincenaId) {
            cambios.quincenaId = q.id
            quincenaFinal = q
          }
          renglones.push(`• Fecha: ${fechaCorta(dateOnly(tx.fecha))} → ${fechaCorta(fecha)}${q.id !== tx.quincenaId ? ` (pasa a ${q.codigo})` : ''}`)
        }
      }

      let tipoFinal = tx.categoria?.tipo || tx.tipo
      if (args.category) {
        const r = await resolverCategoria(args.category)
        if (!r.ok) return r
        if (r.valor.id !== tx.categoriaId) {
          cambios.categoriaId = r.valor.id
          tipoFinal = r.valor.tipo
          renglones.push(`• Categoría: ${tx.categoria?.nombre || '—'} → ${r.valor.nombre}`)
        }
      }

      if (args.paymentMethod) {
        const r = await resolverMetodoPago(args.paymentMethod)
        if (!r.ok) return r
        if (r.valor.id !== tx.metodoPagoId) {
          cambios.metodoPagoId = r.valor.id
          renglones.push(`• Forma de pago: ${tx.metodoPago?.nombre || '—'} → ${r.valor.nombre}`)
        }
      }

      if (args.status) {
        const estatus = normalize(args.status).startsWith('pag') ? 'Pagado' : normalize(args.status).startsWith('pend') ? 'Pendiente' : null
        if (!estatus) return { ok: false, error: 'El estatus es Pagado o Pendiente.' }
        if (estatus !== tx.estatus) {
          cambios.estatus = estatus
          renglones.push(`• Estatus: ${tx.estatus} → ${estatus}`)
        }
      }

      if (args.budgetLine) {
        if (SIN_LINEA.has(normalize(args.budgetLine))) {
          if (tx.presupuestoId != null) {
            cambios.presupuestoId = null
            renglones.push(`• Línea: ${tx.presupuesto?.descripcion || '—'} → sin línea`)
          }
        } else {
          const r = await resolverLinea(args.budgetLine, quincenaFinal.id, tipoFinal)
          if (!r.ok) return r
          if (r.valor.id !== tx.presupuestoId) {
            cambios.presupuestoId = r.valor.id
            renglones.push(`• Línea: ${tx.presupuesto?.descripcion || 'sin línea'} → ${r.valor.descripcion}`)
          }
        }
      }

      if (renglones.length === 0) {
        return { ok: false, error: 'No hay nada que cambiar: el movimiento ya tiene esos valores.' }
      }

      return {
        ok: true,
        payload: { id, cambios, huella: huella(tx) },
        resumen: [`Editar #${id}: ${describirMovimiento(tx)}`, ...renglones].join('\n'),
      }
    },

    async ejecutar(payload, ctx) {
      const tx = await cargarMovimiento(payload.id)
      if (!tx) throw new Error(`El movimiento #${payload.id} ya no existe.`)
      if (!mismaHuella(huella(tx), payload.huella)) {
        throw new Error('El movimiento cambió desde que te lo propuse. Pídemelo otra vez para ver los datos actuales.')
      }
      await dashboardApi.llamar('PUT', `/api/transacciones/${payload.id}`, {
        body: payload.cambios,
        actor: ctx.actor,
        userId: ctx.userId,
      })
      return { mensaje: `Listo: actualicé #${payload.id} (${tx.descripcion}).`, resultado: { transaccionId: payload.id } }
    },
  },

  'transaccion.borrar': {
    async preparar(args) {
      const id = parseId(args.id)
      if (!id) return { ok: false, error: 'Falta el id del movimiento. Búscalo primero con search_transactions.' }
      const tx = await cargarMovimiento(id)
      if (!tx) return { ok: false, error: `No existe el movimiento #${id}.` }
      return {
        ok: true,
        payload: { id, huella: huella(tx) },
        resumen: `Borrar #${id}: ${describirMovimiento(tx)}${tx.presupuesto ? `\n• Línea: ${tx.presupuesto.descripcion}` : ''}\n\nNo se puede deshacer desde Telegram (queda en la bitácora del dashboard).`,
      }
    },

    async yaAplicada(payload) {
      // Un borrado que quedo a medias y ya no encuentra el movimiento: se hizo.
      const tx = await cargarMovimiento(payload.id)
      if (tx) return null
      return { mensaje: `El movimiento #${payload.id} ya estaba borrado.`, resultado: { transaccionId: payload.id } }
    },

    async ejecutar(payload, ctx) {
      const tx = await cargarMovimiento(payload.id)
      if (!tx) throw new Error(`El movimiento #${payload.id} ya no existe.`)
      if (!mismaHuella(huella(tx), payload.huella)) {
        throw new Error('El movimiento cambió desde que te lo propuse. Pídemelo otra vez para ver los datos actuales.')
      }
      await dashboardApi.llamar('DELETE', `/api/transacciones/${payload.id}`, { actor: ctx.actor, userId: ctx.userId })
      return { mensaje: `Listo: borré ${tx.descripcion} por ${formatMXN(Number(tx.monto))}.`, resultado: { transaccionId: payload.id } }
    },
  },

  // ---- Liquidez: cortes de caja ---------------------------------------------------
  //
  // Un corte es UNA propuesta con todas las cuentas: el agente junta los saldos
  // en la platica y el usuario confirma una sola vez. Se ejecuta con
  // /api/liquidez, que recalcula por pagar y gastos al corte en el servidor.

  'liquidez.registrar': {
    async preparar(args) {
      const hoy = fechaMexico()
      const fecha = args.date ? parseFecha(args.date, hoy) : hoy
      if (!fecha) return { ok: false, error: `No entendí la fecha "${args.date}". Usa YYYY-MM-DD, hoy o ayer.` }
      if (fecha > hoy) return { ok: false, error: 'Un corte no puede tener fecha futura.' }
      const quincena = await quincenaParaFecha(fecha)
      if (!quincena) return { ok: false, error: `No hay quincena dada de alta para el ${fecha}.` }

      const cuentas = await cuentasActivas()
      if (cuentas.length === 0) return { ok: false, error: 'No hay cuentas activas. Se dan de alta en el dashboard (Configuración > Cuentas).' }

      const saldos = await resolverSaldos(args.balances, cuentas)
      if (!saldos.ok) return saldos

      const previo = await cargarCorte(null)
      const previoPorCuenta = new Map((previo?.montos || []).map(m => [m.cuentaId, Number(m.monto)]))
      const resto = normalize(args.others || '')
      const faltan = cuentas.filter(c => !saldos.porCuenta.has(c.id))
      if (faltan.length && !['previous', 'anterior', 'igual', 'zero', 'cero'].includes(resto)) {
        return {
          ok: false,
          error: `Faltan los saldos de: ${faltan.map(c => c.nombre).join(', ')}. Pregúntalos (0 si no hay nada). Si el usuario dijo que siguen igual que el corte anterior manda others="previous"; si dijo que las demás están en cero, others="zero".`,
        }
      }
      const heredar = ['previous', 'anterior', 'igual'].includes(resto)

      const montos = []
      const renglones = []
      for (const c of cuentas) {
        const dado = saldos.porCuenta.get(c.id)
        const monto = dado ? dado.monto : heredar ? (previoPorCuenta.get(c.id) ?? 0) : 0
        montos.push({ cuentaId: c.id, monto, nota: dado?.nota || null })
        const marca = dado ? '' : heredar ? ' (igual que el corte anterior)' : ' (sin saldo)'
        renglones.push(`• ${c.nombre} — ${formatMXN(monto)}${marca}${dado?.nota ? ` · ${dado.nota}` : ''}`)
      }
      const total = montos.reduce((s, m) => s + m.monto, 0)

      const lineas = [`Corte de liquidez al ${fechaCorta(fecha)} (${quincena.codigo})`, ...renglones, `Total en cuentas: ${formatMXN(total)}`]
      if (previo) {
        lineas.push(`Corte anterior (${fechaCorta(dateOnly(previo.fechaCorte))}): ${formatMXN(totalDeCorte(previo))}`)
        if (dateOnly(previo.fechaCorte) === fecha) {
          lineas.push(`\nOjo: ya hay un corte con esa fecha (#${previo.id}). Este se guardaría como uno nuevo.`)
        }
      }
      const notas = args.notes ? String(args.notes).trim().slice(0, 500) : null
      if (notas) lineas.push(`Notas: ${notas}`)

      return {
        ok: true,
        payload: { fecha, quincenaId: quincena.id, montos, notas, validado: aBooleano(args.validated) === true },
        resumen: lineas.join('\n'),
      }
    },

    async yaAplicada(payload, fila) {
      const existente = await prisma.liquidezSnapshot.findFirst({
        where: { fechaCorte: dbDate(payload.fecha), quincenaId: payload.quincenaId, fechaRegistro: { gte: fila.createdAt } },
        orderBy: { id: 'desc' },
      })
      if (!existente) return null
      return { mensaje: `Ese corte ya estaba guardado (#${existente.id}).`, resultado: { snapshotId: existente.id } }
    },

    async ejecutar(payload, ctx) {
      const creado = await dashboardApi.llamar('POST', '/api/liquidez', {
        body: {
          fechaCorte: payload.fecha,
          quincenaId: payload.quincenaId,
          montos: payload.montos,
          notas: payload.notas,
          validado: payload.validado,
        },
        actor: ctx.actor,
        userId: ctx.userId,
      })
      const total = payload.montos.reduce((s, m) => s + m.monto, 0)
      return {
        mensaje: `Listo: guardé el corte del ${fechaCorta(payload.fecha)}. Total en cuentas: ${formatMXN(total)}.`,
        resultado: { snapshotId: creado?.id ?? null },
      }
    },
  },

  'liquidez.editar': {
    async preparar(args) {
      const id = args.id == null || args.id === '' ? null : parseId(args.id)
      if (args.id != null && args.id !== '' && !id) return { ok: false, error: 'El id del corte no es válido. Sale de get_liquidity (snapshotId) o list_liquidity_cuts.' }
      const corte = await cargarCorte(id)
      if (!corte) return { ok: false, error: id ? `No existe el corte #${id}.` : 'No hay ningún corte de liquidez todavía.' }

      const body = {}
      const renglones = []
      const fechaActual = dateOnly(corte.fechaCorte)

      if (args.balances != null) {
        const cuentas = await cuentasActivas()
        // Tambien las cuentas que ya estan en el corte aunque hoy esten inactivas.
        const conocidas = new Map(cuentas.map(c => [c.id, c]))
        for (const m of corte.montos) if (m.cuenta && !conocidas.has(m.cuentaId)) conocidas.set(m.cuentaId, m.cuenta)
        const saldos = await resolverSaldos(args.balances, [...conocidas.values()])
        if (!saldos.ok) return saldos

        const finales = new Map(corte.montos.map(m => [m.cuentaId, { cuentaId: m.cuentaId, monto: Number(m.monto), nota: m.nota || null }]))
        for (const [cuentaId, dado] of saldos.porCuenta) {
          const antes = finales.get(cuentaId)
          const nombre = conocidas.get(cuentaId).nombre
          if (antes && antes.monto === dado.monto && (dado.nota == null || dado.nota === antes.nota)) continue
          finales.set(cuentaId, { cuentaId, monto: dado.monto, nota: dado.nota ?? antes?.nota ?? null })
          renglones.push(`• ${nombre}: ${antes ? formatMXN(antes.monto) : 'sin saldo'} → ${formatMXN(dado.monto)}`)
        }
        if (renglones.length) {
          body.montos = [...finales.values()]
          const totalNuevo = body.montos.reduce((s, m) => s + m.monto, 0)
          renglones.push(`• Total en cuentas: ${formatMXN(totalDeCorte(corte))} → ${formatMXN(totalNuevo)}`)
        }
      }

      if (args.date) {
        const fecha = parseFecha(args.date)
        if (!fecha) return { ok: false, error: `No entendí la fecha "${args.date}". Usa YYYY-MM-DD, hoy o ayer.` }
        if (fecha > fechaMexico()) return { ok: false, error: 'Un corte no puede tener fecha futura.' }
        if (fecha !== fechaActual) {
          const q = await quincenaParaFecha(fecha)
          if (!q) return { ok: false, error: `No hay quincena dada de alta para el ${fecha}.` }
          body.fechaCorte = fecha
          if (q.id !== corte.quincenaId) body.quincenaId = q.id
          renglones.push(`• Fecha: ${fechaCorta(fechaActual)} → ${fechaCorta(fecha)}${q.id !== corte.quincenaId ? ` (pasa a ${q.codigo})` : ''}`)
        }
      }

      if (args.notes != null) {
        const notas = String(args.notes).trim().slice(0, 500) || null
        if (notas !== (corte.notas || null)) {
          body.notas = notas
          renglones.push(`• Notas: ${corte.notas || '—'} → ${notas || '—'}`)
        }
      }

      const validado = aBooleano(args.validated)
      if (validado != null && validado !== corte.validado) {
        body.validado = validado
        renglones.push(`• Validado: ${corte.validado ? 'sí' : 'no'} → ${validado ? 'sí' : 'no'}`)
      }

      if (renglones.length === 0) return { ok: false, error: 'No hay nada que cambiar: el corte ya tiene esos valores.' }

      return {
        ok: true,
        payload: { id: corte.id, body, huella: huellaCorte(corte) },
        resumen: [`Editar el corte #${corte.id} del ${fechaCorta(fechaActual)} (${corte.quincena?.codigo || '—'})`, ...renglones].join('\n'),
      }
    },

    async ejecutar(payload, ctx) {
      const corte = await cargarCorte(payload.id)
      if (!corte) throw new Error(`El corte #${payload.id} ya no existe.`)
      if (!mismaHuella(huellaCorte(corte), payload.huella)) {
        throw new Error('El corte cambió desde que te lo propuse. Pídemelo otra vez para ver los datos actuales.')
      }
      await dashboardApi.llamar('PUT', `/api/liquidez/${payload.id}`, { body: payload.body, actor: ctx.actor, userId: ctx.userId })
      return { mensaje: `Listo: actualicé el corte #${payload.id}.`, resultado: { snapshotId: payload.id } }
    },
  },

  'liquidez.borrar': {
    async preparar(args) {
      const id = parseId(args.id)
      if (!id) return { ok: false, error: 'Falta el id del corte. Sale de get_liquidity (snapshotId) o list_liquidity_cuts.' }
      const corte = await cargarCorte(id)
      if (!corte) return { ok: false, error: `No existe el corte #${id}.` }
      return {
        ok: true,
        payload: { id, huella: huellaCorte(corte) },
        resumen: `Borrar el corte #${id} del ${fechaCorta(dateOnly(corte.fechaCorte))} (${corte.quincena?.codigo || '—'})\n• Total en cuentas: ${formatMXN(totalDeCorte(corte))}${corte.validado ? '\n• Está validado' : ''}\n\nNo se puede deshacer.`,
      }
    },

    async yaAplicada(payload) {
      if (await cargarCorte(payload.id)) return null
      return { mensaje: `El corte #${payload.id} ya estaba borrado.`, resultado: { snapshotId: payload.id } }
    },

    async ejecutar(payload, ctx) {
      const corte = await cargarCorte(payload.id)
      if (!corte) throw new Error(`El corte #${payload.id} ya no existe.`)
      if (!mismaHuella(huellaCorte(corte), payload.huella)) {
        throw new Error('El corte cambió desde que te lo propuse. Pídemelo otra vez para ver los datos actuales.')
      }
      await dashboardApi.llamar('DELETE', `/api/liquidez/${payload.id}`, { actor: ctx.actor, userId: ctx.userId })
      return { mensaje: `Listo: borré el corte del ${fechaCorta(dateOnly(corte.fechaCorte))}.`, resultado: { snapshotId: payload.id } }
    },
  },
}

// ---- Proponer / confirmar / cancelar ------------------------------------------------

async function proponer(tipo, args, ctx = {}) {
  const def = TIPOS[tipo]
  if (!def) return { ok: false, error: `Acción desconocida: ${tipo}` }
  if (ctx.chatId == null) return { ok: false, error: 'Solo puedo proponer cambios desde un chat con botones (Telegram o el dashboard).' }

  const preparado = await def.preparar(args || {}, ctx)
  if (!preparado.ok) return { ok: false, error: preparado.error }

  // `_autor`: quien pidio el cambio (id de Telegram). En un grupo solo esa
  // persona (o un administrador) puede confirmarlo. Va en el payload para no
  // tocar el esquema; confirmar() lo quita antes de ejecutar.
  const payload = ctx.autor ? { ...preparado.payload, _autor: String(ctx.autor) } : preparado.payload

  const fila = await prisma.miloAccion.create({
    data: {
      chatId: String(ctx.chatId),
      userId: ctx.userId ?? null,
      solicitante: ctx.solicitante ? String(ctx.solicitante).slice(0, 60) : null,
      tipo,
      payload,
      resumen: preparado.resumen,
      expiraEn: new Date(Date.now() + TTL_MS),
    },
  })
  console.log(`MILO_ACCION_PROPUESTA: id=${fila.id} tipo=${tipo} chat=${ctx.chatId}`)
  return {
    ok: true,
    accionId: fila.id,
    resumen: preparado.resumen,
    nota: 'Propuesta lista. El cambio NO se ha hecho: el usuario tiene que tocar Confirmar. Termina con action=answer diciendo en una línea qué propusiste.',
  }
}

function botonesDeAccion(accionId) {
  return [[
    { text: '✅ Confirmar', callback_data: `${PREFIJO_CONFIRMAR}:${accionId}` },
    { text: '✖️ Cancelar', callback_data: `${PREFIJO_CANCELAR}:${accionId}` },
  ]]
}

// Tiempo maximo razonable de una ejecucion (la llamada al dashboard tiene un
// timeout de 90 s). Una fila que lleva mas que esto en 'ejecutando' quedo a
// medias: el bot se reinicio o fallo al marcarla.
const ATORADA_MS = 3 * 60 * 1000

function reclamadaEn(fila) {
  const t = fila?.resultado && typeof fila.resultado === 'object' ? Date.parse(fila.resultado.reclamadaEn) : NaN
  return Number.isFinite(t) ? t : fila.createdAt.getTime()
}

// Una fila atorada en 'ejecutando' pasa a 'fallida' marcada como incierta: el
// siguiente toque la reintenta, y yaAplicada() evita duplicar si el cambio si
// se alcanzo a guardar.
async function recuperarSiAtorada(fila) {
  if (fila?.estado !== 'ejecutando' || Date.now() - reclamadaEn(fila) < ATORADA_MS) return fila
  const r = await prisma.miloAccion.updateMany({
    where: { id: fila.id, estado: 'ejecutando' },
    data: { estado: 'fallida', resultado: { error: 'Quedó a medias (el bot se reinició o no respondió).', incierta: true } },
  })
  if (r.count === 1) console.error(`MILO_ACCION_RECUPERADA: id=${fila.id} estaba atorada en ejecutando`)
  return prisma.miloAccion.findUnique({ where: { id: fila.id } })
}

// Reclama la fila: solo UNO de varios toques simultaneos pasa de pendiente a
// ejecutando. Una accion fallida se puede reintentar con el mismo boton; en
// `resultado` queda si es reintento, para revisar que no se duplique.
async function reclamar(fila, chatId) {
  const r = await prisma.miloAccion.updateMany({
    where: { id: fila.id, chatId: String(chatId), estado: { in: ['pendiente', 'fallida'] }, expiraEn: { gt: new Date() } },
    data: { estado: 'ejecutando', resultado: { reclamadaEn: new Date().toISOString(), reintento: fila.estado === 'fallida' } },
  })
  return r.count === 1
}

async function porQueNoSePuede(accionId, chatId) {
  const fila = await prisma.miloAccion.findUnique({ where: { id: accionId } })
  if (!fila || fila.chatId !== String(chatId)) return 'Esa acción no existe.'
  if (fila.estado === 'ejecutada') return 'Esa acción ya se había aplicado.'
  if (fila.estado === 'ejecutando') return 'Esa acción se está aplicando.'
  if (fila.estado === 'cancelada') return 'Esa acción se canceló.'
  if (fila.expiraEn <= new Date() || fila.estado === 'expirada') {
    if (fila.estado !== 'expirada') {
      await prisma.miloAccion.updateMany({ where: { id: accionId, estado: { in: ['pendiente', 'fallida'] } }, data: { estado: 'expirada' } })
    }
    return 'Esa propuesta ya venció (duran 30 minutos). Pídemela otra vez.'
  }
  return 'No pude aplicar esa acción.'
}

// ¿Puede quien toco el boton confirmar esta accion? En un grupo, solo quien la
// pidio o un administrador (MILO_ADMINS, default "Rene"). Sin autor guardado
// (web, o propuestas viejas) no se restringe: el chat ya es del que pregunta.
function puedeConfirmar(fila, quien = {}) {
  const autor = fila.payload && typeof fila.payload === 'object' ? fila.payload._autor : null
  if (!autor || !quien.telegramUserId) return true
  if (String(quien.telegramUserId) === String(autor)) return true
  return Boolean(quien.esAdmin)
}

// Para que Telegram revise ANTES de tocar el mensaje: si no le toca a quien
// presiono, el mensaje con sus botones se queda igual. null = puede.
async function motivoParaNoConfirmar(accionId, chatId, quien = {}) {
  const fila = await prisma.miloAccion.findUnique({ where: { id: parseId(accionId) ?? -1 } })
  if (!fila || fila.chatId !== String(chatId)) return null // confirmar() dara el mensaje de "no existe"
  if (puedeConfirmar(fila, quien)) return null
  return `Solo ${fila.solicitante || 'quien lo pidió'} puede confirmar o cancelar este cambio.`
}

// Administradores: pueden confirmar lo que pidio otra persona en el grupo.
function esAdministrador(nombre) {
  const admins = String(process.env.MILO_ADMINS || 'Rene').split(',').map(n => normalize(n)).filter(Boolean)
  return Boolean(nombre) && admins.includes(normalize(nombre))
}

function sinMetadatos(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const { _autor, ...resto } = payload
  return resto
}

// Devuelve { ok, texto, reintentable } para editar el mensaje del boton.
// `quien` = { telegramUserId, esAdmin } de quien toco (solo Telegram).
async function confirmar({ accionId, chatId, userId = null, actor = 'telegram', canal = 'telegram', quien = {} }) {
  const id = parseId(accionId)
  if (!id) return { ok: false, texto: 'Esa acción no existe.' }

  let fila = await prisma.miloAccion.findUnique({ where: { id } })
  if (!fila || fila.chatId !== String(chatId)) return { ok: false, texto: 'Esa acción no existe.' }
  if (!puedeConfirmar(fila, quien)) {
    return { ok: false, texto: `Solo ${fila.solicitante || 'quien lo pidió'} puede confirmar este cambio.`, reintentable: true, soloAutor: true }
  }
  fila = await recuperarSiAtorada(fila)
  // Antes de reclamar: despues la fila ya dice 'ejecutando'.
  const reintento = fila.estado === 'fallida'

  if (!(await reclamar(fila, chatId))) {
    return { ok: false, texto: await porQueNoSePuede(id, chatId) }
  }

  const def = TIPOS[fila.tipo]
  const payload = sinMetadatos(fila.payload)
  // Quien TOCO el boton, no quien lo pidio: en un grupo pueden ser distintos.
  const ctx = { actor, userId: userId ?? fila.userId ?? null, canal }

  let salida
  try {
    if (!def) throw new Error(`Acción desconocida: ${fila.tipo}`)
    // Un reintento primero revisa si el intento anterior SI se guardo (el
    // dashboard tardo en contestar, el bot se reinicio): no se duplica.
    if (reintento && typeof def.yaAplicada === 'function') salida = await def.yaAplicada(payload, fila)
    if (!salida) salida = await def.ejecutar(payload, ctx)
  } catch (error) {
    console.error(`MILO_ACCION_FALLIDA: id=${id} tipo=${fila.tipo}: ${error.message}`)
    await prisma.miloAccion.update({
      where: { id },
      data: { estado: 'fallida', resultado: { error: error.message } },
    })
    return { ok: false, texto: `❌ No se aplicó: ${error.message}`, reintentable: true }
  }

  // Aparte del try de arriba: si el cambio YA se aplico y lo que falla es
  // marcar la fila, se queda en 'ejecutando'. recuperarSiAtorada() la libera
  // despues de ATORADA_MS y yaAplicada() evita duplicar al reintentar.
  try {
    await prisma.miloAccion.update({
      where: { id },
      data: { estado: 'ejecutada', ejecutadaEn: new Date(), resultado: { ...(salida.resultado || {}), confirmadoPor: actor } },
    })
  } catch (error) {
    console.error(`MILO_ACCION_SIN_MARCAR: id=${id} se aplico pero no se pudo marcar: ${error.message}`)
  }
  console.log(`MILO_ACCION_EJECUTADA: id=${id} tipo=${fila.tipo} por=${actor}`)
  return { ok: true, texto: `✅ ${salida.mensaje}` }
}

async function cancelar({ accionId, chatId, quien = {} }) {
  const id = parseId(accionId)
  if (!id) return { ok: false, texto: 'Esa acción no existe.' }
  const fila = await prisma.miloAccion.findUnique({ where: { id } })
  if (fila && fila.chatId === String(chatId) && !puedeConfirmar(fila, quien)) {
    return { ok: false, texto: `Solo ${fila.solicitante || 'quien lo pidió'} puede cancelar este cambio.`, reintentable: true, soloAutor: true }
  }
  const r = await prisma.miloAccion.updateMany({
    where: { id, chatId: String(chatId), estado: { in: ['pendiente', 'fallida'] } },
    data: { estado: 'cancelada' },
  })
  if (r.count === 1) return { ok: true, texto: 'Cancelado. No cambié nada.' }
  return { ok: false, texto: await porQueNoSePuede(id, chatId) }
}

async function resumenDe(accionId) {
  const fila = await prisma.miloAccion.findUnique({ where: { id: parseId(accionId) } })
  return fila?.resumen || null
}

module.exports = {
  proponer,
  confirmar,
  cancelar,
  motivoParaNoConfirmar,
  esAdministrador,
  resumenDe,
  botonesDeAccion,
  ACCIONES_CALLBACK,
  PREFIJO_CONFIRMAR,
  PREFIJO_CANCELAR,
  TIPOS_DISPONIBLES: Object.keys(TIPOS),
  _interno: { parseFecha, parseMonto, parseSaldo, parseId, elegirPorNombre, huella, huellaCorte, jsonCanonico, mismaHuella, puedeConfirmar, sinMetadatos, recuperarSiAtorada, TTL_MS, ATORADA_MS },
}
