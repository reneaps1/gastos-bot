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
    estatus: tx.estatus,
  }
}

function mismaHuella(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function cargarMovimiento(id) {
  return prisma.transaccion.findUnique({
    where: { id },
    include: { categoria: true, presupuesto: true, metodoPago: true, quincena: true },
  })
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

    async ejecutar(payload, ctx) {
      const creada = await dashboardApi.llamar('POST', '/api/transacciones', {
        body: { ...payload, source: 'telegram' },
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
}

// ---- Proponer / confirmar / cancelar ------------------------------------------------

async function proponer(tipo, args, ctx = {}) {
  const def = TIPOS[tipo]
  if (!def) return { ok: false, error: `Acción desconocida: ${tipo}` }
  if (ctx.chatId == null) return { ok: false, error: 'Solo puedo proponer cambios desde Telegram.' }

  const preparado = await def.preparar(args || {}, ctx)
  if (!preparado.ok) return { ok: false, error: preparado.error }

  const fila = await prisma.miloAccion.create({
    data: {
      chatId: String(ctx.chatId),
      userId: ctx.userId ?? null,
      solicitante: ctx.solicitante ? String(ctx.solicitante).slice(0, 60) : null,
      tipo,
      payload: preparado.payload,
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

// Reclama la fila: solo UNO de varios toques simultaneos pasa de pendiente a
// ejecutando. Una accion fallida se puede reintentar con el mismo boton.
async function reclamar(accionId, chatId) {
  const r = await prisma.miloAccion.updateMany({
    where: { id: accionId, chatId: String(chatId), estado: { in: ['pendiente', 'fallida'] }, expiraEn: { gt: new Date() } },
    data: { estado: 'ejecutando' },
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

// Devuelve { ok, texto, reintentable } para editar el mensaje del boton.
async function confirmar({ accionId, chatId, userId = null, actor = 'telegram' }) {
  const id = parseId(accionId)
  if (!id) return { ok: false, texto: 'Esa acción no existe.' }

  if (!(await reclamar(id, chatId))) {
    return { ok: false, texto: await porQueNoSePuede(id, chatId) }
  }

  const fila = await prisma.miloAccion.findUnique({ where: { id } })
  const def = TIPOS[fila.tipo]
  // Quien TOCO el boton, no quien lo pidio: en un grupo pueden ser distintos.
  const ctx = { actor, userId: userId ?? fila.userId ?? null }

  let salida
  try {
    if (!def) throw new Error(`Acción desconocida: ${fila.tipo}`)
    salida = await def.ejecutar(fila.payload, ctx)
  } catch (error) {
    console.error(`MILO_ACCION_FALLIDA: id=${id} tipo=${fila.tipo}: ${error.message}`)
    await prisma.miloAccion.update({
      where: { id },
      data: { estado: 'fallida', resultado: { error: error.message } },
    })
    return { ok: false, texto: `❌ No se aplicó: ${error.message}`, reintentable: true }
  }

  // Aparte del try de arriba: si el cambio YA se aplico y lo que falla es
  // marcar la fila, no debe quedar como 'fallida' (reintentarla duplicaria un
  // registro). Se queda en 'ejecutando', que no se puede volver a reclamar.
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

async function cancelar({ accionId, chatId }) {
  const id = parseId(accionId)
  if (!id) return { ok: false, texto: 'Esa acción no existe.' }
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
  resumenDe,
  botonesDeAccion,
  ACCIONES_CALLBACK,
  PREFIJO_CONFIRMAR,
  PREFIJO_CANCELAR,
  TIPOS_DISPONIBLES: Object.keys(TIPOS),
  _interno: { parseFecha, parseMonto, parseId, elegirPorNombre, huella, TTL_MS },
}
