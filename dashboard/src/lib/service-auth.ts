import { createHash, timingSafeEqual } from 'node:crypto'

// Autenticacion de SERVICIO: el bot de Telegram (src/miloEjecutor.js) llama a
// esta API para ejecutar las acciones que el usuario confirmo con un boton.
// Asi cada operacion financiera tiene UNA sola implementacion (la del
// dashboard) en vez de una copia en el bot que tarde o temprano se desfasa.
//
// Reglas:
//   - Sin MILO_SERVICE_TOKEN configurado, el header no abre NADA.
//   - Solo vale para /api/*. Nunca da acceso a paginas.
//   - El actor queda como "milo:<nombre>", para que la bitacora diga quien
//     pidio el cambio y que llego por el bot.
//   - No sirve para cambiar la contrasena (ver auth/change-password).

export const SERVICE_ACTOR_HEADER = 'x-milo-actor'
export const SERVICE_PREFIX = 'milo:'

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

/** Compara en tiempo constante. Hashear primero iguala las longitudes. */
export function tokenValido(recibido: string | null | undefined, esperado = process.env.MILO_SERVICE_TOKEN) {
  if (!esperado || !recibido) return false
  return timingSafeEqual(digest(recibido), digest(esperado))
}

function tokenDeAuthorization(header: string | null | undefined) {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : null
}

/** Nombre corto y seguro para la bitacora: sin saltos ni caracteres raros. */
export function limpiarActor(raw: string | null | undefined) {
  const limpio = String(raw || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 40)
  return limpio || 'bot'
}

/**
 * Si la peticion trae un token de servicio valido, devuelve el usuario de
 * servicio ("milo:<actor>"); si no, null.
 */
export function sesionDeServicio(headers: { get(name: string): string | null }) {
  const token = tokenDeAuthorization(headers.get('authorization'))
  if (!tokenValido(token)) return null
  return { username: `${SERVICE_PREFIX}${limpiarActor(headers.get(SERVICE_ACTOR_HEADER))}`, servicio: true as const }
}
