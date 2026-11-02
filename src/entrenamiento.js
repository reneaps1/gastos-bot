// Sesion de entrenamiento por Telegram: la LINEA de presupuesto.
//
// El usuario escribe "vamos a entrenar" y el bot le muestra, UNO POR UNO y del
// mas reciente al mas viejo, los gastos que todavia no tienen linea, con la
// linea que el cree. El usuario confirma o elige otra con un toque y el modelo
// aprende en ese momento (src/clasificador). Todo pasa en UN mensaje que se
// va editando: el chat no se llena de mensajes.
//
// SOLO LINEA (decision del usuario, 2026-11-02): en el bot lo util es la
// linea; la categoria es para el dashboard y sigue a la linea (assignLine en
// src/budgetActions.js). Al asignar, la categoria del gasto queda igual a la
// de la linea, y esa categoria tambien se guarda como respuesta para el
// modelo de categoria (que propone la categoria de los gastos nuevos).
//
// QUE GASTOS SALEN: tipo Gasto, sin linea, con al menos una linea posible en
// su quincena, y con letras en la descripcion (no hay nada que aprender de
// "$200"). Un gasto con linea ya la eligio una persona: no hay nada que
// confirmar.
//
// SIN ESTADO: cada boton lleva el id del gasto que se esta viendo, y "el
// siguiente" es el gasto que cumple lo de arriba con el id inmediato menor.
// La sesion sobrevive a que Render duerma o reinicie el servicio.
//
//   em:g / em:p         menu de "vamos a entrenar": g = gastos (este archivo),
//                       p = palabras (src/entrenamientoPalabras.js)
//   ea:<tx>:<linea>     si, esa linea
//   el:<tx>:<pagina>    elegir otra linea (menu paginado)
//   en:<tx>:<linea>     esta es la linea
//   eb:<tx>             volver al gasto
//   es:<tx>             saltar
//   ef:0                terminar
//   eo, ec              botones de categoria de la version anterior: si llega
//                       uno de un mensaje viejo, se redibuja el gasto
//
// callback_data no es confiable: assignLine pasa por linkTransactionToBudget y
// alignTransactionCategory, que revalidan todo contra la base (mismo tipo,
// misma quincena, linea no cancelada).

const prisma = require('./lib/prisma')
const telegram = require('./telegram')
const clasificador = require('./clasificador')
const { normalizar } = require('./clasificador/modelo')
const { lineasPara } = require('./sugerenciaLinea')
const { assignLine, describeRechazo } = require('./budgetActions')
const palabras = require('./entrenamientoPalabras')

const ACCIONES = new Set(['em', 'ea', 'el', 'en', 'eb', 'es', 'ef', 'eo', 'ec'])
const LOTE = 50
const LINEAS_POR_PAGINA = 6

function esPedidoDeEntrenar(texto) {
  // El mensaje tiene que ser SOLO la frase: "entrenamiento de futbol 300" es
  // un gasto, no una sesion.
  return /^\s*[¡!]*\s*\/?\s*(vamos\s+a\s+|a\s+|quiero\s+)?entren(a|ar|ame|emos|amiento)\s*[!.¡]*\s*$/i.test(String(texto || ''))
}

function fecha(d) {
  const f = new Date(d)
  return `${f.getUTCDate()}/${f.getUTCMonth() + 1}/${f.getUTCFullYear()}`
}

const esc = t => telegram.escapeMarkdown(String(t ?? ''))

function pct(confianza) {
  return confianza == null ? '' : ` _(${Math.min(99, Math.round(confianza * 100))} %)_`
}

