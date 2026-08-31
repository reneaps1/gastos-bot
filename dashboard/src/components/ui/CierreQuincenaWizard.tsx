'use client'
import { useState, useEffect } from 'react'
import { CheckCircle2, ArrowRightCircle, XCircle, Scale, ArrowLeftRight, Loader2 } from 'lucide-react'
import { formatMXN } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import { FormModal } from '@/components/ui/FormModal'
import { getMexicoDateString } from '@/lib/quincena-selection'
import { type GrupoCierre, type LineaPendiente, type MotivoPendiente, MOTIVO_LABEL } from '@/lib/cierre-quincena'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  grupos: GrupoCierre[]
  quincenaActualId: number | null
  quincenaActualCodigo?: string
  onResuelto: () => void
}

const MENSAJE_OK: Record<string, string> = {
  pagar_existente: 'Marcado como pagado',
  registrar_pagado: 'Registrado como pagado',
  mover: 'Movido a la quincena actual',
  cancelar: 'Marcado como cancelado',
  absorber: 'Variación aceptada',
  cubrir: 'Excedente cubierto',
}

const MOTIVO_STYLE: Record<MotivoPendiente, string> = {
  sinRegistro: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-400',
  pendienteDePago: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-400',
  excedido: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-400',
}

type AccionForm = 'registrar_pagado' | 'cancelar' | 'absorber' | 'cubrir'

interface DonanteOption { id: number; descripcion: string; disponible: number }
const SIN_ASIGNAR = 'sinAsignar'

