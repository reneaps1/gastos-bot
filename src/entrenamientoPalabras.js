// Entrenamiento "Yo te escribo palabras" por Telegram.
//
// El usuario elige este modo en el menu de "vamos a entrenar" y le escribe al
// bot palabras o frases sueltas ("croquetas", "uber eats"). El bot adivina a
// que linea de presupuesto irian y el usuario confirma o corrige. NO SE
// REGISTRA NINGUN GASTO: cada palabra se guarda en `clasificador_ejemplos`
// como ejemplo para los dos modelos (src/clasificador), que aprenden en ese
// momento. Al terminar, el bot dice cuantas acerto: ese es el reto.
//
// MODO CON ESTADO (lo unico con estado en el bot): mientras el modo esta
// activo, un mensaje sin numeros ni "?" se toma como palabra. Vive en memoria,
// por chat, y se apaga con "listo", con el boton de terminar o tras
// INACTIVIDAD_MS sin escribir. Si el servicio reinicia, el modo se pierde y el
// mensaje sigue el flujo normal: no se pierde nada, solo hay que volver a
// entrar. Un mensaje con monto ("150 super") o una pregunta ("¿cuanto me
// queda?") NUNCA se toma como palabra: se atiende normal, asi que olvidar que
// se esta entrenando no hace perder un gasto.
//
//   em:p                       (en src/entrenamiento.js) entrar al modo
//   wa:<ejemplo>:<linea>       si, esa linea (la sugerida: acerto)
//   wl:<ejemplo>:<pag>:<sug>   elegir otra linea (menu paginado)
//   wn:<ejemplo>:<linea>:<sug> esta es la linea (acerto si linea === sug)
//   wb:<ejemplo>               volver a la pregunta
//   wf:0                       terminar
//
// callback_data no es confiable: el ejemplo y la linea se revalidan contra la
// base (que existan, que la linea no este cancelada y sea de gasto).

const prisma = require('./lib/prisma')
const telegram = require('./telegram')
const db = require('./database')
const clasificador = require('./clasificador')
const { normalizar } = require('./clasificador/modelo')
const { lineasPara } = require('./sugerenciaLinea')
const { getCurrentQuincena, ensureFreshQuincenas } = require('./quincenas')

const ACCIONES = new Set(['wa', 'wl', 'wn', 'wb', 'wf'])
const INACTIVIDAD_MS = 15 * 60 * 1000
const LINEAS_POR_PAGINA = 6

const sesiones = new Map() // chatId -> { desde: Date, ultimo: number }

const esc = t => telegram.escapeMarkdown(String(t ?? ''))

function pct(confianza) {
  return confianza == null ? '' : ` _(${Math.min(99, Math.round(confianza * 100))} %)_`
}

function sesion(chatId) {
  const s = sesiones.get(String(chatId))
  if (!s) return null
  if (Date.now() - s.ultimo > INACTIVIDAD_MS) {
    sesiones.delete(String(chatId))
    return null
  }
  return s
}

function activar(chatId) {
  sesiones.set(String(chatId), { desde: new Date(), ultimo: Date.now() })
}

function esFin(texto) {
  return /^\s*(listo|terminar|termina|terminamos|salir|fin|ya|basta)\s*[.!]*\s*$/i.test(String(texto || ''))
}

// Una palabra de entrenamiento: con letras, sin numeros (eso es un gasto) y
// sin signos de pregunta (eso es una pregunta).
function esPalabra(texto) {
  const t = String(texto || '').trim()
  return t.length > 0 && t.length <= 60 && !/\d/.test(t) && !/[?¿]/.test(t) && normalizar(t).length > 0
}

async function quincenaActual() {
  await ensureFreshQuincenas()
  return db.findQuincenaByCodigo(getCurrentQuincena())
}

// Las lineas de gasto de la quincena actual, con la sugerida primero. Sin
// categoria: aqui no hay un gasto con categoria, asi que la regla de texto no
// opina y la sugerida sale del modelo (por eso es el modo "retador").
//
// SIEMPRE HAY UNA SUGERIDA (pedido del usuario: "que siempre me mande la
// aproximacion y yo confirmo"). Si el modelo no pasa su umbral, se usa su
// mejor apuesta sin umbral (`aproximada`); si el modelo no tiene ni un
// ejemplo, la linea que mas se parece por texto (la primera de las
// candidatas). Solo sin lineas en la quincena no hay nada que proponer.
async function lineasDe(texto) {
  const quincena = await quincenaActual()
  if (!quincena) return { candidatas: [], sugeridaId: null, sugeridaConfianza: null, aproximada: false }
  const r = await lineasPara({ quincenaId: quincena.id, categoriaId: null, descripcion: texto, tipo: 'Gasto' })
  if (r.sugeridaId != null || !r.candidatas.length) return { ...r, aproximada: false }

  const mejor = await clasificador.mejorLinea(texto, r.candidatas)
  const sugeridaId = mejor?.id ?? r.candidatas[0].id
  return {
    candidatas: [...r.candidatas.filter(c => c.id === sugeridaId), ...r.candidatas.filter(c => c.id !== sugeridaId)],
    sugeridaId,
    sugeridaConfianza: mejor?.confianza ?? null,
    aproximada: true,
  }
}

