export interface LiquidezMontos {
  bbva: number
  banamex: number
  uala: number
  ualaInversion: number
  efectivo: number
  valesDespensa: number
  valesGasolina: number
  otros: number
}

export function sumLiquidez(s: LiquidezMontos): number {
  return s.bbva + s.banamex + s.uala + s.ualaInversion + s.efectivo + s.valesDespensa + s.valesGasolina + s.otros
}

// Los campos Decimal de Prisma llegan como string por la API (Decimal.toJSON
// serializa a string), asi que hay que convertirlos a number antes de
// sumarlos o se concatenan como texto en vez de sumarse.
export function normalizeMontos(s: { [K in keyof LiquidezMontos]: unknown }): LiquidezMontos {
  return {
    bbva: Number(s.bbva) || 0,
    banamex: Number(s.banamex) || 0,
    uala: Number(s.uala) || 0,
    ualaInversion: Number(s.ualaInversion) || 0,
    efectivo: Number(s.efectivo) || 0,
    valesDespensa: Number(s.valesDespensa) || 0,
    valesGasolina: Number(s.valesGasolina) || 0,
    otros: Number(s.otros) || 0,
  }
}
