interface Quincena { id: number; codigo: string; fechaInicio: string; fechaFin: string }

interface Props {
  quincenas: Quincena[]
  selectedId: string
  today: string
}

export function QuincenaStatus({ quincenas, selectedId, today }: Props) {
  const activeQ = quincenas.find(q => {
    const ini = q.fechaInicio.split('T')[0]
    const fin = q.fechaFin.split('T')[0]
    return today >= ini && today <= fin
  })

  if (!activeQ) return null

  const isViewingActive = quincenas.find(q => q.id.toString() === selectedId)?.id === activeQ.id

  if (isViewingActive) {
    const ini = new Date(activeQ.fechaInicio.split('T')[0] + 'T00:00:00Z')
    const fin = new Date(activeQ.fechaFin.split('T')[0] + 'T00:00:00Z')
    const tod = new Date(today + 'T00:00:00Z')
    const totalMs = fin.getTime() - ini.getTime()
    const elapsedMs = tod.getTime() - ini.getTime()
    const pct = Math.min(Math.max(Math.round((elapsedMs / totalMs) * 100), 0), 100)
    const daysLeft = Math.round((fin.getTime() - tod.getTime()) / 86400000) + 1

    return (
      <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-3 py-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">En curso</span>
        <span className="text-xs text-emerald-600/70 dark:text-emerald-500/70 hidden sm:inline">·</span>
        <span className="text-xs text-emerald-600 dark:text-emerald-500 hidden sm:inline">
          {daysLeft} {daysLeft === 1 ? 'día restante' : 'días restantes'}
        </span>
        <div className="flex-1 h-1.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-full overflow-hidden min-w-[60px]">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500 tabular-nums shrink-0">{pct}%</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
      <span>Quincena histórica</span>
      <span>·</span>
      <span>Activa: <span className="font-medium text-slate-500 dark:text-slate-400">{activeQ.codigo}</span></span>
    </div>
  )
}