function vistaPregunta(ejemplo, { candidatas, sugeridaId, sugeridaConfianza, aproximada }) {
  if (!candidatas.length) {
    return { texto: `🤔 «${esc(ejemplo.texto)}»: no hay líneas en esta quincena para practicar.`, buttons: [[{ text: '🏁 Terminar', callback_data: 'wf:0' }]] }
  }
  const sugerida = candidatas.find(c => c.id === sugeridaId) || candidatas[0]
  // Cuando no esta seguro lo dice, pero igual propone: el usuario confirma.
  const nota = aproximada
    ? ` _(mi mejor intento${sugeridaConfianza == null ? '' : `, ${Math.min(99, Math.round(sugeridaConfianza * 100))} %`})_`
    : pct(sugeridaConfianza)
  return {
    texto: `📂 «${esc(ejemplo.texto)}» → ¿*${esc(sugerida.descripcion)}*?${nota}`,
    buttons: [
      [
        { text: '✅ Sí', callback_data: `wa:${ejemplo.id}:${sugerida.id}` },
        { text: '✏️ Otra línea', callback_data: `wl:${ejemplo.id}:0:${sugerida.id}` },
      ],
      [{ text: '🏁 Terminar', callback_data: 'wf:0' }],
    ],
  }
}

async function marcador(desde) {
  if (!desde) return null
  const filas = await prisma.clasificadorEjemplo.findMany({
    where: { estado: 'confirmado', createdAt: { gte: desde } },
    select: { acerto: true },
  })
  return { total: filas.length, aciertos: filas.filter(f => f.acerto).length }
}

async function textoFin(chatId) {
  const s = sesiones.get(String(chatId))
  sesiones.delete(String(chatId))
  const m = s ? await marcador(s.desde) : null
  const lineas = ['🏁 *Entrenamiento de palabras terminado*']
  if (m?.total) lineas.push('', `Acerté ${m.aciertos} de ${m.total}${m.aciertos === m.total ? ' 🎯' : ''}.`)
  lineas.push('', 'Escribe «vamos a entrenar» cuando quieras otra ronda.')
  return lineas.join('\n')
}

// Desde el menu de src/entrenamiento.js (boton em:p).
async function entrar(callback) {
  activar(callback.chatId)
  await telegram.editMessageText(
    callback.chatId,
    callback.messageId,
    '✍️ *Modo palabras*\n\nEscríbeme una palabra o frase de un gasto (por ejemplo «croquetas») y adivino a qué línea va. *No se registra ningún gasto.*\n\nSi escribes algo con monto («150 super»), ese sí se registra normal. Para terminar escribe «listo».',
    { buttons: [[{ text: '🏁 Terminar', callback_data: 'wf:0' }]] },
  )
  console.log(`TELEGRAM_PALABRAS_INICIO: chat=${callback.chatId}`)
}

function salir(chatId) {
  sesiones.delete(String(chatId))
}

/**
 * Un mensaje de texto mientras el modo puede estar activo. Devuelve true si
 * lo atendio; false si no es para este modo (y sigue el flujo normal).
 */
async function manejarMensaje(message) {
  const s = sesion(message.chatId)
  if (!s) return false

  if (esFin(message.text)) {
    await telegram.sendTelegramMessage(message.chatId, await textoFin(message.chatId), message.messageId)
    return true
  }
  if (!esPalabra(message.text)) return false

  s.ultimo = Date.now()
  const texto = message.text.trim()
  const ejemplo = await prisma.clasificadorEjemplo.create({ data: { texto: texto.slice(0, 200) } })
  const vista = vistaPregunta(ejemplo, await lineasDe(texto))
  await telegram.sendTelegramMessage(message.chatId, vista.texto, message.messageId, { buttons: vista.buttons })
  console.log(`TELEGRAM_PALABRA: chat=${message.chatId}; ejemplo=${ejemplo.id}`)
  return true
}

