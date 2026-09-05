'use client'

interface Quincena { id: number; codigo: string }

interface Props {
  /** Ya ordenadas por fechaInicio asc -- el slider se mueve por índice, no por id. */
  quincenas: Quincena[]
  desdeId: string
  hastaId: string
  onChange: (desdeId: string, hastaId: string) => void
}

// Slider de rango de dos manijas para elegir Desde/Hasta sobre una lista
// discreta de quincenas -- sin librería (no hay ninguna de slider instalada
// en el proyecto), con el truco estándar de dos <input type=range>
// superpuestos sobre el mismo track. El valor de cada input es el ÍNDICE
// dentro de `quincenas`, no el id, así el paso siempre es "una quincena".
export function QuincenaRangeSlider({ quincenas, desdeId, hastaId, onChange }: Props) {
  const n = quincenas.length
  const maxIdx = Math.max(0, n - 1)
  const rawDesdeIdx = quincenas.findIndex(q => q.id.toString() === desdeId)
  const rawHastaIdx = quincenas.findIndex(q => q.id.toString() === hastaId)
  const desdeIdx = rawDesdeIdx === -1 ? 0 : rawDesdeIdx
  const hastaIdx = rawHastaIdx === -1 ? maxIdx : rawHastaIdx

  if (n === 0) return null

  function moverDesde(idx: number) {
    const clamped = Math.min(idx, hastaIdx)
    const q = quincenas[clamped]
    if (q) onChange(q.id.toString(), hastaId)
  }
  function moverHasta(idx: number) {
    const clamped = Math.max(idx, desdeIdx)
    const q = quincenas[clamped]
    if (q) onChange(desdeId, q.id.toString())
  }

  const pctDesde = maxIdx === 0 ? 0 : (desdeIdx / maxIdx) * 100
  const pctHasta = maxIdx === 0 ? 100 : (hastaIdx / maxIdx) * 100

  return (
    <div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="absolute h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ left: `${pctDesde}%`, right: `${100 - pctHasta}%` }} />
        <input type="range" min={0} max={maxIdx} step={1} value={desdeIdx}
          onChange={e => moverDesde(Number(e.target.value))}
          aria-label="Quincena de inicio del rango"
          className="qrs-thumb absolute inset-x-0 w-full" />
        <input type="range" min={0} max={maxIdx} step={1} value={hastaIdx}
          onChange={e => moverHasta(Number(e.target.value))}
          aria-label="Quincena de fin del rango"
          className="qrs-thumb absolute inset-x-0 w-full" />
      </div>
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1.5">
        <span className="font-medium text-indigo-600 dark:text-indigo-400">{quincenas[desdeIdx]?.codigo}</span>
        <span className="font-medium text-indigo-600 dark:text-indigo-400">{quincenas[hastaIdx]?.codigo}</span>
      </div>
      <style jsx>{`
        .qrs-thumb {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          margin: 0;
          pointer-events: none;
        }
        .qrs-thumb::-webkit-slider-runnable-track { background: transparent; }
        .qrs-thumb::-moz-range-track { background: transparent; }
        .qrs-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          pointer-events: auto;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #4f46e5;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .qrs-thumb::-moz-range-thumb {
          pointer-events: auto;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #4f46e5;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
