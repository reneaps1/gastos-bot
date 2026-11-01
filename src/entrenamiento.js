// Sesion de entrenamiento del clasificador por Telegram.
//
// El usuario escribe "vamos a entrenar" y el bot le muestra sus gastos UNO POR
// UNO, del mas reciente al mas viejo, con la categoria que el cree. El
// usuario confirma o corrige con un toque y el modelo aprende en ese momento
// (src/clasificador). Todo pasa en UN mensaje que se va editando: el chat no
// se llena de mensajes.
//
// SIN ESTADO: cada boton lleva el id del gasto que se esta viendo, y "el
// siguiente" es el gasto de tipo Gasto con el id inmediato menor que todavia
// no tiene respuesta. La sesion sobrevive a que Render duerma o reinicie el
// servicio, y no hay nada que expirar.
//
//   ea:<tx>:<cat>:<f>           si, es esa categoria (f = m modelo | r reglas)
//   eo:<tx>:<cat>:<f>           no: ver las otras categorias
//   ec:<tx>:<cat>:<prop>:<f>    esta es la correcta
//   eb:<tx>                     volver al gasto
//   es:<tx>                     saltar
//   ef:0                        terminar
//
// callback_data no es confiable: el cambio de categoria pasa por
// correctTransactionCategory, que revalida todo contra la base. Aqui si se
// permite cambiar la categoria de un gasto que ya tiene linea: es una decision
// explicita del usuario, revisando gasto por gasto, y deja un estado valido
// (el mismo que el boton "No, dejarlo en X" del cruce).

const prisma = require('./lib/prisma')
const telegram = require('./telegram')
const clasificador = require('./clasificador')
const { normalizar } = require('./clasificador/modelo')
const { correctTransactionCategory, describeRechazo } = require('./budgetActions')

const ACCIONES = new Set(['ea', 'eo', 'ec', 'eb', 'es', 'ef'])
const LOTE = 50

function esPedidoDeEntrenar(texto) {
  // El mensaje tiene que ser SOLO la frase: "entrenamiento de futbol 300" es
  // un gasto, no una sesion.
  return /^\s*[¡!]*\s*\/?\s*(vamos\s+a\s+|a\s+|quiero\s+)?entren(a|ar|ame|emos|amiento)\s*[!.¡]*\s*$/i.test(String(texto || ''))
}

function fecha(d) {
  const f = new Date(d)
  return `${f.getUTCDate()}/${f.getUTCMonth() + 1}/${f.getUTCFullYear()}`
}

// El siguiente gasto por revisar: el de id inmediato menor que `antesDe` que
// no tenga ya una respuesta (aceptada o corregida) y cuya descripcion tenga
// letras (no hay nada que aprender de "$200").
async function siguiente(antesDe = null) {
  let cursor = antesDe == null ? null : Number(antesDe)
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const lote = await prisma.transaccion.findMany({
      where: { tipo: 'Gasto', ...(cursor == null ? {} : { id: { lt: cursor } }) },
      orderBy: { id: 'desc' },
      take: LOTE,
      include: { categoria: true },
    })
    if (!lote.length) return null
    const resueltas = await prisma.clasificacionFeedback.findMany({
      where: { transaccionId: { in: lote.map(t => t.id) }, estado: { in: ['aceptada', 'corregida'] } },
      select: { transaccionId: true },
    })
    const hechas = new Set(resueltas.map(r => r.transaccionId))
    const tx = lote.find(t => !hechas.has(t.id) && normalizar(t.descripcion).length > 0)
    if (tx) return tx
    cursor = lote[lote.length - 1].id
  }
  return null
}

async function categoriasDeGasto() {
  return prisma.categoria.findMany({ where: { activo: true, tipo: 'Gasto' }, orderBy: { nombre: 'asc' } })
}

// Lo que el bot cree: el modelo si tiene opinion; si no, la categoria con la
// que el gasto se guardo (la que decidieron las reglas o la IA en su momento).
async function prediccion(tx, cats) {
  const op = await clasificador.opinar(tx.descripcion)
  const delModelo = op && cats.find(c => c.id === op.categoriaId)
  if (delModelo) return { categoria: delModelo, fuente: 'm', confianza: op.confianza }
  return { categoria: tx.categoria, fuente: 'r', confianza: null }
}

async function vistaGasto(tx, encabezado = null) {
  const cats = await categoriasDeGasto()
  const p = await prediccion(tx, cats)
  const seguro = p.confianza == null ? '' : ` _(${Math.min(99, Math.round(p.confianza * 100))} % seguro)_`
  const lineas = ['🧠 *Entrenamiento*']
  if (encabezado) lineas.push(encabezado)
  lineas.push(
    '',
    `*$${Number(tx.monto).toFixed(2)} — ${telegram.escapeMarkdown(tx.descripcion)}*`,
    `📅 ${fecha(tx.fecha)}`,
    '',
    `¿Es de *${telegram.escapeMarkdown(p.categoria?.nombre || '')}*?${seguro}`,
  )
  if (p.categoria?.id !== tx.categoriaId) {
    lineas.push(`_Ahora está en ${telegram.escapeMarkdown(tx.categoria?.nombre || '')}._`)
  }
  const cat = p.categoria?.id
  return {
    texto: lineas.join('\n'),
    buttons: [
      [
        { text: '✅ Sí', callback_data: `ea:${tx.id}:${cat}:${p.fuente}` },
        { text: '✏️ Otra', callback_data: `eo:${tx.id}:${cat}:${p.fuente}` },
      ],
      [
        { text: '⏭ Saltar', callback_data: `es:${tx.id}` },
        { text: '🏁 Terminar', callback_data: 'ef:0' },
      ],
    ],
  }
}

