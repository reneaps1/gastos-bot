// Carga codigo TypeScript del dashboard desde las pruebas del bot, sin build y
// sin dependencias nuevas: transpila al vuelo con el `typescript` de la raiz
// (como scripts/test-cuadre.js), resuelve el alias `@/` a dashboard/src y
// reemplaza lo que no puede correr fuera de Next (next/server, la sesion, la
// bitacora) por dobles. `@/lib/prisma` apunta al doble que la prueba elija con
// usarPrisma().
//
// Sirve para comparar al bot contra el dashboard DE VERDAD (sus rutas y sus
// funciones), no contra una copia escrita a mano en la prueba.

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const DASHBOARD_SRC = path.join(__dirname, '..', 'dashboard', 'src')

function transpilar(module, filename) {
  const fuente = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
if (!require.extensions['.ts']) require.extensions['.ts'] = transpilar
if (!require.extensions['.tsx']) require.extensions['.tsx'] = transpilar

// JSX de juguete: un elemento es { type, props }. renderTexto() lo recorre y
// devuelve el texto que mostraria el navegador, para comparar frases del panel
// con las del bot sin React ni DOM.
const FRAGMENT = Symbol('Fragment')
const jsx = (type, props) => ({ type, props: props || {} })
const componenteVacio = () => null

const prismaActual = { valor: null }
const STUBS = {
  'next/server': {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
  },
  '@/lib/prisma': { get prisma() { return prismaActual.valor } },
  '@/lib/auth': { getSession: async () => null },
  '@/lib/presupuesto-cambios': { registrarCreacionPresupuesto: async () => {} },
  // Para cargar utils.ts, useResumenQuincena.ts y CuadraTuDinero.tsx sin las
  // node_modules del dashboard (el CI solo instala las de la raiz).
  react: { useState: v => [v, () => {}], useEffect: () => {}, useCallback: f => f, useMemo: f => f() },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: FRAGMENT },
  'next/link': { __esModule: true, default: props => ({ type: 'a', props }) },
  'lucide-react': new Proxy({}, { get: () => componenteVacio }),
  clsx: { clsx: (...a) => a.flat().filter(Boolean).join(' ') },
  'tailwind-merge': { twMerge: s => s },
}

// Texto de un arbol de juguete. `elementos` junta el texto de cada elemento
// HTML (p, span, ...) por separado, para poder exigir que UNO diga exactamente
// la frase (y no que la frase sea un pedazo de otra mas larga).
function renderTexto(nodo, elementos = []) {
  if (nodo == null || nodo === false || nodo === true) return ''
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo)
  if (Array.isArray(nodo)) return nodo.map(n => renderTexto(n, elementos)).join('')
  if (typeof nodo.type === 'function') return renderTexto(nodo.type(nodo.props), elementos)
  const texto = renderTexto(nodo.props.children, elementos)
  if (typeof nodo.type === 'string') elementos.push(texto.replace(/\s+/g, ' ').trim())
  return texto
}

const resolverOriginal = Module._resolveFilename
Module._resolveFilename = function (request, ...resto) {
  if (STUBS[request]) return request
  if (request.startsWith('@/')) {
    return resolverOriginal.call(this, path.join(DASHBOARD_SRC, request.slice(2)) + '.ts', ...resto)
  }
  return resolverOriginal.call(this, request, ...resto)
}
const cargarOriginal = Module._load
Module._load = function (request, ...resto) {
  if (STUBS[request]) return STUBS[request]
  return cargarOriginal.call(this, request, ...resto)
}

function usarPrisma(prisma) {
  prismaActual.valor = prisma
}

function requireDashboard(rel) {
  return require(path.join(DASHBOARD_SRC, rel))
}

// Lo que el panel "¿Cuadra tu dinero?" calcula para una quincena, armado
// exactamente como useResumenQuincena: las rutas GET del dashboard y despues
// calcularCuadre / calcularLibreDeQuincena de presupuesto-totales.ts.
async function cuadreSegunDashboard(prisma, quincenaId) {
  usarPrisma(prisma)
  const totales = requireDashboard('lib/presupuesto-totales.ts')
  const rutaPresupuestos = requireDashboard('app/api/presupuestos/route.ts')
  const rutaTransacciones = requireDashboard('app/api/transacciones/route.ts')
  const { normalizeMontos, sumLiquidez } = requireDashboard('lib/liquidez.ts')

  const presRes = await rutaPresupuestos.GET(new Request(`http://x/api/presupuestos?quincenaId=${quincenaId}`))
  const txRes = await rutaTransacciones.GET(new Request(`http://x/api/transacciones?quincenaId=${quincenaId}&limit=5`))
  // La ruta REAL de /api/liquidez, no una copia de su query: si cambia su
  // orden, cambia el corte que elige el panel y esta prueba lo tiene que ver.
  // useResumenQuincena toma el primero de la lista.
  const rutaLiquidez = requireDashboard('app/api/liquidez/route.ts')
  const liqRes = await rutaLiquidez.GET(new Request(`http://x/api/liquidez?quincenaId=${quincenaId}`))
  const snaps = Array.isArray(liqRes.body) ? liqRes.body : []

  const entrada = {
    ingresosTotales: Number(txRes.body?.totales?.Ingreso ?? 0),
    gastoTotal: Number(txRes.body?.totales?.Gasto ?? 0),
    presupuestos: Array.isArray(presRes.body) ? presRes.body : [],
  }
  const liquidezTotal = snaps[0] ? sumLiquidez(normalizeMontos(snaps[0])) : null
  return {
    status: [presRes.status, txRes.status, liqRes.status],
    corteId: snaps[0]?.id ?? null,
    entrada,
    presupuestos: entrada.presupuestos,
    totales: txRes.body?.totales,
    liquidezTotal,
    cuadre: totales.calcularCuadre({ ...entrada, liquidezTotal }),
    teorico: totales.calcularLibreDeQuincena(entrada),
    porPagar: totales.calcularFaltaPorPagar(entrada.presupuestos),
  }
}

// Los textos que el panel "¿Cuadra tu dinero?" (variante full, la de Tabla)
// muestra para un cuadre, uno por elemento.
function textosDelPanel(cuadre, fechaCorte = null) {
  const { CuadraTuDinero } = requireDashboard('components/resumen/CuadraTuDinero.tsx')
  const elementos = []
  renderTexto(jsx(CuadraTuDinero, { variant: 'full', cuadre, fechaCorte }), elementos)
  return elementos
}

module.exports = { DASHBOARD_SRC, usarPrisma, requireDashboard, cuadreSegunDashboard, textosDelPanel, renderTexto }