// Resuelve, una por una, las lineas de Gasto que quedaron sin resolver en
// quincenas que ya terminaron. No bloquea nada del resto de la app -- es la
// unica pantalla donde se decide que paso con cada partida atrasada.
export function CierreQuincenaWizard({ open, onOpenChange, grupos, quincenaActualId, quincenaActualCodigo, onResuelto }: Props) {
  const { toast } = useToast()
  const [gruposLocal, setGruposLocal] = useState<GrupoCierre[]>(grupos)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingAccion, setEditingAccion] = useState<AccionForm | null>(null)
  const [montoForm, setMontoForm] = useState('')
  const [fechaForm, setFechaForm] = useState(getMexicoDateString())
  const [notaForm, setNotaForm] = useState('')
  const [origenSel, setOrigenSel] = useState(SIN_ASIGNAR)
  const [donantesPorQuincena, setDonantesPorQuincena] = useState<Record<number, DonanteOption[]>>({})
  const [cargandoDonantes, setCargandoDonantes] = useState(false)

  useEffect(() => { if (open) setGruposLocal(grupos) }, [open, grupos])

  function startForm(item: LineaPendiente, accion: AccionForm) {
    setEditingId(item.id)
    setEditingAccion(accion)
    setMontoForm(item.monto.toFixed(2))
    setFechaForm(getMexicoDateString())
    setNotaForm('')
    setOrigenSel(SIN_ASIGNAR)
  }

  async function abrirCubrir(item: LineaPendiente) {
    startForm(item, 'cubrir')
    if (donantesPorQuincena[item.quincena.id]) return
    setCargandoDonantes(true)
    try {
      const res = await fetch(`/api/presupuestos?quincenaId=${item.quincena.id}`)
      const data: Array<{ id: number; descripcion: string; categoria: { tipo: string }; montoEfectivo: number; real: number }> = await res.json()
      const opciones = data
        .filter(p => p.id !== item.id && p.categoria.tipo === 'Gasto')
        .map(p => ({ id: p.id, descripcion: p.descripcion, disponible: Number((p.montoEfectivo - p.real).toFixed(2)) }))
        .filter(o => o.disponible > 0)
      setDonantesPorQuincena(prev => ({ ...prev, [item.quincena.id]: opciones }))
    } finally {
      setCargandoDonantes(false)
    }
  }

  function cancelForm() {
    setEditingId(null)
    setEditingAccion(null)
  }

  async function ejecutar(item: LineaPendiente, endpoint: 'resolver' | 'transferir', body: Record<string, unknown>, mensajeOk: string) {
    setBusyId(item.id)
    try {
      const res = await fetch(`/api/presupuestos/${item.id}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Error al resolver')
      }
      toast(mensajeOk)
      cancelForm()
      setGruposLocal(prev => prev
        .map(g => g.quincena.id === item.quincena.id
          ? { ...g, items: g.items.filter(i => i.id !== item.id), total: g.total - item.monto }
          : g)
        .filter(g => g.items.length > 0))
      onResuelto()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al resolver', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const totalGeneral = gruposLocal.reduce((s, g) => s + g.total, 0)

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Cerrar quincenas atrasadas"
      maxWidthClass="max-w-2xl"
      subtitle={
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Decide qué pasó con cada partida. No afecta el registro de gastos de la quincena actual.
        </p>
      }
    >
      {gruposLocal.length === 0 ? (
        <div className="py-10 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Todo resuelto. No queda nada atrasado.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Total sin resolver</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">{formatMXN(totalGeneral)}</p>
          </div>

          <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
            {gruposLocal.map(grupo => (
              <div key={grupo.quincena.id}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{grupo.quincena.codigo}</h4>
                  <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{formatMXN(grupo.total)}</span>
                </div>
                <div className="space-y-2">
                  {grupo.items.map(item => {
                    const isBusy = busyId === item.id
                    const isEditing = editingId === item.id
                    const donantes = donantesPorQuincena[item.quincena.id] ?? []
                    return (
                      <div key={item.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{item.descripcion ?? 'Partida'}</p>
                            <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${MOTIVO_STYLE[item.motivo]}`}>
                              {MOTIVO_LABEL[item.motivo]}
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">{formatMXN(item.monto)}</span>
                        </div>

                        {isEditing ? (
                          <div className="space-y-2">
                            {editingAccion === 'registrar_pagado' && (
                              <div className="flex flex-wrap items-center gap-2">
                                <input type="date" value={fechaForm} onChange={e => setFechaForm(e.target.value)}
                                  className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                <input type="number" step="0.01" min="0" value={montoForm} onChange={e => setMontoForm(e.target.value)}
                                  className="w-28 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                              </div>
                            )}
                            {(editingAccion === 'cancelar' || editingAccion === 'absorber') && (
                              <input type="text" placeholder="Nota opcional" value={notaForm} onChange={e => setNotaForm(e.target.value)}
                                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            )}
                            {editingAccion === 'cubrir' && (
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <select value={origenSel} onChange={e => setOrigenSel(e.target.value)} disabled={cargandoDonantes}
                                    className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[220px]">
                                    <option value={SIN_ASIGNAR}>Sin asignar (no afecta otras líneas)</option>
                                    {donantes.map(d => (
                                      <option key={d.id} value={d.id}>{d.descripcion} · disp. {formatMXN(d.disponible)}</option>
                                    ))}
                                  </select>
                                  <input type="number" step="0.01" min="0" value={montoForm} onChange={e => setMontoForm(e.target.value)}
                                    className="w-28 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                </div>
                                {cargandoDonantes && <p className="text-xs text-slate-400 dark:text-slate-500">Buscando líneas con saldo disponible…</p>}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (editingAccion === 'registrar_pagado') {
                                    ejecutar(item, 'resolver', { accion: 'registrar_pagado', fecha: fechaForm, monto: montoForm }, MENSAJE_OK.registrar_pagado)
                                  } else if (editingAccion === 'cubrir') {
                                    ejecutar(item, 'transferir', {
                                      monto: montoForm,
                                      origenId: origenSel === SIN_ASIGNAR ? undefined : origenSel,
                                    }, MENSAJE_OK.cubrir)
                                  } else {
                                    ejecutar(item, 'resolver', { accion: editingAccion, nota: notaForm || undefined }, MENSAJE_OK[editingAccion!])
                                  }
                                }}
                                disabled={isBusy || cargandoDonantes || !montoForm || (editingAccion === 'registrar_pagado' && !fechaForm)}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer disabled:opacity-50">
                                {isBusy && <Loader2 size={11} className="animate-spin" />} Confirmar
                              </button>
                              <button onClick={cancelForm} disabled={isBusy}
                                className="text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.motivo === 'sinRegistro' && (
                              <button onClick={() => startForm(item, 'registrar_pagado')} disabled={isBusy}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                <CheckCircle2 size={11} /> Registrar como pagado
                              </button>
                            )}
                            {item.motivo === 'pendienteDePago' && (
                              <button onClick={() => ejecutar(item, 'resolver', { accion: 'pagar_existente' }, MENSAJE_OK.pagar_existente)} disabled={isBusy}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Marcar como pagado
                              </button>
                            )}
                            {(item.motivo === 'sinRegistro' || item.motivo === 'pendienteDePago') && (
                              <button onClick={() => ejecutar(item, 'resolver', { accion: 'mover', targetQuincenaId: quincenaActualId }, MENSAJE_OK.mover)}
                                disabled={isBusy || !quincenaActualId}
                                title={!quincenaActualId ? 'No hay quincena actual configurada' : undefined}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                <ArrowRightCircle size={11} /> Mover a {quincenaActualCodigo ?? 'quincena actual'}
                              </button>
                            )}
                            {(item.motivo === 'sinRegistro' || item.motivo === 'pendienteDePago') && (
                              <button onClick={() => startForm(item, 'cancelar')} disabled={isBusy}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                <XCircle size={11} /> Cancelar / no aplicó
                              </button>
                            )}
                            {item.motivo === 'excedido' && (
                              <button onClick={() => abrirCubrir(item)} disabled={isBusy}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                <ArrowLeftRight size={11} /> Cubrir desde otra línea
                              </button>
                            )}
                            {item.motivo === 'excedido' && (
                              <button onClick={() => startForm(item, 'absorber')} disabled={isBusy}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50 transition-colors">
                                <Scale size={11} /> Aceptar variación
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-4">
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors">
          Cerrar
        </button>
      </div>
    </FormModal>
  )
}
