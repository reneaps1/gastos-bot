// Cliente del bot para el chat de Milo en el dashboard (components/MiloChat).
//
// El agente vive SOLO en el bot (src/financeAgent.js y src/miloAcciones.js en
// la raiz del repo). Las rutas /api/milo/* del dashboard exigen la sesion del
// usuario y reenvian aqui con MILO_SERVICE_TOKEN; el bot las atiende en
// src/agenteWeb.js.
//
// MILO_BOT_URL NO tiene default a proposito: el token solo viaja a una URL
// que alguien configuro (la misma leccion de DASHBOARD_URL en el bot: el
// nombre "obvio" de un servicio de Render puede ser de alguien mas).

const TIMEOUT_MS = 90_000 // el plan free de Render tarda hasta ~50 s en despertar

export class MiloBotError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

function urlDelBot() {
  const url = (process.env.MILO_BOT_URL || '').trim().replace(/\/$/, '')
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) return null
  return url
}

export async function llamarBot<T>(ruta: string, body: unknown): Promise<T> {
  const url = urlDelBot()
  const token = process.env.MILO_SERVICE_TOKEN
  if (!url || !token) {
    throw new MiloBotError('Milo no está configurado en este dashboard (faltan MILO_BOT_URL o MILO_SERVICE_TOKEN).', 503)
  }

  let res: Response
  try {
    res = await fetch(`${url}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (error) {
    const vencio = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new MiloBotError(vencio ? 'Milo no contestó a tiempo. Intenta de nuevo en un momento.' : 'No pude hablar con Milo. Intenta de nuevo en un momento.', 504)
  }

  const datos = await res.json().catch(() => null)
  if (!res.ok) {
    const detalle = datos && typeof datos === 'object' && 'error' in datos ? String((datos as { error: unknown }).error) : `HTTP ${res.status}`
    // El host (no el token) dice si la peticion fue al bot o a otro lado: un
    // 429 o un 404 de un host ajeno es MILO_BOT_URL mal puesta.
    console.error(`MILO_BOT_ERROR ${res.status}: ${detalle} host=${new URL(url).host}`)
    throw new MiloBotError(res.status === 400 ? detalle : 'Milo tuvo un problema. Intenta de nuevo en un momento.', res.status === 400 ? 400 : 502)
  }
  return datos as T
}

// Mismo formato que valida el bot (src/agenteWeb.js).
export const CHAT_ID_WEB = /^web:[A-Za-z0-9_-]{6,36}$/
export const MAX_PREGUNTA = 1000
