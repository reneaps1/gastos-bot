const TTL_MINUTES = 45

function computeExpiresAt(now = new Date()) {
  return new Date(now.getTime() + TTL_MINUTES * 60 * 1000)
}

function isExpired(pending, now = new Date()) {
  if (!pending?.expiresAt) return true
  return new Date(pending.expiresAt).getTime() <= now.getTime()
}

// presupuestos: filas de Presupuesto (con categoria incluida) para la quincena
// actual, ya filtradas a categoria.tipo = 'Gasto' y ordenadas por monto desc
// (ver db.findPresupuestosByQuincena). personalCategoria: la fila de
// Categoria "Personal", para la opcion de escape "0".
function buildOptions(presupuestos, personalCategoria) {
  const options = presupuestos.map((p, i) => ({
    position: i + 1,
    presupuestoId: p.id,
    descripcion: p.descripcion,
    categoriaId: p.categoriaId,
    categoriaNombre: p.categoria?.nombre || '',
    clasificacion: p.clasificacion ?? p.categoria?.clasificacion ?? null,
    montoPresupuestado: p.montoPresupuestado != null ? Number(p.montoPresupuestado) : null,
  }))

  options.push({
    position: 0,
    presupuestoId: null,
    descripcion: 'Otro / Personal (sin línea específica)',
    categoriaId: personalCategoria.id,
    categoriaNombre: personalCategoria.nombre,
    clasificacion: personalCategoria.clasificacion ?? null,
    montoPresupuestado: null,
  })

  return options
}

function formatOptionsMessage(options, monto, descripcion, { prefix } = {}) {
  const lineas = options
    .filter(o => o.position !== 0)
    .map(o => {
      const montoTxt = o.montoPresupuestado != null ? ` — $${o.montoPresupuestado}` : ''
      return `${o.position}) ${o.descripcion} (${o.categoriaNombre})${montoTxt}`
    })
  const otro = options.find(o => o.position === 0)

  const partes = [
    `${prefix ? prefix + '\n\n' : ''}🏷️ ¿A qué línea de presupuesto va este gasto de $${monto} (${descripcion})?`,
    '',
    ...lineas,
  ]
  if (otro) partes.push(`0) ${otro.descripcion}`)
  partes.push('', 'Responde solo con el número.')
  return partes.join('\n')
}

// Interpreta la respuesta a la pregunta de linea de presupuesto. Exige que el
// mensaje completo (recortado) se reduzca a relleno opcional + digitos, para
// no confundir una respuesta real con un gasto nuevo que casualmente tenga
// numeros (ej. "200 super", "930, 3B" nunca deben matchear aqui).
const REPLY_RE = /^(?:opci[oó]n\s+|n[uú]mero\s+|la\s+|el\s+|#\s*)?(\d{1,2})[.)]?$/i

function matchReply(text, options) {
  const trimmed = String(text || '').trim()
  const m = trimmed.match(REPLY_RE)
  if (!m) return { type: 'unrelated' }

  const position = parseInt(m[1], 10)
  const option = (options || []).find(o => o.position === position)
  return option ? { type: 'valid', option } : { type: 'invalid' }
}

module.exports = { TTL_MINUTES, computeExpiresAt, isExpired, buildOptions, formatOptionsMessage, matchReply }
