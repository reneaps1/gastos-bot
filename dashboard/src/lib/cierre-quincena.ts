interface PresupuestoParaCierre {
  id: number
  descripcion: string
  // Presupuesto Modificado si existe, si no el Original -- lo que la linea
  // esta comprometida a cumplir *hoy*. Nunca el monto original crudo: un
  // excedente ya cubierto por un traspaso (ver /transferir) deja de contar
  // como excedido porque el efectivo ya subio para reflejarlo.
  montoEfectivo: number
  real: number
  pendiente: number
  estadoLinea: string
  categoria: { tipo: string; nombre: string }
}

export type MotivoPendiente = 'sinRegistro' | 'pendienteDePago' | 'excedido'

// Por que una linea de Gasto todavia necesita una decision antes de poder
// cerrar su quincena: nunca se registro nada (sinRegistro), quedo algo
// registrado sin pagar (pendienteDePago), o se gasto de mas sobre lo
// efectivamente comprometido (excedido). Ingreso/Ahorro, una linea ya
// resuelta, o un gasto que cerro dentro de lo comprometido no necesitan cierre.
export function motivoPendiente(p: PresupuestoParaCierre): MotivoPendiente | null {
  if (p.estadoLinea !== 'Abierta') return null
  if (p.categoria.tipo !== 'Gasto') return null
  if (p.real === 0) return 'sinRegistro'
  if (p.pendiente > 0) return 'pendienteDePago'
  if (p.real > p.montoEfectivo) return 'excedido'
  return null
}

export function montoPendiente(p: PresupuestoParaCierre, motivo: MotivoPendiente): number {
  if (motivo === 'excedido') return p.real - p.montoEfectivo
  return p.pendiente + Math.max(p.montoEfectivo - p.real, 0)
}

interface QuincenaParaCierre { id: number; codigo: string; fechaFin: string; fechaCierre?: string | null }
interface PresupuestoConQuincena extends PresupuestoParaCierre { quincena: QuincenaParaCierre }

export interface LineaPendiente extends PresupuestoConQuincena {
  motivo: MotivoPendiente
  monto: number
}

export interface GrupoCierre {
  quincena: QuincenaParaCierre
  items: LineaPendiente[]
  total: number
}

// Agrupa por quincena las lineas de Gasto que siguen sin resolver en periodos
// que ya terminaron (fechaFin < today) y que nadie ha cerrado todavia
// (fechaCierre null). Ordenado de la quincena mas vieja a la mas reciente,
// para resolver primero lo mas atrasado.
export function quincenasPendientesDeCierre(presupuestos: PresupuestoConQuincena[], today: string): GrupoCierre[] {
  const porQuincena = new Map<number, GrupoCierre>()
  for (const p of presupuestos) {
    if (p.quincena.fechaFin.split('T')[0] >= today) continue
    if (p.quincena.fechaCierre) continue
    const motivo = motivoPendiente(p)
    if (!motivo) continue
    if (!porQuincena.has(p.quincena.id)) porQuincena.set(p.quincena.id, { quincena: p.quincena, items: [], total: 0 })
    const grupo = porQuincena.get(p.quincena.id)!
    const monto = montoPendiente(p, motivo)
    grupo.items.push({ ...p, motivo, monto })
    grupo.total += monto
  }
  return Array.from(porQuincena.values()).sort((a, b) => a.quincena.fechaFin.localeCompare(b.quincena.fechaFin))
}

export const MOTIVO_LABEL: Record<MotivoPendiente, string> = {
  sinRegistro: 'Sin registrar',
  pendienteDePago: 'Pendiente de pago',
  excedido: 'Excedido',
}
