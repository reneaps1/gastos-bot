interface PresupuestoParaTotales {
  montoPresupuestado: number | string
  real: number
  pendiente: number
  categoria: { tipo: string }
}

// Cuánto falta desembolsar de verdad para una quincena: lo ya registrado pero
// sin pagar (pendiente) más el presupuesto que ni siquiera se ha registrado.
// Solo cuenta partidas de Gasto — Ingreso/Ahorro nunca se suman aquí.
// "Restante" (presupuestado - real) no es suficiente: una partida 100%
// registrada como Pendiente muestra $0 de restante aunque se deba por completo.
//
// Ojo: esto mide EJECUCIÓN DE PRESUPUESTO por línea, en la quincena de esa
// línea — no mide caja. Una compra a crédito/MSI cuenta aquí completa en la
// quincena de la compra aunque el efectivo salga después. Para saber qué va
// a salir del banco EN una quincena, ver calcularPagosQuincena en
// `@/lib/pagos-quincena` (server-only, por eso vive en otro archivo — este
// módulo lo importan componentes de cliente y no puede traer Prisma).
export function calcularFaltaPorPagar(presupuestos: PresupuestoParaTotales[]): number {
  return presupuestos
    .filter(p => p.categoria.tipo === 'Gasto')
    .reduce((s, p) => s + p.pendiente + Math.max(Number(p.montoPresupuestado) - p.real, 0), 0)
}
