// Sesion de entrenamiento del clasificador por Telegram: CATEGORIA y LINEA.
//
// El usuario escribe "vamos a entrenar" y el bot le muestra sus gastos UNO POR
// UNO, del mas reciente al mas viejo, con la categoria y la linea de
// presupuesto que el cree. El usuario confirma o corrige con un toque y los
// dos modelos aprenden en ese momento (src/clasificador). Todo pasa en UN
// mensaje que se va editando: el chat no se llena de mensajes.
//
// CADA GASTO TIENE DOS PARTES, y cada una puede estar resuelta o no:
//   - categoria: resuelta si el gasto ya tiene respuesta en
//     clasificacion_feedback (aceptada o corregida).
//   - linea: resuelta si el gasto ya tiene linea. El bot NUNCA enlaza solo,
//     asi que una linea existente la eligio una persona.
// "Si" confirma lo que falte y pasa al siguiente; corregir una parte regresa
// al MISMO gasto con esa parte resuelta, y cuando ya no falta nada avanza solo.
//
// SIN ESTADO: cada boton lleva el id del gasto que se esta viendo, y "el
// siguiente" es el gasto de tipo Gasto con el id inmediato menor cuya
// categoria no tiene respuesta. La sesion sobrevive a que Render duerma o
// reinicie el servicio, y no hay nada que expirar.
//
//   ea:<tx>:<cat|0>:<f>:<linea|0>  si: confirma la categoria y enlaza la linea
//                                  sugerida (0 = esa parte ya esta resuelta)
//   eo:<tx>:<cat>:<f>              corregir categoria: menu
//   ec:<tx>:<cat>:<prop>:<f>       esta es la categoria correcta
//   el:<tx>:<pagina>               corregir linea: menu (paginado)
//   en:<tx>:<linea>                esta es la linea correcta
//   eb:<tx>                        volver al gasto
//   es:<tx>                        saltar / siguiente
//   ef:0                           terminar
//   (f = m modelo | r reglas: de donde salio la categoria propuesta)
//
// callback_data no es confiable: la categoria pasa por
// correctTransactionCategory y la linea por linkTransactionToBudget, que
// revalidan todo contra la base (mismo tipo, misma quincena, linea no
// cancelada). Aqui si se permite cambiar la categoria de un gasto que ya tiene
// linea, y cambiar una linea por otra: son decisiones explicitas del usuario,
// revisando gasto por gasto, y dejan estados validos.

const prisma = require('./lib/prisma')
const telegram = require('./telegram')
const clasificador = require('./clasificador')
const { normalizar } = require('./clasificador/modelo')
const { lineasPara } = require('./sugerenciaLinea')
const { correctTransactionCategory, linkTransactionToBudget, describeRechazo } = require('./budgetActions')

const ACCIONES = new Set(['ea', 'eo', 'ec', 'el', 'en', 'eb', 'es', 'ef'])
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

function pct(confianza) {
  return confianza == null ? '' : ` _(${Math.min(99, Math.round(confianza * 100))} %)_`
}

const esc = t => telegram.escapeMarkdown(String(t ?? ''))

// El siguiente gasto por revisar: el de id inmediato menor que `antesDe` cuya
// categoria no tenga respuesta todavia, y cuya descripcion tenga letras (no
// hay nada que aprender de "$200").
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

async function leerGasto(txId) {
  const tx = await prisma.transaccion.findUnique({
    where: { id: Number(txId) },
    include: { categoria: true, presupuesto: true },
  })
  return tx && tx.tipo === 'Gasto' ? tx : null
}

async function categoriaResuelta(txId) {
  const fb = await prisma.clasificacionFeedback.findUnique({ where: { transaccionId: Number(txId) } })
  return Boolean(fb && (fb.estado === 'aceptada' || fb.estado === 'corregida'))
}

async function categoriasDeGasto() {
  return prisma.categoria.findMany({ where: { activo: true, tipo: 'Gasto' }, orderBy: { nombre: 'asc' } })
}

// La categoria que el bot cree: el modelo si tiene opinion; si no, la
// categoria con la que el gasto se guardo (la que decidieron las reglas o la
// IA en su momento).
async function prediccionCategoria(tx) {
  const cats = await categoriasDeGasto()
  const op = await clasificador.opinar(tx.descripcion)
  const delModelo = op && cats.find(c => c.id === op.categoriaId)
  if (delModelo) return { categoria: delModelo, fuente: 'm', confianza: op.confianza }
  return { categoria: tx.categoria, fuente: 'r', confianza: null }
}

