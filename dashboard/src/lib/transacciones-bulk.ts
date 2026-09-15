// Logica de las acciones masivas de /transacciones. Sin React y sin fetch
// propio: el llamador pasa la funcion que escribe cada fila, asi que esto se
// puede leer (y probar) sin levantar la pagina.
//
// Por que fan-out de PUTs y no un endpoint masivo: ninguna de estas acciones
// tiene un invariante ENTRE filas. Mover de quincena, asignar linea, cambiar
// categoria/usuario, marcar estatus y borrar son todas fila a fila, asi que un
// lote a medias deja cada fila individualmente valida -- no hay nada que
// revertir en bloque. La regla que si importa (una linea de presupuesto
// pertenece a la quincena de su transaccion) ya vive centralizada en
// @/lib/validar-enlace-presupuesto, que un endpoint masivo tambien tendria que
// llamar en un loop. Ademas el PUT devuelve la transaccion actualizada con su
// `presupuesto`, asi que el reporte de "que enlaces se soltaron" sale
// confirmado por fila en vez de adivinado.
//
// Si algun dia "seleccionar todo" pasa a significar todas las filas que cumplen
// los filtros (y no las 25 de la pagina), esto deja de servir y toca el
// endpoint masivo de verdad.

export interface BulkOutcome<T = unknown> {
  id: number
  ok: boolean
  status?: number
  error?: string
  data?: T
}

export interface BulkReport<T = unknown> {
  ok: BulkOutcome<T>[]
  failed: BulkOutcome<T>[]
}

// Tope de 5 en vuelo. No es cosmetico: src/proxy.ts re-firma y re-setea la
// cookie de sesion en CADA request, incluidas las de /api/*, asi que soltar 25
// PUTs de golpe son 25 firmas de JWT y 25 Set-Cookie compitiendo, ademas de la
// presion sobre el pool de pg.
const CONCURRENCIA_DEFAULT = 5

async function ejecutarUna<T>(id: number, fn: (id: number) => Promise<Response>): Promise<BulkOutcome<T>> {
  try {
    const res = await fn(id)
    if (!res.ok) {
      // Los endpoints ya devuelven { error } en español; se respeta tal cual
      // en vez de inventar un mensaje propio.
      let error = `Error ${res.status}`
      try {
        const json = await res.json()
        if (json?.error) error = json.error
      } catch { /* respuesta sin JSON: queda el "Error NNN" */ }
      return { id, ok: false, status: res.status, error }
    }
    let data: T | undefined
    try { data = await res.json() } catch { /* DELETE puede no devolver cuerpo util */ }
    return { id, ok: true, status: res.status, data }
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : 'Error de red' }
  }
}

export async function runBulk<T = unknown>(
  ids: number[],
  fn: (id: number) => Promise<Response>,
  opts: { concurrencia?: number; onProgress?: (hechas: number, total: number) => void } = {},
): Promise<BulkReport<T>> {
  const concurrencia = opts.concurrencia ?? CONCURRENCIA_DEFAULT
  const resultados: BulkOutcome<T>[] = new Array(ids.length)
  let cursor = 0
  let hechas = 0

  async function worker() {
    for (;;) {
      const i = cursor++
      if (i >= ids.length) return
      resultados[i] = await ejecutarUna<T>(ids[i], fn)
      hechas++
      opts.onProgress?.(hechas, ids.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrencia, ids.length) }, () => worker()),
  )

  return {
    ok: resultados.filter(r => r.ok),
    failed: resultados.filter(r => !r.ok),
  }
}

// --- Planeacion de un movimiento de quincena -------------------------------

export interface FilaParaPlan {
  id: number
  descripcion: string
  quincenaId: number
  categoriaId: number
  presupuestoId: number | null
  presupuesto: { id: number; descripcion: string } | null
  creditoId: number | null
}

export interface PlanMoverQuincena<T extends FilaParaPlan = FilaParaPlan> {
  destinoId: number
  /** Ya estan en la quincena destino. NO se escriben: costaria un request y,
   *  peor, inflaria el "N movidas" con filas donde no paso nada. */
  omitidas: T[]
  aEscribir: T[]
  sinEnlace: T[]
  /** Tienen linea asignada, y como una linea siempre es de la quincena de su
   *  transaccion, moverlas la suelta sin excepcion. */
  pierdenEnlace: T[]
  categoriasAfectadas: number[]
  /** Compras a credito: sus CreditoPago tienen quincenaId propio (la quincena
   *  donde se paga) y no se mueven con la transaccion. */
  conCredito: T[]
}

export function planMoverQuincena<T extends FilaParaPlan>(filas: T[], destinoId: number): PlanMoverQuincena<T> {
  const omitidas = filas.filter(f => f.quincenaId === destinoId)
  const aEscribir = filas.filter(f => f.quincenaId !== destinoId)
  const pierdenEnlace = aEscribir.filter(f => f.presupuestoId != null)
  return {
    destinoId,
    omitidas,
    aEscribir,
    sinEnlace: aEscribir.filter(f => f.presupuestoId == null),
    pierdenEnlace,
    categoriasAfectadas: Array.from(new Set(pierdenEnlace.map(f => f.categoriaId))),
    conCredito: aEscribir.filter(f => f.creditoId != null),
  }
}

// --- Agrupacion para asignar linea en lote ---------------------------------

// `${quincenaId}::${categoriaId}` es la unica particion en la que una sola
// linea destino es legal para todas las filas del grupo: la quincena porque el
// servidor la exige, y la categoria porque ofrecer lineas de otra categoria en
// una accion masiva seria elegir a ciegas por el usuario.
export function claveGrupo(quincenaId: number, categoriaId: number): string {
  return `${quincenaId}::${categoriaId}`
}

export function leerClaveGrupo(clave: string): { quincenaId: number; categoriaId: number } {
  const [q, c] = clave.split('::')
  return { quincenaId: Number(q), categoriaId: Number(c) }
}

export function agruparPorQuincenaYCategoria<T extends FilaParaPlan>(filas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const fila of filas) {
    const clave = claveGrupo(fila.quincenaId, fila.categoriaId)
    const actual = grupos.get(clave)
    if (actual) actual.push(fila)
    else grupos.set(clave, [fila])
  }
  return grupos
}

// --- Reporte ---------------------------------------------------------------

/** Una sola frase con lo que de verdad paso, para el toast. Las partes en cero
 *  no se mencionan: "5 movidas" es mas legible que "5 movidas · 0 fallaron".
 *  Se piden las dos formas del participio porque en español no se puede
 *  derivar el plural (ni el genero) de forma confiable. */
export function resumenBulk(
  report: BulkReport,
  etiqueta: { uno: string; varias: string; extra?: string[] },
  omitidas = 0,
): string {
  const n = report.ok.length
  const partes: string[] = [`${n} ${n === 1 ? etiqueta.uno : etiqueta.varias}`]
  for (const extra of etiqueta.extra ?? []) partes.push(extra)
  if (omitidas > 0) partes.push(`${omitidas} sin cambios`)
  if (report.failed.length > 0) partes.push(`${report.failed.length} con error`)
  return partes.join(' · ')
}
