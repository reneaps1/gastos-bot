export function KpiCard({ label, value, icon, color, bg, subtitle, subtitleColor, action }: {
  label: string; value: string; icon: React.ReactNode; color: string; bg: string
  subtitle?: string; subtitleColor?: string; action?: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all">
      {/* En el telefono las tarjetas van de dos en dos (~165px) y la caja del
          icono (40px + gap) dejaba al monto sin espacio: "$11,33...". Debajo de
          sm el icono se oculta y el monto usa todo el ancho; en escritorio se
          ve igual que siempre. */}
      <div className={`hidden sm:flex w-10 h-10 rounded-lg ${bg} items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 w-full sm:w-auto">
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
        {/* Un monto nunca se recorta en el telefono: si de verdad no cabe,
            salta de linea. Desde sm vuelve al truncate de siempre. */}
        <p className={`text-lg font-bold ${color} tabular-nums [overflow-wrap:anywhere] sm:truncate`}>{value}</p>
        {/* Dos lineas antes de recortar: el subtitulo suele llevar el "por que" del
            numero ("te faltan · comprometiste mas de lo que ingreso"), y con
            una sola linea justo esa parte era la que se perdia. */}
        {subtitle && <p title={subtitle} className={`text-xs line-clamp-2 tabular-nums mt-0.5 ${subtitleColor ?? 'text-slate-400 dark:text-slate-500'}`}>{subtitle}</p>}
        {action}
      </div>
    </div>
  )
}