async function vistaFin(encabezado = null) {
  const m = await clasificador.marcador()
  const lineas = ['🏁 *Entrenamiento terminado*']
  if (encabezado) lineas.push(encabezado)
  if (m?.respuestas) {
    const gastos = m.respuestas === 1 ? '1 gasto confirmado' : `${m.respuestas} gastos confirmados`
    lineas.push('', `Llevo ${gastos} y acerté en ${Math.round((100 * m.aceptadas) / m.respuestas)} %.`)
  }
  lineas.push('', 'Escribe «vamos a entrenar» cuando quieras seguir.')
  return { texto: lineas.join('\n'), buttons: null }
}

async function mostrarSiguiente(callback, antesDe, encabezado) {
  const tx = await siguiente(antesDe)
  const vista = tx ? await vistaGasto(tx, encabezado) : await vistaFin(`${encabezado ? `${encabezado}\n\n` : ''}Ya no quedan gastos por revisar.`)
  await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
}

// "vamos a entrenar"
async function iniciar(message) {
  const tx = await siguiente(null)
  if (!tx) {
    await telegram.sendTelegramMessage(message.chatId, 'No hay gastos por revisar. ¡Ya me enseñaste todos!', message.messageId)
    return
  }
  const vista = await vistaGasto(tx, 'Te muestro tus gastos del más reciente al más viejo. Confirma o corrige: aprendo con cada uno.')
  await telegram.sendTelegramMessage(message.chatId, vista.texto, message.messageId, { buttons: vista.buttons })
  console.log(`TELEGRAM_ENTRENAMIENTO_INICIO: chat=${message.chatId}; primero=${tx.id}`)
}

async function aplicar(callback, tx, { propuestaId, finalId, fuente }) {
  const nombre = telegram.escapeMarkdown(tx.descripcion)
  if (finalId !== tx.categoriaId) {
    const r = await correctTransactionCategory({ transaccionId: tx.id, categoriaId: finalId, permitirEnlazada: true })
    if (!r.ok) {
      await mostrarSiguiente(callback, tx.id, `⚠️ «${nombre}»: ${describeRechazo(r.reason)}`)
      return
    }
  }
  await clasificador.confirmar({
    transaccionId: tx.id,
    texto: tx.descripcion,
    categoriaPropuestaId: propuestaId,
    categoriaFinalId: finalId,
    fuente: fuente === 'm' ? 'modelo' : 'reglas',
  })
  const cat = await prisma.categoria.findUnique({ where: { id: finalId } })
  const marca = propuestaId === finalId ? '✅' : '✏️'
  await mostrarSiguiente(callback, tx.id, `${marca} «${nombre}» → ${telegram.escapeMarkdown(cat?.nombre || '')}`)
}

async function handleCallback(callback) {
  const [accion, txId, a, b, c] = callback.data.split(':')
  console.log(`TELEGRAM_ENTRENAMIENTO: accion=${accion} tx=${txId} chat=${callback.chatId}`)

  if (accion === 'ef') {
    const vista = await vistaFin()
    await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
    return
  }
  if (accion === 'es') {
    await mostrarSiguiente(callback, txId, `⏭ Saltado.`)
    return
  }

  const tx = await prisma.transaccion.findUnique({ where: { id: Number(txId) }, include: { categoria: true } })
  if (!tx || tx.tipo !== 'Gasto') {
    await mostrarSiguiente(callback, txId, `⚠️ ${describeRechazo('TX_NO_EXISTE')}`)
    return
  }

  if (accion === 'eb') {
    const vista = await vistaGasto(tx)
    await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
    return
  }

  if (accion === 'eo') {
    const cats = await categoriasDeGasto()
    const propuestaId = Number(a)
    const opciones = cats.filter(x => x.id !== propuestaId)
    const rows = []
    for (let i = 0; i < opciones.length; i += 2) {
      rows.push(opciones.slice(i, i + 2).map(x => ({ text: x.nombre, callback_data: `ec:${tx.id}:${x.id}:${propuestaId}:${b === 'm' ? 'm' : 'r'}` })))
    }
    rows.push([{ text: '◀ Volver', callback_data: `eb:${tx.id}` }])
    await telegram.editMessageText(
      callback.chatId,
      callback.messageId,
      `🧠 *Entrenamiento*\n\n*$${Number(tx.monto).toFixed(2)} — ${telegram.escapeMarkdown(tx.descripcion)}*\n\n¿De qué categoría es?`,
      { buttons: rows },
    )
    return
  }

  if (accion === 'ea') {
    await aplicar(callback, tx, { propuestaId: Number(a), finalId: Number(a), fuente: b })
    return
  }

  if (accion === 'ec') {
    await aplicar(callback, tx, { propuestaId: Number(b), finalId: Number(a), fuente: c })
  }
}

module.exports = { ACCIONES, esPedidoDeEntrenar, iniciar, handleCallback, siguiente }
