// Autofiltro por columna de la tabla de Presupuesto (menu de cada encabezado,
// estilo Excel). Se aplica EN ADICION a los chips de filtro de arriba: los
// chips son atajos de un valor; esto permite varios valores y rangos.
//
// La tabla de Presupuesto trae todas las partidas de la(s) quincena(s)
// elegida(s) de una vez, asi que filtrar aqui (en el cliente) alcanza a todas
// las filas, a diferencia de Transacciones, que pagina en el servidor.

export interface RangoNum { min: string; max: string }
export interface RangoFecha { desde: string; hasta: string }

export interface ColFiltros {
  quincena: string[] // quincenaId
  categoria: string[] // categoriaId
  descripcion: string
  clasificacion: string[] // 'Fijo' | 'Variable' | SIN_CLASIFICACION
  presupuestado: RangoNum
  real: RangoNum
  pct: RangoNum
  restante: RangoNum
  recurrente: string[] // 'QUINCENAL' | 'MENSUAL' | NO_RECURRENTE
  vence: RangoFecha
}

export const SIN_CLASIFICACION = 'sin'
export const NO_RECURRENTE = 'no'

export const COL_FILTROS_VACIOS: ColFiltros = {
  quincena: [], categoria: [], descripcion: '', clasificacion: [],
  presupuestado: { min: '', max: '' }, real: { min: '', max: '' },
  pct: { min: '', max: '' }, restante: { min: '', max: '' },
  recurrente: [], vence: { desde: '', hasta: '' },
}

/** Lo minimo que el filtro necesita de una partida. */
export interface FilaFiltrable {
  quincenaId: number
  categoriaId: number
  descripcion: string
  clasificacion: string | null
  montoEfectivo: number
  real: number
  pct: number
  recurrente: boolean
  frecuencia: string | null
  fechaVencimiento: string | null
}

/** Restante con signo: negativo cuando la partida esta excedida. Es el mismo
 *  valor por el que ordena la columna Restante/Excedido. */
export function restanteDe(p: Pick<FilaFiltrable, 'montoEfectivo' | 'real'>) {
  return p.montoEfectivo - p.real
}

export function frecuenciaDe(p: Pick<FilaFiltrable, 'recurrente' | 'frecuencia'>) {
  if (!p.recurrente) return NO_RECURRENTE
  return p.frecuencia === 'MENSUAL' ? 'MENSUAL' : 'QUINCENAL'
}

function enRango(valor: number, r: RangoNum) {
  const min = r.min === '' ? NaN : Number(r.min)
  const max = r.max === '' ? NaN : Number(r.max)
  if (Number.isFinite(min) && valor < min) return false
  if (Number.isFinite(max) && valor > max) return false
  return true
}

function enLista(valor: string, lista: string[]) {
  return lista.length === 0 || lista.includes(valor)
}

export function rangoActivo(r: RangoNum) {
  return r.min !== '' || r.max !== ''
}

export function hayColFiltros(f: ColFiltros) {
  return f.quincena.length > 0 || f.categoria.length > 0 || f.descripcion.trim() !== ''
    || f.clasificacion.length > 0 || f.recurrente.length > 0
    || rangoActivo(f.presupuestado) || rangoActivo(f.real) || rangoActivo(f.pct) || rangoActivo(f.restante)
    || f.vence.desde !== '' || f.vence.hasta !== ''
}

export function matchesColFiltros(p: FilaFiltrable, f: ColFiltros) {
  if (!enLista(String(p.quincenaId), f.quincena)) return false
  if (!enLista(String(p.categoriaId), f.categoria)) return false
  const needle = f.descripcion.trim().toLowerCase()
  if (needle && !p.descripcion.toLowerCase().includes(needle)) return false
  if (!enLista(p.clasificacion ?? SIN_CLASIFICACION, f.clasificacion)) return false
  if (!enRango(p.montoEfectivo, f.presupuestado)) return false
  if (!enRango(p.real, f.real)) return false
  if (!enRango(p.pct, f.pct)) return false
  if (!enRango(restanteDe(p), f.restante)) return false
  if (!enLista(frecuenciaDe(p), f.recurrente)) return false
  if (f.vence.desde || f.vence.hasta) {
    // Con un rango de fechas puesto, las partidas sin vencimiento no entran:
    // no hay forma de decir que "vencen" dentro del rango.
    const fecha = p.fechaVencimiento?.slice(0, 10)
    if (!fecha) return false
    if (f.vence.desde && fecha < f.vence.desde) return false
    if (f.vence.hasta && fecha > f.vence.hasta) return false
  }
  return true
}
