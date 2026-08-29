import { prisma } from '@/lib/prisma'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { motivoPendiente } from '@/lib/cierre-quincena'

// Presupuesto Modificado si existe, si no el Original -- el mismo criterio
// que usa GET /api/presupuestos para pct/excedido. Vive aca (no en
// cierre-quincena.ts) porque opera sobre filas crudas de Prisma (Decimal),
// no sobre la forma ya serializada que consume el cliente.
export function montoEfectivoDePrisma(p: { montoPresupuestado: unknown; montoRevisado: unknown }): number {
  return p.montoRevisado != null ? Number(p.montoRevisado) : Number(p.montoPresupuestado)
}

// Revisa si a esta quincena (ya terminada) le sigue faltando resolver alguna
// linea de Gasto "Abierta" -- mismo calculo real/pendiente que ya hace el GET
// de /api/presupuestos, acotado a una sola quincena. Si ya no queda nada, la
// cierra sola (fechaCierre/cerradaPor). Se llama desde cualquier accion que
// pueda haber resuelto la ultima partida pendiente: /resolver y /transferir.
export async function cerrarSiCorresponde(quincenaId: number, username: string | null) {
  const quincena = await prisma.quincena.findUnique({ where: { id: quincenaId } })
  if (!quincena || quincena.fechaCierre) return
  if (quincena.fechaFin.toISOString().split('T')[0] >= getMexicoDateString()) return

  const lineas = await prisma.presupuesto.findMany({
    where: { quincenaId, estadoLinea: 'Abierta' },
    include: { categoria: true },
  })
  const gastoLineas = lineas.filter(l => l.categoria.tipo === 'Gasto')
  if (gastoLineas.length === 0) {
    await prisma.quincena.update({ where: { id: quincenaId }, data: { fechaCierre: new Date(), cerradaPor: username } })
    return
  }

  const ids = gastoLineas.map(l => l.id)
  const rows = await prisma.transaccion.groupBy({
    by: ['presupuestoId', 'estatus'],
    where: { presupuestoId: { in: ids } },
    _sum: { monto: true },
  })
  const realMap = new Map<number, number>()
  const pendMap = new Map<number, number>()
  for (const r of rows) {
    const id = r.presupuestoId as number
    const monto = Number(r._sum.monto ?? 0)
    realMap.set(id, (realMap.get(id) ?? 0) + monto)
    if (r.estatus === 'Pendiente') pendMap.set(id, (pendMap.get(id) ?? 0) + monto)
  }

  const quedaAlgo = gastoLineas.some(l => motivoPendiente({
    id: l.id,
    descripcion: l.descripcion,
    montoEfectivo: montoEfectivoDePrisma(l),
    real: realMap.get(l.id) ?? 0,
    pendiente: pendMap.get(l.id) ?? 0,
    estadoLinea: l.estadoLinea,
    categoria: l.categoria,
  }) !== null)

  if (!quedaAlgo) {
    await prisma.quincena.update({ where: { id: quincenaId }, data: { fechaCierre: new Date(), cerradaPor: username } })
  }
}

// Encadena una entrada de historial dentro de `notas` en vez de pisarlo --
// mismo mecanismo ligero de auditoria para toda accion de /resolver y
// /transferir (no hay tabla de auditoria dedicada para esto todavia).
export function conNota(notasActuales: string | null, etiqueta: string, nota?: string) {
  const linea = nota ? `${etiqueta}: ${nota}` : `${etiqueta} (${getMexicoDateString()})`
  return notasActuales ? `${notasActuales}\n${linea}` : linea
}
