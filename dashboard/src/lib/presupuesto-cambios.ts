import type { Prisma } from '@prisma/client'

export type TipoCambioPresupuesto =
  | 'CREACION'
  | 'AJUSTE_MANUAL'
  | 'DESDE_SIN_ASIGNAR'
  | 'TRASPASO_ENTRADA'
  | 'TRASPASO_SALIDA'
  | 'MIGRACION_VIGENTE'

interface CambioInput {
  presupuestoId: number
  quincenaId: number
  tipo: TipoCambioPresupuesto
  montoAnterior: number
  montoNuevo: number
  grupoCambioId?: string | null
  presupuestoRelacionadoId?: number | null
  motivo?: string | null
  actor?: string | null
  fechaCreacion?: Date
}

export interface PresupuestoParaCambio {
  id: number
  quincenaId: number
  montoPresupuestado: unknown
  montoRevisado: unknown
}

export function montoEfectivoPresupuesto(p: Pick<PresupuestoParaCambio, 'montoPresupuestado' | 'montoRevisado'>) {
  return Number(p.montoRevisado ?? p.montoPresupuestado ?? 0)
}

function redondearMonto(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Registra un cambio financiero dentro de la misma transacción que modifica
 * el presupuesto. Se usa SQL tipado por parámetros para no permitir que la
 * bitácora falle de forma silenciosa si el cambio principal sí se guarda.
 */
export async function registrarCambioPresupuesto(tx: Prisma.TransactionClient, input: CambioInput) {
  const anterior = redondearMonto(Number(input.montoAnterior) || 0)
  const nuevo = redondearMonto(Number(input.montoNuevo) || 0)
  const delta = redondearMonto(nuevo - anterior)

  // CREACION sí se registra aunque el monto sea 0; el resto de no-op no aporta
  // historia y haría ruido en el timeline.
  if (input.tipo !== 'CREACION' && Math.abs(delta) < 0.005) return

  const fecha = input.fechaCreacion ?? new Date()

  await tx.$executeRaw`
    INSERT INTO "presupuesto_cambios" (
      "presupuesto_id",
      "quincena_id",
      "tipo",
      "monto_anterior",
      "monto_nuevo",
      "delta",
      "grupo_cambio_id",
      "presupuesto_relacionado_id",
      "motivo",
      "actor",
      "fecha_creacion"
    ) VALUES (
      ${input.presupuestoId},
      ${input.quincenaId},
      CAST(${input.tipo} AS "TipoCambioPresupuesto"),
      ${anterior},
      ${nuevo},
      ${delta},
      ${input.grupoCambioId ?? null},
      ${input.presupuestoRelacionadoId ?? null},
      ${input.motivo ?? null},
      ${input.actor ?? null},
      ${fecha}
    )
  `
}

export async function registrarCreacionPresupuesto(
  tx: Prisma.TransactionClient,
  presupuesto: PresupuestoParaCambio & { fechaRegistro?: Date },
  actor?: string | null,
  motivo = 'Presupuesto creado',
) {
  const original = Number(presupuesto.montoPresupuestado) || 0
  await registrarCambioPresupuesto(tx, {
    presupuestoId: presupuesto.id,
    quincenaId: presupuesto.quincenaId,
    tipo: 'CREACION',
    montoAnterior: 0,
    montoNuevo: original,
    motivo,
    actor,
    fechaCreacion: presupuesto.fechaRegistro,
  })
}