// El siguiente gasto por revisar, con sus lineas posibles ya calculadas.
async function siguiente(antesDe = null) {
  let cursor = antesDe == null ? null : Number(antesDe)
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const lote = await prisma.transaccion.findMany({
      where: { tipo: 'Gasto', presupuestoId: null, ...(cursor == null ? {} : { id: { lt: cursor } }) },
      orderBy: { id: 'desc' },
      take: LOTE,
      include: { categoria: true },
    })
    if (!lote.length) return null
    for (const tx of lote) {
      if (!normalizar(tx.descripcion).length) continue
      const lineas = await lineasPara(tx)
      if (lineas.candidatas.length) return { tx, ...lineas }
    }
    cursor = lote[lote.length - 1].id
  }
  return null
}

function vistaGasto({ tx, candidatas, sugeridaId, sugeridaConfianza }, encabezado = null) {
  const sugerida = candidatas.find(c => c.id === sugeridaId) || null
  const lineas = ['🧠 *Entrenamiento*']
  if (encabezado) lineas.push(encabezado)
  lineas.push('', `*$${Number(tx.monto).toFixed(2)} — ${esc(tx.descripcion)}*`, `📅 ${fecha(tx.fecha)}`, '')
  lineas.push(sugerida
    ? `📂 ¿*${esc(sugerida.descripcion)}*?${pct(sugeridaConfianza)}`
    : '📂 No sé a qué línea va. ¿Me dices?')

  const primera = sugerida
    ? [
        { text: '✅ Sí', callback_data: `ea:${tx.id}:${sugerida.id}` },
        { text: '✏️ Otra línea', callback_data: `el:${tx.id}:0` },
      ]
    : [{ text: '📂 Elegir línea', callback_data: `el:${tx.id}:0` }]

  return {
    texto: lineas.join('\n'),
    buttons: [
      primera,
      [
        { text: '⏭ Saltar', callback_data: `es:${tx.id}` },
        { text: '🏁 Terminar', callback_data: 'ef:0' },
      ],
    ],
  }
}

function vistaFin(encabezado = null) {
  const lineas = ['🏁 *Entrenamiento terminado*']
  if (encabezado) lineas.push(encabezado)
  lineas.push('', 'Escribe «vamos a entrenar» cuando quieras seguir.')
  return { texto: lineas.join('\n'), buttons: null }
}

async function editar(callback, vista) {
  await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
}

async function mostrarSiguiente(callback, antesDe, encabezado) {
  const item = await siguiente(antesDe)
  await editar(callback, item
    ? vistaGasto(item, encabezado)
    : vistaFin(`${encabezado ? `${encabezado}\n\n` : ''}Ya no quedan gastos sin línea.`))
}

// "vamos a entrenar": primero se elige el estilo.
async function iniciar(message) {
  await telegram.sendTelegramMessage(
    message.chatId,
    '🧠 *¿Cómo entrenamos?*\n\n📋 *Tú me muestras gastos*: te enseño tus gastos sin línea y me dices a cuál va cada uno.\n\n✍️ *Yo te escribo palabras*: tú me escribes palabras sueltas y yo adivino la línea. Más retador.',
    message.messageId,
    { buttons: [[{ text: '📋 Tú me muestras gastos', callback_data: 'em:g' }], [{ text: '✍️ Yo te escribo palabras', callback_data: 'em:p' }]] },
  )
  console.log(`TELEGRAM_ENTRENAMIENTO_MENU: chat=${message.chatId}`)
}

// Modo "Tu me muestras gastos" (boton em:g).
async function iniciarGastos(callback) {
  palabras.salir(callback.chatId)
  const item = await siguiente(null)
  if (!item) {
    await editar(callback, vistaFin('No hay gastos sin línea por revisar. ¡Todo está asignado!'))
    return
  }
  await editar(callback, vistaGasto(item, 'Te muestro tus gastos sin línea, del más reciente al más viejo. Confirma o elige otra: aprendo con cada uno.'))
  console.log(`TELEGRAM_ENTRENAMIENTO_INICIO: chat=${callback.chatId}; primero=${item.tx.id}`)
}

