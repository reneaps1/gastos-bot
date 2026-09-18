'use client'
import { useCallback, useReducer, useRef } from 'react'
import { formatMXN } from '@/lib/utils'

// Cache de lineas de presupuesto para los dropdowns de la tabla, con UNA
// entrada por quincena.
//
// Por que por quincena y no por (quincena, categoria): GET /api/presupuestos
// ?quincenaId=X ya devuelve las lineas de TODAS las categorias de esa quincena,
// y calcula el `real` de todas con un solo groupBy (ver api/presupuestos/route).
// Cachear por categoria multiplicaria las peticiones hasta por 9 para quedarse
// con un pedazo de la misma respuesta.
//
// Por que no un prefetch unico de todo: GET /api/presupuestos sin parametros
// trae todas las lineas de todas las quincenas que han existido mas un groupBy
// sobre todas las transacciones. Ese es el camino de analitica, no el de un
// dropdown.

export interface PresupuestoLinea {
  id: number
  descripcion: string
  quincenaId: number
  categoriaId: number
  montoEfectivo: number
  excedido: number
  estadoLinea: string
  categoria: { id: number; nombre: string; tipo: string }
}

export type EstadoLineas = 'idle' | 'loading' | 'ready' | 'error'

interface Entrada { estado: EstadoLineas; lineas: PresupuestoLinea[] }

/** Texto de la opcion en el dropdown: "Despensa ($6,500)" y, si ya se paso,
 *  "Despensa ($6,500) · excedido". Mismo formato que el modal de edicion.
 *
 *  La categoria NO va aqui: ahora se ofrecen lineas de todas las categorias,
 *  pero van dentro de un <optgroup> con el nombre de la categoria como
 *  encabezado, asi que repetirla en cada opcion seria ruido. */
export function etiquetaLinea(l: PresupuestoLinea): string {
  const base = `${l.descripcion} (${formatMXN(l.montoEfectivo)})`
  return l.excedido > 0 ? `${base} · excedido` : base
}

/** Nombre del grupo de una linea en el selector. */
export function grupoLinea(l: PresupuestoLinea): string {
  return l.categoria?.nombre ?? 'Sin categoría'
}

export function usePresupuestoLineas() {
  // El cache vive en un ref y los re-renders se disparan a mano: si viviera en
  // estado, `ensure` cambiaria de identidad en cada carga y los efectos que lo
  // llaman entrarian en bucle.
  const cache = useRef<Map<number, Entrada>>(new Map())
  const inflight = useRef<Map<number, Promise<void>>>(new Map())
  const [, bump] = useReducer((x: number) => x + 1, 0)

  const ensure = useCallback((quincenaIds: Array<number | string>) => {
    let lanzoAlgo = false
    for (const raw of quincenaIds) {
      const qid = Number(raw)
      if (!Number.isInteger(qid) || qid <= 0) continue
      if (cache.current.has(qid) || inflight.current.has(qid)) continue

      cache.current.set(qid, { estado: 'loading', lineas: [] })
      lanzoAlgo = true
      const p = fetch(`/api/presupuestos?quincenaId=${qid}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
        .then((data: PresupuestoLinea[]) => {
          cache.current.set(qid, { estado: 'ready', lineas: Array.isArray(data) ? data : [] })
        })
        .catch(() => { cache.current.set(qid, { estado: 'error', lineas: [] }) })
        .finally(() => { inflight.current.delete(qid); bump() })
      inflight.current.set(qid, p)
    }
    if (lanzoAlgo) bump()
  }, [])

  const estadoDe = useCallback((quincenaId: number | string): EstadoLineas => {
    return cache.current.get(Number(quincenaId))?.estado ?? 'idle'
  }, [])

  /** Lineas candidatas para una transaccion.
   *
   *  `categoriaId` YA NO SE PASA desde los selectores de asignacion: filtrar por
   *  categoria obligaba a acordarse de que categoria contiene la linea que uno
   *  busca antes de poder verla, que es justo el problema que este cambio ataca.
   *  El parametro sobrevive para los agrupamientos que si necesitan una
   *  categoria concreta.
   *
   *  `tipo` SI es obligatorio en la practica y es la frontera de integridad
   *  real: `real-transacciones.ts` calcula el `real` de una linea solo por
   *  `presupuestoId`, y `presupuesto-totales.ts` / `cierre-quincena.ts` filtran
   *  los agregados por `categoria.tipo`. Un Gasto colgado de una linea de
   *  Ingreso no lo cuenta nadie: el monto no cambia de columna, desaparece.
   *
   *  Las Canceladas se excluyen siempre: una linea que "nunca paso" no debe
   *  ofrecerse.
   *
   *  El orden es por categoria y luego por descripcion, para que los <optgroup>
   *  del selector salgan contiguos sin que el llamador reordene nada. */
  const lineasDe = useCallback((
    quincenaId: number | string,
    filtro: { categoriaId?: number; tipo?: string } = {},
  ): PresupuestoLinea[] => {
    const entrada = cache.current.get(Number(quincenaId))
    if (!entrada || entrada.estado !== 'ready') return []
    return entrada.lineas
      .filter(l =>
        l.estadoLinea !== 'Cancelada'
        && (filtro.categoriaId === undefined || l.categoriaId === filtro.categoriaId)
        && (filtro.tipo === undefined || l.categoria?.tipo === filtro.tipo),
      )
      .sort((a, b) =>
        (a.categoria?.nombre ?? '').localeCompare(b.categoria?.nombre ?? '')
        || a.descripcion.localeCompare(b.descripcion))
  }, [])

  /** Tras cualquier escritura que mueva el `real` de una quincena. No refetchea
   *  solo: los numeros son decoracion de la etiqueta, no entradas de la
   *  escritura, asi que se recargan la proxima vez que hagan falta. */
  const invalidar = useCallback((...quincenaIds: Array<number | string | null | undefined>) => {
    let borroAlgo = false
    for (const raw of quincenaIds) {
      if (raw == null) continue
      const qid = Number(raw)
      if (!Number.isInteger(qid)) continue
      if (cache.current.delete(qid)) borroAlgo = true
    }
    if (borroAlgo) bump()
  }, [])

  return { ensure, estadoDe, lineasDe, invalidar }
}
