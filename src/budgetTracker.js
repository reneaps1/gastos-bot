const prisma = require('./lib/prisma')
const { similarity } = require('./financeUtils')
const { escapeMarkdown } = require('./telegram')

// Tipos de movimiento que pueden colgarse de una linea de presupuesto.
// Antes solo existia 'Gasto', hardcodeado aqui y en src/budgetActions.js.
const TIPOS_CON_LINEA = new Set(['Gasto', 'Ingreso', 'Ahorro'])

// Empujon de ranking para las lineas de la categoria que el parser adivino.
// Esa categoria sigue siendo la mejor pista disponible; lo que dejo de ser es
// un filtro duro. El valor es chico a proposito: rompe empates cercanos sin
// enterrar una coincidencia textual buena de otra categoria.
const BOOST_MISMA_CATEGORIA = 0.15

function effectiveBudgetAmount(line) {
  return Number(line.montoRevisado ?? line.montoPresupuestado ?? 0)
}

// Lineas a las que una transaccion de `tipo` puede colgarse en esa quincena.
//
// NO FILTRA POR CATEGORIA, y ese es el punto: el filtro obligaba a acordarse de
// que categoria contiene la linea que uno busca antes de poder verla, y si el
// parser adivinaba mal la categoria (un "gas" de casa clasificado como
// Transporte) la linea correcta no aparecia nunca y desde Telegram no habia
// forma de llegar a ella. La categoria viaja en el resultado, para mostrarse
// como etiqueta en vez de usarse como reja.
//
// EL FILTRO POR TIPO SI ES OBLIGATORIO, y es la frontera de integridad real.
// Un cruce entre categorias del mismo tipo solo mueve dinero de columna: el
// monto se sigue contando exactamente una vez. Un cruce entre TIPOS lo hace
// desaparecer, porque los agregados filtran por categoria.tipo -- ver
// calcularFaltaPorPagar en dashboard/src/lib/presupuesto-totales.ts y
// dashboard/src/lib/cierre-quincena.ts. Un Gasto colgado de una linea de
// Ingreso no lo cuenta nadie. El caso AB de scripts/test-telegram-flow.js
// existe para que esto no se pueda romper sin que truene CI.
async function getActiveBudgetLines({ quincenaId, tipo = 'Gasto' }) {
  if (!quincenaId || !TIPOS_CON_LINEA.has(tipo)) return []

  return prisma.presupuesto.findMany({
    where: {
      quincenaId,
      // Por categoria, no por el `tipo` copiado en la fila: misma regla que
      // tipoDeLinea en dashboard/src/lib/presupuesto-totales.ts.
      categoria: { tipo },
      estadoLinea: { not: 'Cancelada' },
    },
    include: { categoria: true },
    orderBy: { id: 'asc' },
  })
}

