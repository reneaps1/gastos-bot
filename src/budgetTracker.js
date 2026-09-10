const prisma = require('./lib/prisma')

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(value) {
  return new Set(normalize(value).split(' ').filter(token => token.length >= 3))
}

function similarity(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.92

  const aTokens = tokenSet(na)
  const bTokens = tokenSet(nb)
  if (!aTokens.size || !bTokens.size) return 0

  let intersection = 0
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1
  return intersection / Math.max(aTokens.size, bTokens.size)
}

function effectiveBudgetAmount(line) {
  return Number(line.montoRevisado ?? line.montoPresupuestado ?? 0)
}

async function resolveBudgetLine({ quincenaId, categoriaId, descripcion, tipo = 'Gasto' }) {
  if (!quincenaId || !categoriaId || tipo !== 'Gasto') return null

  const lines = await prisma.presupuesto.findMany({
    where: {
      quincenaId,
      categoriaId,
      tipo: 'Gasto',
      estadoLinea: { not: 'Cancelada' },
    },
    orderBy: { id: 'asc' },
  })

  if (lines.length === 0) return null
  if (lines.length === 1) return lines[0]

  const ranked = lines
    .map(line => ({ line, score: similarity(descripcion, line.descripcion) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  const second = ranked[1]

  // Deliberadamente conservador: evita asignar una transaccion a una linea
  // equivocada cuando una categoria tiene varias partidas parecidas.
  if (best.score >= 0.75 && (!second || best.score - second.score >= 0.15)) return best.line

  return null
}

async function getBudgetLineStatus(presupuestoId) {
  if (!presupuestoId) return null

  const line = await prisma.presupuesto.findUnique({
    where: { id: presupuestoId },
    include: { categoria: true, quincena: true },
  })
  if (!line) return null

  const realAgg = await prisma.transaccion.aggregate({
    where: { presupuestoId },
    _sum: { monto: true },
  })

  const presupuesto = effectiveBudgetAmount(line)
  const gastado = Number(realAgg._sum.monto ?? 0)
  const restante = Number((presupuesto - gastado).toFixed(2))

  return {
    id: line.id,
    descripcion: line.descripcion,
    categoria: line.categoria?.nombre || null,
    quincena: line.quincena?.codigo || null,
    presupuesto,
    gastado,
    restante,
    excedido: restante < 0 ? Math.abs(restante) : 0,
  }
}

function formatBudgetStatus(status) {
  if (!status) return null

  if (status.restante >= 0) {
    return [
      `📂 *${status.descripcion}*`,
      `Presupuesto: $${status.presupuesto.toFixed(2)}`,
      `Gastado: $${status.gastado.toFixed(2)}`,
      `Disponible: *$${status.restante.toFixed(2)}*`,
    ].join('\n')
  }

  return [
    `📂 *${status.descripcion}*`,
    `Presupuesto: $${status.presupuesto.toFixed(2)}`,
    `Gastado: $${status.gastado.toFixed(2)}`,
    `Excedido: *$${status.excedido.toFixed(2)}*`,
  ].join('\n')
}

module.exports = { resolveBudgetLine, getBudgetLineStatus, formatBudgetStatus }
