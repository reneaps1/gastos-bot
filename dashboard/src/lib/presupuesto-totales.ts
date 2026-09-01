import { cuentaParaAgregados } from '@/lib/cierre-quincena'

export interface PresupuestoParaTotales {
  montoEfectivo: number
  real: number
  pendiente: number
  categoria: { tipo: string }
  estadoLinea: string
}

// Cuánto falta desembolsar de verdad para una quincena: lo ya registrado pero
// sin pagar (pendiente) más lo comprometido (montoEfectivo = Modificado si
// existe, si no el Original) que ni siquiera se ha registrado. Solo cuenta
// partidas de Gasto — Ingreso/Ahorro nunca se suman aquí. "Restante"
// (efectivo - real) no es suficiente: una partida 100% registrada como
// Pendiente muestra $0 de restante aunque se deba por completo. Una línea
// Cancelada nunca cuenta -- nunca va a pagarse porque nunca pasó.
//
// Ojo: esto mide EJECUCIÓN DE PRESUPUESTO por línea, en la quincena de esa
// línea — no mide caja. Una compra a crédito/MSI cuenta aquí completa en la
// quincena de la compra aunque el efectivo salga después. Para saber qué va
// a salir del banco EN una quincena, ver calcularPagosQuincena en
// `@/lib/pagos-quincena` (server-only, por eso vive en otro archivo — este
// módulo lo importan componentes de cliente y no puede traer Prisma).
export function calcularFaltaPorPagar(presupuestos: PresupuestoParaTotales[]): number {
  return presupuestos
    .filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.pendiente + Math.max(p.montoEfectivo - p.real, 0), 0)
}

export interface PresupuestoParaLibre {
  categoria: { tipo: string }
  estadoLinea: string
  montoEfectivo: number
  excedido: number
}

// Cuanto de tus ingresos reales de la quincena sigue sin comprometerse en
// ningun lado: ni en una linea de Gasto/Ahorro presupuestada, ni en un
// excedido sobre una linea ya presupuestada, ni en un gasto registrado sin
// presupuestoId. A diferencia de "ingresos - presupuestado" (estatico), este
// SI baja si te pasas de una linea y nadie traspasa para cubrirlo. Usa
// `excedido` tal cual lo manda GET /api/presupuestos (ya floored en 0 por
// linea), no lo recalcula.
export function calcularLibreSinAsignar(
  ingresos: number,
  presupuestos: PresupuestoParaLibre[],
  gastosNoCubiertos: number,
): number {
  const gastoLineas = presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const presupTotal = gastoLineas.reduce((s, p) => s + p.montoEfectivo, 0)
  const totalExcedido = gastoLineas.reduce((s, p) => s + (p.excedido ?? 0), 0)
  const ahorroComprometido = presupuestos
    .filter(p => p.categoria.tipo === 'Ahorro' && cuentaParaAgregados(p))
    .reduce((s, p) => s + p.montoEfectivo, 0)
  const totalComprometido = presupTotal + gastosNoCubiertos + totalExcedido + ahorroComprometido
  return ingresos - totalComprometido
}
