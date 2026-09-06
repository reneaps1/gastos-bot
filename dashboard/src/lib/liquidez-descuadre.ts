export interface DatosDescuadre {
  saldoAnterior: number
  ingresosPagados: number
  gastosPagados: number
  saldoActual: number
}

function redondearMoneda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

export function calcularDescuadre(datos: DatosDescuadre) {
  const saldoEsperado = redondearMoneda(
    datos.saldoAnterior + datos.ingresosPagados - datos.gastosPagados,
  )

  return {
    ...datos,
    saldoEsperado,
    descuadre: redondearMoneda(datos.saldoActual - saldoEsperado),
  }
}
