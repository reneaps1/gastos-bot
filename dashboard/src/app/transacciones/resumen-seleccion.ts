// Resumen de las filas seleccionadas, como la barra de estado de Excel
// (Cuenta, Suma, Promedio, Min, Max).
//
// El signo sigue la misma regla con la que la tabla pinta el monto: Ingreso
// suma (+), todo lo demas resta (-). Asi la suma cuadra con lo que el usuario
// ve en la columna Monto y puede verificarla a ojo.

export interface FilaResumible {
  tipo: string
  monto: number | string
}

export interface ResumenSeleccion {
  cuenta: number
  suma: number
  promedio: number
  min: number
  max: number
}

export function montoConSigno(fila: FilaResumible): number {
  const monto = Number(fila.monto)
  return fila.tipo === 'Ingreso' ? monto : -monto
}

export function resumenSeleccion(filas: FilaResumible[]): ResumenSeleccion | null {
  if (filas.length === 0) return null
  const valores = filas.map(montoConSigno)
  // Se suma en centavos para no arrastrar error de punto flotante en sumas
  // largas (0.1 + 0.2).
  const sumaCentavos = valores.reduce((acc, v) => acc + Math.round(v * 100), 0)
  const suma = sumaCentavos / 100
  return {
    cuenta: valores.length,
    suma,
    promedio: Math.round(sumaCentavos / valores.length) / 100,
    min: Math.min(...valores),
    max: Math.max(...valores),
  }
}
