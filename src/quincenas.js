// Resolucion de quincenas: las fechas viven en la tabla `quincenas` de
// Postgres (editable desde el dashboard en Configuracion > Periodos de pago),
// no en un arreglo fijo aqui. Se cachean en memoria (mismo patron que
// src/gemini.js's cachedContext) para no pegarle a la DB en cada mensaje de
// WhatsApp, y para que getQuincenaForDate/getCurrentQuincena sigan siendo
// sincronas -- sus llamadores (parser.js, analytics.js) no cambian.
//
// Los rangos siguen dias reales de pago, por lo que existen fechas sin
// quincena (ej. 2026-05-14). Una fecha fuera de todo rango se reporta como
// "Sin quincena".
const db = require('./database')

const SIN_QUINCENA = 'Sin quincena'
const CACHE_TTL_MS = 120000

let cachedQuincenas = null
let cachedQuincenasTime = 0

async function ensureFreshQuincenas() {
  const now = Date.now()
  if (cachedQuincenas && now - cachedQuincenasTime < CACHE_TTL_MS) return cachedQuincenas
  try {
    const rows = await db.listQuincenas()
    cachedQuincenas = rows.map(r => ({
      codigo: r.codigo,
      inicio: r.fechaInicio.toISOString().slice(0, 10),
      fin: r.fechaFin.toISOString().slice(0, 10),
    }))
    cachedQuincenasTime = now
  } catch (e) {
    console.error('QUINCENAS_CACHE_REFRESH_ERROR:', e.message)
    // sigue sirviendo la caché anterior (si hay) en vez de tumbar el bot
  }
  return cachedQuincenas
}

function getQuincenaForDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const iso = `${y}-${m}-${d}`
  const q = (cachedQuincenas || []).find(q => iso >= q.inicio && iso <= q.fin)
  return q ? q.codigo : SIN_QUINCENA
}

function getCurrentQuincena(date) {
  return getQuincenaForDate(date || new Date())
}

// Último día hábil del mes (salta sábado/domingo, sin calendario de festivos).
// Referencia manual para cuando se agreguen periodos de fin de mes desde el
// dashboard -- no se aplica automaticamente a ningun periodo.
function lastBusinessDayOfMonth(year, monthIndex0) {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0))
  const day = d.getUTCDay()
  if (day === 0) d.setUTCDate(d.getUTCDate() - 2) // domingo -> viernes
  else if (day === 6) d.setUTCDate(d.getUTCDate() - 1) // sábado -> viernes
  return d
}

module.exports = { SIN_QUINCENA, getQuincenaForDate, getCurrentQuincena, ensureFreshQuincenas, lastBusinessDayOfMonth }
