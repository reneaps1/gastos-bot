import type { Prisma } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { headers } from 'next/headers'

// Bitacora de cambios financieros (tabla audit_log). La politica lo exige
// ("Cambios Financieros Deben Ser Auditables", DEVELOPMENT_POLICY.md) y hasta
// ahora nada la escribia: un movimiento editado o borrado no dejaba rastro.
//
// Una fila por CAMPO que cambio, con el valor de antes y el de despues. En un
// DELETE se guarda una fila por campo con valorNuevo = null, asi que el
// movimiento borrado se puede reconstruir desde aqui.
//
// La copia del bot es src/auditLog.js; si cambias el formato, cambia los dos.

type Tx = Prisma.TransactionClient

export type Operacion = 'INSERT' | 'UPDATE' | 'DELETE'

export interface Origen {
  userId: number | null
  source: string
}

function serializar(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === 'object') {
    // Prisma.Decimal y similares traen su propio toString.
    const conToString = valor as { toString?: () => string }
    if (typeof conToString.toString === 'function' && conToString.toString !== Object.prototype.toString) {
      return conToString.toString()
    }
    return JSON.stringify(valor)
  }
  return String(valor)
}

/** Campos que cambiaron entre dos versiones de un registro. */
export function diferencias(
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
  campos: readonly string[],
) {
  const out: { campo: string; valorAnterior: string | null; valorNuevo: string | null }[] = []
  for (const campo of campos) {
    const a = serializar(antes?.[campo])
    const d = serializar(despues?.[campo])
    if (a !== d) out.push({ campo, valorAnterior: a, valorNuevo: d })
  }
  return out
}

/**
 * Quien hizo el cambio. Una sesion de servicio (el bot, ver
 * @/lib/service-auth) se marca como 'telegram-agente' y puede traer el id de
 * la persona que toco "Confirmar" en el header x-milo-user-id.
 */
export async function origenDeLaPeticion(): Promise<Origen> {
  const session = await getSession()
  if (session?.servicio) {
    const h = await headers()
    const id = Number.parseInt(h.get('x-milo-user-id') ?? '', 10)
    return { userId: Number.isFinite(id) && id > 0 ? id : null, source: 'telegram-agente' }
  }
  return { userId: null, source: 'dashboard' }
}

export async function registrarAuditoria(
  tx: Tx,
  input: {
    tabla: string
    registroId: number
    operacion: Operacion
    antes: Record<string, unknown> | null
    despues: Record<string, unknown> | null
    campos: readonly string[]
    origen: Origen
  },
) {
  const cambios = diferencias(input.antes, input.despues, input.campos)
  if (cambios.length === 0) return 0
  await tx.auditLog.createMany({
    data: cambios.map(c => ({
      tabla: input.tabla,
      registroId: input.registroId,
      operacion: input.operacion,
      campo: c.campo,
      valorAnterior: c.valorAnterior,
      valorNuevo: c.valorNuevo,
      userId: input.origen.userId,
      source: input.origen.source,
    })),
  })
  return cambios.length
}

/** Los campos de una transaccion que se auditan. */
export const CAMPOS_TRANSACCION = [
  'fecha', 'quincenaId', 'userId', 'descripcion', 'categoriaId', 'tipo', 'direccion',
  'apartadoId', 'monto', 'metodoPagoId', 'estatus', 'notas', 'presupuestoId',
] as const
