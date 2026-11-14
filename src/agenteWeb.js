// Milo en el dashboard web: el chat flotante del dashboard llama aqui.
//
// El agente y las acciones viven SOLO en el bot (src/financeAgent.js,
// src/miloAcciones.js). El dashboard no tiene una copia: su ruta
// /api/milo/* exige la sesion del usuario y reenvia a estas rutas con
// MILO_SERVICE_TOKEN. Dos agentes (uno en el bot y otro en el dashboard) se
// desfasarian, igual que dos implementaciones de un traspaso.
//
//   POST /agente/web                 { pregunta, chatId, usuario }
//   POST /agente/web/acciones/:id    { accion: 'confirmar'|'cancelar', chatId, usuario }
//
// Reglas:
//   - Sin MILO_SERVICE_TOKEN en el bot: 503. Token incorrecto: 401.
//   - El chatId del canal web SIEMPRE empieza con "web:". Asi una propuesta
//     hecha en Telegram no se puede confirmar desde la web ni al reves
//     (miloAcciones.confirmar ya compara el chatId de la fila).
//   - Las mismas reglas de las acciones que en Telegram: la IA propone, el
//     toque aplica, un toque una ejecucion (ver miloAcciones).

const crypto = require('crypto')

const MAX_PREGUNTA = 1000
const CHAT_ID_WEB = /^web:[A-Za-z0-9_-]{6,36}$/

function digest(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest()
}

// Compara en tiempo constante; hashear primero iguala las longitudes.
function tokenValido(header, esperado = process.env.MILO_SERVICE_TOKEN) {
  if (!esperado || !header) return false
  const m = /^Bearer\s+(.+)$/i.exec(String(header).trim())
  if (!m) return false
  return crypto.timingSafeEqual(digest(m[1].trim()), digest(esperado))
}

function montar(app, { financeAgent, miloAcciones, findUserByName, logQA = () => {} }) {
  function autorizar(req, res) {
    if (!process.env.MILO_SERVICE_TOKEN) {
      res.status(503).json({ error: 'El bot no tiene MILO_SERVICE_TOKEN configurado.' })
      return false
    }
    if (!tokenValido(req.get('Authorization'))) {
      console.warn('AGENTE_WEB_RECHAZADO: token ausente o incorrecto')
      res.status(401).json({ error: 'No autorizado' })
      return false
    }
    return true
  }

  function chatIdValido(chatId) {
    return typeof chatId === 'string' && CHAT_ID_WEB.test(chatId)
  }

  async function resolverUsuario(nombre) {
    if (!nombre || typeof nombre !== 'string') return null
    try {
      return await findUserByName(nombre.trim().slice(0, 50))
    } catch {
      return null
    }
  }

  app.post('/agente/web', async (req, res) => {
    if (!autorizar(req, res)) return
    const inicio = Date.now()
    const { pregunta, chatId, usuario } = req.body || {}
    const texto = typeof pregunta === 'string' ? pregunta.trim() : ''
    if (!texto || texto.length > MAX_PREGUNTA) {
      return res.status(400).json({ error: `La pregunta va de 1 a ${MAX_PREGUNTA} caracteres.` })
    }
    if (!chatIdValido(chatId)) return res.status(400).json({ error: 'chatId invalido: debe empezar con "web:".' })

    const user = await resolverUsuario(usuario)
    const senderName = user?.nombre || 'usuario'
    let resultado = null
    try {
      resultado = await financeAgent.answer(texto, {
        senderName,
        chatId,
        acciones: { chatId, userId: user?.id ?? null, solicitante: senderName },
      })
    } catch (error) {
      console.error('AGENTE_WEB_ERROR:', error.message)
    }

    if (!resultado?.reply) {
      logQA({ chatId, ruta: 'web-fallo', inicio, pregunta: texto })
      return res.json({ reply: null, acciones: [], error: 'No pude contestar eso ahora. Intenta de nuevo en un momento.' })
    }

    const acciones = []
    for (const id of resultado.acciones || []) {
      const resumen = await miloAcciones.resumenDe(id)
      if (resumen) acciones.push({ id, resumen })
    }
    logQA({
      chatId, ruta: 'web', inicio, pregunta: texto, respuesta: resultado.reply,
      herramientas: (resultado.trace || []).map(t => t.tool), proveedor: resultado.provider,
    })
    return res.json({ reply: resultado.reply, provider: resultado.provider, acciones })
  })

  app.post('/agente/web/acciones/:id', async (req, res) => {
    if (!autorizar(req, res)) return
    const { accion, chatId, usuario } = req.body || {}
    if (!chatIdValido(chatId)) return res.status(400).json({ error: 'chatId invalido: debe empezar con "web:".' })
    if (accion !== 'confirmar' && accion !== 'cancelar') {
      return res.status(400).json({ error: 'accion debe ser confirmar o cancelar.' })
    }

    if (accion === 'cancelar') {
      return res.json(await miloAcciones.cancelar({ accionId: req.params.id, chatId }))
    }
    const user = await resolverUsuario(usuario)
    const r = await miloAcciones.confirmar({
      accionId: req.params.id,
      chatId,
      userId: user?.id ?? null,
      actor: user?.nombre || 'web',
    })
    return res.json(r)
  })
}

module.exports = { montar, _interno: { tokenValido, CHAT_ID_WEB, MAX_PREGUNTA } }
