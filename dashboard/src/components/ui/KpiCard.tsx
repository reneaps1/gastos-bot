export function KpiCard({ label, value, icon, color, bg, subtitle, subtitleColor, action }: {
  label: string; value: string; icon: React.ReactNode; color: string; bg: string
  subtitle?: string; subtitleColor?: string; action?: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className={`text-lg font-bold ${color} truncate tabular-nums`}>{value}</p>
        {subtitle && <p className={`text-xs truncate tabular-nums mt-0.5 ${subtitleColor ?? 'text-slate-400 dark:text-slate-500'}`}>{subtitle}</p>}
        {action}
      </div>
    </div>
  )
}
