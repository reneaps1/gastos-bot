// Colores del % usado de una partida (o de un total de partidas). Compartidos
// entre Presupuesto (Tarjetas y Tabla) y el Inicio, para que la misma barra
// tenga el mismo color en las dos pantallas.
export function pctColor(pct: number) {
  return pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
}

export function pctTextColor(pct: number) {
  return pct > 90 ? 'text-rose-600 dark:text-rose-400' : pct > 70 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
}
