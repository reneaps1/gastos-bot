export interface ReferenciaValores {
  ingresoReferencia: number | null
  limiteGastoReferencia: number | null
}

// Los campos Decimal de Prisma (ingresoReferencia/limiteGastoReferencia en
// Quincena y en Configuracion) llegan como string por la API — hay que
// convertirlos a number antes de usarlos, o resolveReferencia() los trata
// como "hay override" aunque sea la string "0". Mismo patron que
// lib/liquidez.ts normalizeMontos().
export function normalizeReferencia<T extends { ingresoReferencia?: unknown; limiteGastoReferencia?: unknown }>(
  o: T
): T & ReferenciaValores {
  return {
    ...o,
    ingresoReferencia: o.ingresoReferencia != null ? Number(o.ingresoReferencia) : null,
    limiteGastoReferencia: o.limiteGastoReferencia != null ? Number(o.limiteGastoReferencia) : null,
  }
}

// Resolucion del valor de referencia efectivo para una quincena: si tiene un
// override propio (ingresoReferencia/limiteGastoReferencia != null en la fila
// de Quincena) se usa ese; si no, se cae al valor global de Configuracion.
// Puro, sin fetch — se llama con datos ya cargados por el caller.
export function resolveReferencia(
  quincena: Partial<ReferenciaValores> | null | undefined,
  global: Partial<ReferenciaValores> | null | undefined
): ReferenciaValores & { ingresoEsOverride: boolean; limiteEsOverride: boolean } {
  return {
    ingresoReferencia: quincena?.ingresoReferencia ?? global?.ingresoReferencia ?? null,
    limiteGastoReferencia: quincena?.limiteGastoReferencia ?? global?.limiteGastoReferencia ?? null,
    ingresoEsOverride: quincena?.ingresoReferencia != null,
    limiteEsOverride: quincena?.limiteGastoReferencia != null,
  }
}

// Valida un monto de referencia opcional: null limpia el valor, un numero >= 0
// lo fija, cualquier otra cosa es invalido. undefined significa "no tocar".
// Compartido por PUT /api/configuracion (global) y PUT /api/quincenas/[id]
// (override por quincena).
export function parseMontoReferencia(value: unknown, campo: string) {
  if (value === undefined) return { ok: true as const, value: undefined }
  if (value === null) return { ok: true as const, value: null }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false as const, error: `${campo} debe ser un numero mayor o igual a 0, o null` }
  }
  return { ok: true as const, value: n }
}
