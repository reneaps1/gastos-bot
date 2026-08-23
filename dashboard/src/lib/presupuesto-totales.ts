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
export function calcularFaltaPorPagar(presupuestos: PresupuestoParaTotales[]): number {
  return presupuestos
    .filter(p => p.categoria.tipo === 'Gasto')
    .reduce((s, p) => s + p.pendiente + Math.max(Number(p.montoPresupuestado) - p.real, 0), 0)
}
