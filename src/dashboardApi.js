// Cliente de la API del dashboard para ejecutar las acciones que el usuario
// CONFIRMO en Telegram (src/miloAcciones.js).
//
// Por que el bot llama al dashboard en vez de escribir directo: cada operacion
// financiera tiene UNA sola implementacion, la de dashboard/src/app/api/**,
// con sus validaciones y su bitacora (audit_log, presupuesto_cambios). Una
// copia en el bot terminaria desfasandose, como advierte AGENTS.md sobre los
// traspasos.
//
// Autenticacion: MILO_SERVICE_TOKEN (el mismo valor en el bot y en el
// dashboard, ver dashboard/src/lib/service-auth.ts). El actor viaja en
// x-milo-actor y el id del usuario en x-milo-user-id, para la bitacora.

const DASHBOARD_URL = () => (process.env.DASHBOARD_URL || 'https://gastos-dashboard.onrender.com').replace(/\/$/, '')

// El plan free de Render tarda hasta ~50 s en despertar el dashboard.
const TIMEOUT_MS = Number(process.env.DASHBOARD_API_TIMEOUT_MS) || 90000

function isEnabled() {
  return Boolean(process.env.MILO_SERVICE_TOKEN)
}

class DashboardApiError extends Error {
  constructor(message, { status = null, cuerpo = null } = {}) {
    super(message)
    this.name = 'DashboardApiError'
    this.status = status
    this.cuerpo = cuerpo
  }
}

async function llamar(metodo, ruta, { body, actor, userId } = {}) {
  const token = process.env.MILO_SERVICE_TOKEN
  if (!token) {
    throw new DashboardApiError('Falta MILO_SERVICE_TOKEN en el servicio del bot: no puedo aplicar cambios en el dashboard.')
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'x-milo-actor': String(actor || 'bot').slice(0, 40),
  }
  if (userId) headers['x-milo-user-id'] = String(userId)
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${DASHBOARD_URL()}${ruta}`, {
      method: metodo,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    const motivo = error.name === 'AbortError' ? `no contestó en ${Math.round(TIMEOUT_MS / 1000)} s` : error.message
    throw new DashboardApiError(`El dashboard ${motivo}.`)
  } finally {
    clearTimeout(timer)
  }

  let cuerpo = null
  const texto = await res.text()
  try { cuerpo = texto ? JSON.parse(texto) : null } catch { cuerpo = texto }

  if (!res.ok) {
    const detalle = cuerpo && typeof cuerpo === 'object' && cuerpo.error ? cuerpo.error : `HTTP ${res.status}`
    throw new DashboardApiError(`El dashboard rechazó el cambio: ${detalle}`, { status: res.status, cuerpo })
  }
  return cuerpo
}

module.exports = {
  isEnabled,
  llamar,
  DashboardApiError,
  _interno: { DASHBOARD_URL, TIMEOUT_MS },
}