// Auto-enlace: elige linea SOLA, sin que nadie confirme.
//
// A diferencia de las candidatas, esta sigue ACOTADA A LA CATEGORIA de la
// transaccion, a proposito. Abrirla a toda la quincena multiplicaria las formas
// de equivocarse justo en el unico camino donde el usuario no ve ni toca nada:
// las candidatas se muestran y se eligen, el auto-pick no. El caso T de
// scripts/test-telegram-flow.js es lo que fija esta frontera -- si alguien
// abre resolveBudgetLine a toda la quincena, ese caso truena.
async function resolveBudgetLine({ quincenaId, categoriaId, descripcion, tipo = 'Gasto' }) {
  if (!categoriaId) return null

  const lines = (await getActiveBudgetLines({ quincenaId, tipo }))
    .filter(line => line.categoriaId === categoriaId)

  if (lines.length === 0) return null
  // "Unica linea de SU categoria" sigue siendo senal segura. Ojo: esto depende
  // del filter de arriba; "unica linea de la quincena" no lo seria.
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

// Resuelve una linea por su NOMBRE, en toda la quincena.
//
// Distinta de resolveBudgetLine a proposito, y la diferencia no es tecnica sino
// de quien decidio:
//   - resolveBudgetLine adivina a partir de la descripcion de un gasto y
//     enlaza SOLA, sin que nadie confirme. Por eso se queda en la categoria.
//   - esta corre cuando el usuario ESCRIBIO el destino ("mandalo a
//     colegiatura"), y su resultado siempre termina en un boton de confirmar.
//     Acotarla a la categoria seria justo el problema que este cambio ataca:
//     el usuario nombra la linea que quiere y el bot no la encuentra porque
//     vive en otra categoria.
//
// Los umbrales son los mismos de resolveBudgetLine: con varias parecidas, mejor
// no proponer nada y caer en los botones de candidatas que proponer la equivocada.
async function resolveBudgetLineByName({ quincenaId, destino, tipo = 'Gasto' }) {
  const lines = await getActiveBudgetLines({ quincenaId, tipo })
  if (lines.length === 0) return null

  const ranked = lines
    .map(line => ({ line, score: similarity(destino, line.descripcion) }))
    .sort((a, b) => b.score - a.score || a.line.id - b.line.id)

  const best = ranked[0]
  const second = ranked[1]
  if (best.score >= 0.75 && (!second || best.score - second.score >= 0.15)) return best.line

  return null
}

// Candidatas que se le MUESTRAN al usuario, de toda la quincena.
//
// El ranking incluye el nombre de la categoria en el texto comparado, para que
// "gas de casa" empate con la linea de Hogar aunque el parser haya adivinado
// Transporte. Mismo criterio que budgetRemaining en src/telegramBrain.js.
//
// `limit = null` devuelve todas: quien pagina (los botones de Telegram) necesita
// la lista completa para poder cortarla.
async function getBudgetCandidates({ quincenaId, categoriaId, descripcion, tipo = 'Gasto', limit = null }) {
  const lines = await getActiveBudgetLines({ quincenaId, tipo })
  if (lines.length === 0) return []

  const ranked = lines
    .map(line => ({
      id: line.id,
      descripcion: line.descripcion,
      categoriaId: line.categoriaId,
      categoriaNombre: line.categoria?.nombre || null,
      score: similarity(descripcion, `${line.descripcion} ${line.categoria?.nombre || ''}`)
        + (categoriaId && line.categoriaId === categoriaId ? BOOST_MISMA_CATEGORIA : 0),
      presupuesto: effectiveBudgetAmount(line),
    }))
    // El desempate por id es lo que vuelve el orden TOTAL y determinista, y eso
    // es un requisito, no un adorno: la paginacion de los botones no guarda
    // estado (recalcula y corta segun el numero de pagina del callback_data),
    // asi que dos llamadas con los mismos datos tienen que dar exactamente la
    // misma lista o habria lineas inalcanzables entre una pagina y la otra.
    .sort((a, b) => b.score - a.score || a.descripcion.localeCompare(b.descripcion) || a.id - b.id)

  return limit === null ? ranked : ranked.slice(0, limit)
}

async function getBudgetLineStatus(presupuestoId) {
  if (!presupuestoId) return null

  const line = await prisma.presupuesto.findUnique({
    where: { id: presupuestoId },
    include: { categoria: true, quincena: true },
  })
  if (!line) return null

  // Agrupado por direccion, no un SUM en bruto: en una linea de categoria
  // Ahorro un Retiro tiene monto positivo y debe restar (ver src/tipoAhorro.js).
  // Espejo de dashboard/src/lib/real-transacciones.ts -- si cambia la regla
  // alla, cambiarla aqui tambien o el bot y el dashboard reportan distinto.
  const realRows = await prisma.transaccion.groupBy({
    by: ['direccion'],
    where: { presupuestoId },
    _sum: { monto: true },
  })

  const presupuesto = effectiveBudgetAmount(line)
  const gastado = realRows.reduce((total, row) => {
    const monto = Number(row._sum.monto ?? 0)
    return total + (row.direccion === 'Retiro' ? -monto : monto)
  }, 0)
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

module.exports = {
  TIPOS_CON_LINEA,
  getActiveBudgetLines,
  resolveBudgetLine,
  resolveBudgetLineByName,
  getBudgetCandidates,
  getBudgetLineStatus,
  formatBudgetStatus,
}
