const prisma = require('./lib/prisma')
const { similarity } = require('./financeUtils')
const { escapeMarkdown } = require('./telegram')

function effectiveBudgetAmount(line) {
  return Number(line.montoRevisado ?? line.montoPresupuestado ?? 0)
}

async function getActiveBudgetLines({ quincenaId, categoriaId, tipo = 'Gasto' }) {
  if (!quincenaId || !categoriaId || tipo !== 'Gasto') return []

  return prisma.presupuesto.findMany({
    where: {
      quincenaId,
      categoriaId,
      tipo: 'Gasto',
      estadoLinea: { not: 'Cancelada' },
    },
    orderBy: { id: 'asc' },
  })
}

async function resolveBudgetLine({ quincenaId, categoriaId, descripcion, tipo = 'Gasto' }) {
  const lines = await getActiveBudgetLines({ quincenaId, categoriaId, tipo })

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

async function getBudgetCandidates({ quincenaId, categoriaId, descripcion, tipo = 'Gasto', limit = 4 }) {
  const lines = await getActiveBudgetLines({ quincenaId, categoriaId, tipo })
  if (lines.length === 0) return []

  return lines
    .map(line => ({
      id: line.id,
      descripcion: line.descripcion,
      score: similarity(descripcion, line.descripcion),
      presupuesto: effectiveBudgetAmount(line),
    }))
    .sort((a, b) => b.score - a.score || a.descripcion.localeCompare(b.descripcion))
    .slice(0, limit)
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

  const descripcion = escapeMarkdown(status.descripcion)

  if (status.restante >= 0) {
    return [
      `📂 *${descripcion}*`,
      `Presupuesto: $${status.presupuesto.toFixed(2)}`,
      `Gastado: $${status.gastado.toFixed(2)}`,
      `Disponible: *$${status.restante.toFixed(2)}*`,
    ].join('\n')
  }

  return [
    `📂 *${descripcion}*`,
    `Presupuesto: $${status.presupuesto.toFixed(2)}`,
    `Gastado: $${status.gastado.toFixed(2)}`,
    `Excedido: *$${status.excedido.toFixed(2)}*`,
  ].join('\n')
}

module.exports = { resolveBudgetLine, getBudgetCandidates, getBudgetLineStatus, formatBudgetStatus }
