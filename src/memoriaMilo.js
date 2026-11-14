// Memoria de conversacion de Milo: las ultimas vueltas por chat.
//
// Es lo que hace que "¿y la quincena pasada?" sepa de que se hablaba, y que
// una respuesta corta ("0", "4690.34") a una pregunta de Milo se lea como
// respuesta y no como un mensaje suelto.
//
// Dos capas:
//   - Un cache en el proceso (lo que habia antes): lectura inmediata.
//   - La tabla `milo_conversacion`: sobrevive a reinicios. En el plan gratis
//     Render duerme el servicio a los 15 minutos sin trafico y cada deploy lo
//     reinicia; con solo el cache, Milo "olvidaba" la platica a media frase
//     (visto el 2026-11-14 con el corte de liquidez).
//
// La base es un respaldo, no un requisito: si la tabla no existe o la base
// falla, se sigue con el cache y se deja MILO_MEMORIA_ERROR en el log. Nunca
// lanza: perder la memoria no puede tumbar una respuesta.
//
// No guarda conversaciones para siempre: al escribir se borra lo que tenga
// mas de RETENCION_MS.

const MEMORIA_TURNOS = 6
const MEMORIA_TTL_MS = 30 * 60 * 1000
// Cuanto tiempo una pregunta de Milo sigue "esperando respuesta".
const ESPERA_TTL_MS = 10 * 60 * 1000
const RETENCION_MS = 24 * 60 * 60 * 1000
const MAX_TEXTO = 4000

const memoria = new Map() // chatId -> { turnos: [{ pregunta, respuesta, autor, en }], actualizado }

// Perezoso y tolerante: en pruebas el doble de Prisma puede no traer el modelo.
function tabla() {
  try {
    return require('./lib/prisma').miloConversacion || null
  } catch {
    return null
  }
}

function recordar(chatId, ahora = Date.now()) {
  if (chatId == null) return []
  const entrada = memoria.get(String(chatId))
  if (!entrada) return []
  if (ahora - entrada.actualizado > MEMORIA_TTL_MS) {
    memoria.delete(String(chatId))
    return []
  }
  return entrada.turnos
}

// Trae de la base las vueltas recientes del chat si el proceso no las tiene
// (recien reiniciado). Con cache vigente no consulta nada.
async function cargar(chatId, ahora = Date.now()) {
  if (chatId == null) return
  const id = String(chatId)
  if (recordar(id, ahora).length) return
  const t = tabla()
  if (!t) return
  try {
    const filas = await t.findMany({
      where: { chatId: id, createdAt: { gte: new Date(ahora - MEMORIA_TTL_MS) } },
      orderBy: { id: 'desc' },
      take: MEMORIA_TURNOS,
    })
    if (!filas.length) return
    // Entre la consulta y aqui pudo entrar un turno nuevo: ese gana.
    if (recordar(id, ahora).length) return
    const turnos = filas.reverse().map(f => ({
      pregunta: f.pregunta,
      respuesta: f.respuesta,
      autor: f.autor ?? null,
      en: new Date(f.createdAt).getTime(),
    }))
    memoria.set(id, { turnos, actualizado: turnos.at(-1).en })
  } catch (error) {
    console.error(`MILO_MEMORIA_ERROR: no se pudo leer la conversacion: ${error.message}`)
  }
}

// Guarda la vuelta en el cache (inmediato) y en la base (en segundo plano).
// Devuelve la promesa de la escritura, que nunca rechaza.
function guardarTurno(chatId, pregunta, respuesta, ahora = Date.now(), { autor = null } = {}) {
  if (chatId == null) return Promise.resolve()
  const id = String(chatId)
  const turno = { pregunta: String(pregunta || ''), respuesta: String(respuesta || ''), autor: autor ? String(autor) : null, en: ahora }
  const turnos = [...recordar(id, ahora), turno].slice(-MEMORIA_TURNOS)
  memoria.set(id, { turnos, actualizado: ahora })
  // Limpieza perezosa: que un chat abandonado no se quede para siempre.
  for (const [otro, e] of memoria) if (ahora - e.actualizado > MEMORIA_TTL_MS) memoria.delete(otro)

  const t = tabla()
  if (!t) return Promise.resolve()
  return (async () => {
    try {
      await t.create({
        data: {
          chatId: id,
          autor: turno.autor ? turno.autor.slice(0, 40) : null,
          pregunta: turno.pregunta.slice(0, MAX_TEXTO),
          respuesta: turno.respuesta.slice(0, MAX_TEXTO),
          createdAt: new Date(ahora),
        },
      })
      await t.deleteMany({ where: { createdAt: { lt: new Date(ahora - RETENCION_MS) } } })
    } catch (error) {
      console.error(`MILO_MEMORIA_ERROR: no se pudo guardar la conversacion: ${error.message}`)
    }
  })()
}

// La ultima vuelta del chat si Milo termino con una pregunta y sigue vigente;
// si no, null. Con `autor` (el id de quien escribe en el canal), solo cuenta si
// la pregunta fue para esa persona: en un grupo, el gasto que manda otra
// persona no es la respuesta.
// Lee el cache: llama cargar() antes si el proceso pudo haber reiniciado.
function preguntaPendiente(chatId, { autor = null, ahora = Date.now() } = {}) {
  const ultimo = recordar(chatId, ahora).at(-1)
  if (!ultimo) return null
  if (ahora - (ultimo.en ?? 0) > ESPERA_TTL_MS) return null
  if (!/\?\s*$/.test(ultimo.respuesta)) return null
  if (ultimo.autor && autor && ultimo.autor !== String(autor)) return null
  return ultimo
}

function olvidar(chatId) {
  if (chatId == null) memoria.clear()
  else memoria.delete(String(chatId))
}

module.exports = {
  recordar,
  cargar,
  guardarTurno,
  preguntaPendiente,
  olvidar,
  MEMORIA_TURNOS,
  MEMORIA_TTL_MS,
  ESPERA_TTL_MS,
  RETENCION_MS,
}