async function confirmar(callback, ejemplo, lineaId, sugeridaId) {
  const linea = await prisma.presupuesto.findUnique({ where: { id: Number(lineaId) }, include: { categoria: true } })
  if (!linea || linea.estadoLinea === 'Cancelada' || linea.categoria?.tipo !== 'Gasto') {
    await telegram.editMessageText(callback.chatId, callback.messageId, `⚠️ «${esc(ejemplo.texto)}»: esa línea no sirve (no existe, está cancelada o no es de gasto).`)
    return
  }
  // Contestar dos veces el mismo mensaje no ensena dos veces.
  if (ejemplo.estado === 'confirmado' && ejemplo.lineaDescripcion === linea.descripcion) return

  const acerto = Number(sugeridaId) > 0 && Number(sugeridaId) === linea.id
  await prisma.clasificadorEjemplo.update({
    where: { id: ejemplo.id },
    data: { lineaDescripcion: linea.descripcion, categoriaId: linea.categoriaId, estado: 'confirmado', acerto, resueltoEn: new Date() },
  })
  clasificador.aprenderEjemplo(ejemplo.texto, linea.descripcion, linea.categoriaId, { corregida: !acerto })

  const s = sesion(callback.chatId)
  if (s) s.ultimo = Date.now()
  const encabezado = acerto
    ? `✅ ¡Acerté! «${esc(ejemplo.texto)}» → *${esc(linea.descripcion)}*`
    : `✏️ Aprendido: «${esc(ejemplo.texto)}» → *${esc(linea.descripcion)}*`
  await telegram.editMessageText(callback.chatId, callback.messageId, `${encabezado}\n\n${s ? 'Escríbeme otra.' : '_El modo palabras ya terminó; escribe «vamos a entrenar» para otra ronda._'}`)
  console.log(`TELEGRAM_PALABRA_CONFIRMADA: ejemplo=${ejemplo.id}; acerto=${acerto}`)
}

async function menuLineas(callback, ejemplo, pagina, sugeridaId) {
  // La sugerida primero y el resto de la mas probable a la menos: las que
  // importan salen en la primera pagina, no en la quinta.
  const r = await lineasDe(ejemplo.texto)
  const primera = r.candidatas.filter(c => c.id === r.sugeridaId)
  const candidatas = [...primera, ...(await clasificador.ordenarLineas(ejemplo.texto, r.candidatas.filter(c => c.id !== r.sugeridaId)))]
  const total = Math.max(1, Math.ceil(candidatas.length / LINEAS_POR_PAGINA))
  const p = Math.min(Math.max(0, Number(pagina) || 0), total - 1)
  const sug = Number(sugeridaId) || 0
  const rows = candidatas.slice(p * LINEAS_POR_PAGINA, (p + 1) * LINEAS_POR_PAGINA).map(c => [{
    text: `${c.id === sug ? '⭐ ' : ''}${c.descripcion}${c.categoriaNombre ? ` · ${c.categoriaNombre}` : ''}`.slice(0, 60),
    callback_data: `wn:${ejemplo.id}:${c.id}:${sug}`,
  }])
  const nav = []
  if (p > 0) nav.push({ text: '« Anterior', callback_data: `wl:${ejemplo.id}:${p - 1}:${sug}` })
  if (p < total - 1) nav.push({ text: `Ver más » (${p + 1}/${total})`, callback_data: `wl:${ejemplo.id}:${p + 1}:${sug}` })
  if (nav.length) rows.push(nav)
  rows.push([{ text: '◀ Volver', callback_data: `wb:${ejemplo.id}` }])
  await telegram.editMessageText(callback.chatId, callback.messageId, `«${esc(ejemplo.texto)}»: ¿a qué línea va?`, { buttons: rows })
}

async function handleCallback(callback) {
  const [accion, id, a, b] = callback.data.split(':')
  console.log(`TELEGRAM_PALABRAS: accion=${accion} ejemplo=${id} chat=${callback.chatId}`)

  if (accion === 'wf') {
    await telegram.editMessageText(callback.chatId, callback.messageId, await textoFin(callback.chatId))
    return
  }

  const ejemplo = await prisma.clasificadorEjemplo.findUnique({ where: { id: Number(id) } })
  if (!ejemplo) {
    await telegram.editMessageText(callback.chatId, callback.messageId, '⚠️ Esa palabra ya no existe.')
    return
  }

  if (accion === 'wa') return confirmar(callback, ejemplo, a, a)
  if (accion === 'wn') return confirmar(callback, ejemplo, a, b)
  if (accion === 'wl') return menuLineas(callback, ejemplo, a, b)
  if (accion === 'wb') {
    const vista = vistaPregunta(ejemplo, await lineasDe(ejemplo.texto))
    await telegram.editMessageText(callback.chatId, callback.messageId, vista.texto, { buttons: vista.buttons })
  }
}

module.exports = { ACCIONES, entrar, salir, manejarMensaje, handleCallback, esPalabra, esFin, INACTIVIDAD_MS, _sesiones: sesiones }
