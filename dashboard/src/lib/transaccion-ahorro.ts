// Punto único de verdad para mantener Transaccion.tipo consistente con
// categoria.tipo cuando la categoría es "Ahorro". Sin esto, dos caminos de
// escritura distintos (la sección /ahorro y el formulario genérico de
// /transacciones) pueden guardar el mismo tipo de movimiento con
// Transaccion.tipo distinto, y las cards que agregan por tipo dejan de ver
// unos u otros (ver /ahorro/page.tsx y api/transacciones/route.ts).
//
// Regla: toda transacción cuya categoría sea "Ahorro" siempre tiene
// tipo:'Ahorro'; la dirección (aporte suma, retiro resta) se guarda aparte
// en `direccion`, porque monto siempre es positivo. Para cualquier otra
// categoría, tipo se respeta tal cual (o cae a categoria.tipo si viene
// vacío/invalido), y direccion siempre es null.

import type { TipoMovimiento, DireccionAhorro } from '@prisma/client'

export function resolverTipoYDireccion(
  categoriaTipo: TipoMovimiento | string,
  tipoSolicitado?: string | null,
  direccionSolicitada?: string | null
): { tipo: TipoMovimiento; direccion: DireccionAhorro | null } {
  if (categoriaTipo === 'Ahorro') {
    const direccion: DireccionAhorro =
      direccionSolicitada === 'Retiro' || tipoSolicitado === 'Ingreso' ? 'Retiro' : 'Aporte'
    return { tipo: 'Ahorro', direccion }
  }
  const tipo = (tipoSolicitado === 'Ahorro' || !tipoSolicitado ? categoriaTipo : tipoSolicitado) as TipoMovimiento
  return { tipo, direccion: null }
}
