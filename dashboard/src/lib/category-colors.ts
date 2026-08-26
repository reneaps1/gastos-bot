// Paleta de colores por categoria, compartida entre el reporte de quincena y
// la grafica de Analisis en Presupuesto (misma categoria = mismo color en
// toda la app).
export const CAT_COLOR: Record<string, string> = {
  Hogar: '#f97316', Salud: '#f43f5e', Familia: '#ec4899', Transporte: '#0ea5e9',
  Suscripciones: '#8b5cf6', Deudas: '#ef4444', Personal: '#f59e0b', Ingresos: '#10b981',
  Ahorro: '#3b82f6', Diversión: '#14b8a6', Super: '#84cc16', Telefonia: '#6366f1',
}
const FALLBACK_COLORS = ['#64748b', '#a855f7', '#0891b2', '#ca8a04', '#be185d']

export function colorForCategoria(nombre: string, index: number) {
  return CAT_COLOR[nombre] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}