// Asigna la linea (la categoria la sigue) y los dos modelos aprenden.
async function asignar(callback, tx, lineaId) {
  const r = await assignLine({ transaccionId: tx.id, presupuestoId: lineaId })
  if (!r.ok) {
    await mostrarSiguiente(callback, tx.id, `⚠️ «${esc(tx.descripcion)}»: ${describeRechazo(r.reason)}`)
    return
  }
  if (!r.yaEstaba) clasificador.aprenderLinea(tx.descripcion, r.linea.descripcion)
  if (r.linea.categoriaId != null) {
    await clasificador.confirmar({
      transaccionId: tx.id,
      texto: tx.descripcion,
      categoriaPropuestaId: tx.categoriaId,
      categoriaFinalId: r.linea.categoriaId,
      fuente: 'reglas',
    })
  }
  await mostrarSiguiente(callback, tx.id, `✅ «${esc(tx.descripcion)}» → ${esc(r.linea.descripcion)}`)
}

async function menuLineas(callback, tx, pagina) {
  const { candidatas, sugeridaId } = await lineasPara(tx)
  const total = Math.max(1, Math.ceil(candidatas.length / LINEAS_POR_PAGINA))
  const p = Math.min(Math.max(0, Number(pagina) || 0), total - 1)
  const rows = candidatas.slice(p * LINEAS_POR_PAGINA, (p + 1) * LINEAS_POR_PAGINA).map(c => [{
    text: `${c.id === sugeridaId ? '⭐ ' : ''}${c.descripcion}${c.categoriaNombre ? ` · ${c.categoriaNombre}` : ''}`.slice(0, 60),
    callback_data: `en:${tx.id}:${c.id}`,
  }])
  const nav = []
  if (p > 0) nav.push({ text: '« Anterior', callback_data: `el:${tx.id}:${p - 1}` })
  if (p < total - 1) nav.push({ text: `Ver más » (${p + 1}/${total})`, callback_data: `el:${tx.id}:${p + 1}` })
  if (nav.length) rows.push(nav)
  rows.push([{ text: '◀ Volver', callback_data: `eb:${tx.id}` }])
  await editar(callback, {
    texto: `🧠 *Entrenamiento*\n\n*$${Number(tx.monto).toFixed(2)} — ${esc(tx.descripcion)}*\n\n¿A qué línea va?`,
    buttons: rows,
  })
}

async function handleCallback(callback) {
  const [accion, txId, a] = callback.data.split(':')
  console.log(`TELEGRAM_ENTRENAMIENTO: accion=${accion} tx=${txId} chat=${callback.chatId}`)

  if (accion === 'em') {
    if (txId === 'p') await palabras.entrar(callback)
    else await iniciarGastos(callback)
    return
  }
  if (accion === 'ef') {
    await editar(callback, vistaFin())
    return
  }
  if (accion === 'es') {
    await mostrarSiguiente(callback, txId, '⏭ Saltado.')
    return
  }

  const tx = await prisma.transaccion.findUnique({ where: { id: Number(txId) }, include: { categoria: true } })
  if (!tx || tx.tipo !== 'Gasto') {
    await mostrarSiguiente(callback, txId, `⚠️ ${describeRechazo('TX_NO_EXISTE')}`)
    return
  }

  if (accion === 'el') {
    await menuLineas(callback, tx, a)
    return
  }
  if (accion === 'ea' || accion === 'en') {
    await asignar(callback, tx, Number(a))
    return
  }

  // 'eb', y los botones de categoria de un mensaje viejo ('eo', 'ec'): se
  // redibuja el gasto; si ya tiene linea, se pasa al siguiente.
  if (tx.presupuestoId != null) {
    await mostrarSiguiente(callback, tx.id, null)
    return
  }
  await editar(callback, vistaGasto({ tx, ...(await lineasPara(tx)) }))
}

module.exports = { ACCIONES, esPedidoDeEntrenar, iniciar, handleCallback, siguiente }
