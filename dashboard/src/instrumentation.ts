// Autoverificacion al arrancar: ¿el chat de Milo puede hablar con el bot?
//
// El 2026-11-15 el chat del dashboard fallaba con "MILO_BOT_ERROR 429" y el
// bot no registraba nada: la peticion nunca le llegaba (MILO_BOT_URL apuntaba
// a otro lado). Solo se descubria cuando alguien abria el chat. Ahora, al
// arrancar, el dashboard le hace ping al bot con el token y deja en el log
// una linea MILO_BOT_ENLACE con el resultado y el host, SIN el token.
//
// No se espera: register() debe terminar antes de que el servidor atienda
// peticiones, y el bot del plan free puede tardar ~50 s en despertar.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  setTimeout(() => {
    void verificarEnlaceConBot()
  }, 1000)
}

async function verificarEnlaceConBot() {
  const crudo = (process.env.MILO_BOT_URL || '').trim().replace(/\/$/, '')
  let host = '(vacia)'
  try {
    if (crudo) host = new URL(crudo).host
  } catch {
    host = '(invalida)'
  }
  if (!crudo || !process.env.MILO_SERVICE_TOKEN) {
    console.error(`MILO_BOT_ENLACE: sin-configurar host=${host} (faltan MILO_BOT_URL o MILO_SERVICE_TOKEN)`)
    return
  }
  if (!/^https:\/\//.test(crudo) && !/^http:\/\/localhost(:\d+)?$/.test(crudo)) {
    console.error(`MILO_BOT_ENLACE: url-no-https host=${host}`)
    return
  }
  try {
    const res = await fetch(`${crudo}/agente/web/ping`, {
      headers: { Authorization: `Bearer ${process.env.MILO_SERVICE_TOKEN}` },
      signal: AbortSignal.timeout(90_000),
      cache: 'no-store',
    })
    if (res.ok) console.log(`MILO_BOT_ENLACE: ok host=${host}`)
    else if (res.status === 401) console.error(`MILO_BOT_ENLACE: token-no-coincide host=${host} (MILO_SERVICE_TOKEN distinto en el bot y en el dashboard)`)
    else if (res.status === 404) console.error(`MILO_BOT_ENLACE: no-es-el-bot host=${host} (HTTP 404: esa URL no tiene /agente/web; revisa MILO_BOT_URL)`)
    else console.error(`MILO_BOT_ENLACE: error HTTP ${res.status} host=${host} (¿MILO_BOT_URL apunta al servicio correcto?)`)
  } catch (error) {
    const motivo = error instanceof Error ? error.name : 'error'
    console.error(`MILO_BOT_ENLACE: sin-respuesta host=${host} (${motivo})`)
  }
}