// Todo lo que hace falta para dibujar un gasto (o saber que ya no falta nada).
async function estadoDe(tx) {
  const catLista = await categoriaResuelta(tx.id)
  const cat = catLista ? null : await prediccionCategoria(tx)
  const lineaLista = tx.presupuestoId != null
  // La linea se sugiere con la categoria que se esta PROPONIENDO, no con la
  // guardada: si el bot cree que es Super, la regla tiene que buscar entre
  // las lineas de Super.
  const categoriaId = cat?.categoria?.id ?? tx.categoriaId
  const { candidatas, sugeridaId, sugeridaConfianza } = await lineasPara({ ...tx, categoriaId })
  const sugerida = lineaLista ? null : candidatas.find(c => c.id === sugeridaId) || null
  return { catLista, cat, lineaLista, candidatas, sugerida, sugeridaConfianza }
}

function vistaGasto(tx, e, encabezado = null) {
  const lineas = ['🧠 *Entrenamiento*']
  if (encabezado) lineas.push(encabezado)
  lineas.push('', `*$${Number(tx.monto).toFixed(2)} — ${esc(tx.descripcion)}*`, `📅 ${fecha(tx.fecha)}`, '')

  if (e.catLista) {
    lineas.push(`🏷️ Categoría: *${esc(tx.categoria?.nombre)}* ✓`)
  } else {
    lineas.push(`🏷️ Categoría: ¿*${esc(e.cat.categoria?.nombre)}*?${pct(e.cat.confianza)}`)
    if (e.cat.categoria?.id !== tx.categoriaId) lineas.push(`_Ahora está en ${esc(tx.categoria?.nombre)}._`)
  }

  if (e.lineaLista) {
    lineas.push(`📂 Línea: *${esc(tx.presupuesto?.descripcion)}* ✓`)
  } else if (e.sugerida) {
    lineas.push(`📂 Línea: ¿*${esc(e.sugerida.descripcion)}*?${pct(e.sugeridaConfianza)}`)
  } else if (e.candidatas.length) {
    lineas.push('📂 Línea: _sin sugerencia; elígela con «✏️ Línea»_')
  } else {
    lineas.push('📂 Línea: _no hay líneas en esa quincena_')
  }

  // "Si" confirma lo que falte. Si no falta nada que confirmar (categoria lista
  // y sin linea sugerida), el boton solo avanza.
  const cat = e.catLista ? 0 : e.cat.categoria?.id
  const linea = e.sugerida ? e.sugerida.id : 0
  const fuente = e.catLista ? 'r' : e.cat.fuente
  const si = cat || linea
    ? { text: '✅ Sí', callback_data: `ea:${tx.id}:${cat}:${fuente}:${linea}` }
    : { text: '➡️ Siguiente', callback_data: `es:${tx.id}` }

  const corregir = [{ text: '✏️ Categoría', callback_data: `eo:${tx.id}:${e.catLista ? tx.categoriaId : cat}:${fuente}` }]
  if (e.candidatas.length) corregir.push({ text: '✏️ Línea', callback_data: `el:${tx.id}:0` })

  return {
    texto: lineas.join('\n'),
    buttons: [
      [si],
      corregir,
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
    lineas.push('', `Llevo ${gastos} y acerté la categoría en ${Math.round((100 * m.aceptadas) / m.respuestas)} %.`)
  }
  lineas.push('', 'Escribe «vamos a entrenar» cuando quieras seguir.')
  return { texto: lineas.join('\n'), buttons: null }
}

async function editar(callback, vista) {
  await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
}

async function mostrarSiguiente(callback, antesDe, encabezado) {
  const tx = await siguiente(antesDe)
  if (!tx) {
    await editar(callback, await vistaFin(`${encabezado ? `${encabezado}\n\n` : ''}Ya no quedan gastos por revisar.`))
    return
  }
  const completo = await leerGasto(tx.id)
  await editar(callback, vistaGasto(completo, await estadoDe(completo), encabezado))
}

// Vuelve a dibujar el MISMO gasto; si ya no le falta nada, pasa al siguiente.
async function mostrarGastoOSiguiente(callback, txId, encabezado) {
  const tx = await leerGasto(txId)
  if (!tx) {
    await mostrarSiguiente(callback, txId, encabezado)
    return
  }
  const e = await estadoDe(tx)
  if (e.catLista && (e.lineaLista || !e.candidatas.length)) {
    await mostrarSiguiente(callback, tx.id, encabezado)
    return
  }
  await editar(callback, vistaGasto(tx, e, encabezado))
}

// "vamos a entrenar"
async function iniciar(message) {
  const primero = await siguiente(null)
  if (!primero) {
    await telegram.sendTelegramMessage(message.chatId, 'No hay gastos por revisar. ¡Ya me enseñaste todos!', message.messageId)
    return
  }
  const tx = await leerGasto(primero.id)
  const vista = vistaGasto(tx, await estadoDe(tx), 'Te muestro tus gastos del más reciente al más viejo, con su categoría y su línea. Confirma o corrige: aprendo con cada uno.')
  await telegram.sendTelegramMessage(message.chatId, vista.texto, message.messageId, { buttons: vista.buttons })
  console.log(`TELEGRAM_ENTRENAMIENTO_INICIO: chat=${message.chatId}; primero=${tx.id}`)
}

// Confirma (o corrige) la categoria. Devuelve el texto para el encabezado, o
// el rechazo.
async function aplicarCategoria(tx, { propuestaId, finalId, fuente }) {
  if (finalId !== tx.categoriaId) {
    const r = await correctTransactionCategory({ transaccionId: tx.id, categoriaId: finalId, permitirEnlazada: true })
    if (!r.ok) return { ok: false, texto: `⚠️ «${esc(tx.descripcion)}»: ${describeRechazo(r.reason)}` }
  }
  await clasificador.confirmar({
    transaccionId: tx.id,
    texto: tx.descripcion,
    categoriaPropuestaId: propuestaId,
    categoriaFinalId: finalId,
    fuente: fuente === 'm' ? 'modelo' : 'reglas',
  })
  const cat = await prisma.categoria.findUnique({ where: { id: finalId } })
  return { ok: true, nombre: cat?.nombre || '', corregida: propuestaId !== finalId }
}

// Enlaza la linea (o la cambia) y el modelo de lineas aprende.
async function aplicarLinea(tx, lineaId) {
  const r = await linkTransactionToBudget({ transaccionId: tx.id, presupuestoId: lineaId })
  if (!r.ok) return { ok: false, texto: `⚠️ «${esc(tx.descripcion)}»: ${describeRechazo(r.reason)}` }
  if (!r.yaEstaba) clasificador.aprenderLinea(tx.descripcion, r.linea.descripcion)
  return { ok: true, nombre: r.linea.descripcion }
}

async function menuLineas(callback, tx, pagina) {
  const { candidatas, sugeridaId } = await lineasPara(tx)
  const total = Math.max(1, Math.ceil(candidatas.length / LINEAS_POR_PAGINA))
  const p = Math.min(Math.max(0, Number(pagina) || 0), total - 1)
  const rows = candidatas.slice(p * LINEAS_POR_PAGINA, (p + 1) * LINEAS_POR_PAGINA).map(c => [{
    text: `${c.id === sugeridaId ? '⭐ ' : ''}${c.id === tx.presupuestoId ? '✓ ' : ''}${c.descripcion}${c.categoriaNombre ? ` · ${c.categoriaNombre}` : ''}`.slice(0, 60),
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
  const [accion, txId, a, b, c] = callback.data.split(':')
  console.log(`TELEGRAM_ENTRENAMIENTO: accion=${accion} tx=${txId} chat=${callback.chatId}`)

  if (accion === 'ef') {
    await editar(callback, await vistaFin())
    return
  }
  if (accion === 'es') {
    await mostrarSiguiente(callback, txId, '⏭ Saltado.')
    return
  }

  const tx = await leerGasto(txId)
  if (!tx) {
    await mostrarSiguiente(callback, txId, `⚠️ ${describeRechazo('TX_NO_EXISTE')}`)
    return
  }

  if (accion === 'eb') {
    await editar(callback, vistaGasto(tx, await estadoDe(tx)))
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
    await editar(callback, {
      texto: `🧠 *Entrenamiento*\n\n*$${Number(tx.monto).toFixed(2)} — ${esc(tx.descripcion)}*\n\n¿De qué categoría es?`,
      buttons: rows,
    })
    return
  }

  if (accion === 'el') {
    await menuLineas(callback, tx, a)
    return
  }

  if (accion === 'ec') {
    const r = await aplicarCategoria(tx, { propuestaId: Number(b), finalId: Number(a), fuente: c })
    const encabezado = r.ok ? `✏️ «${esc(tx.descripcion)}» → ${esc(r.nombre)}` : r.texto
    await mostrarGastoOSiguiente(callback, tx.id, encabezado)
    return
  }

  if (accion === 'en') {
    const r = await aplicarLinea(tx, Number(a))
    const encabezado = r.ok ? `📂 «${esc(tx.descripcion)}» → ${esc(r.nombre)}` : r.texto
    await mostrarGastoOSiguiente(callback, tx.id, encabezado)
    return
  }

  if (accion === 'ea') {
    // Primero la categoria (la linea sugerida pudo haberse calculado con ella),
    // luego la linea. Lo que ya estaba resuelto llega como 0 y no se toca.
    const partes = []
    const catId = Number(a)
    const lineaId = Number(c)
    if (catId) {
      const r = await aplicarCategoria(tx, { propuestaId: catId, finalId: catId, fuente: b })
      partes.push(r.ok ? esc(r.nombre) : r.texto)
    }
    if (lineaId) {
      const r = await aplicarLinea(tx, lineaId)
      partes.push(r.ok ? esc(r.nombre) : r.texto)
    }
    await mostrarSiguiente(callback, tx.id, `✅ «${esc(tx.descripcion)}» → ${partes.join(' · ')}`)
  }
}

module.exports = { ACCIONES, esPedidoDeEntrenar, iniciar, handleCallback, siguiente }
