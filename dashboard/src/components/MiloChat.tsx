'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bot, Check, Loader2, RotateCcw, Send, UserRound, X } from 'lucide-react'
import { avisarDatosCambiaron } from '@/lib/milo-eventos'

// Chat con Milo, el mismo agente de Telegram, desde cualquier pagina del
// dashboard (y de la app iOS, que carga esta misma URL). Montado una sola vez
// en Providers.tsx, como la calculadora, para que sobreviva a la navegacion.
//
// El agente NO vive aqui: /api/milo/* reenvia al bot (src/agenteWeb.js). Las
// propuestas de cambio llegan como tarjetas con Confirmar / Cancelar; nada
// cambia hasta el toque, igual que en Telegram, y la validacion de verdad la
// hace el bot (mismo chat, vigente, un toque una ejecucion).

type EstadoAccion = 'pendiente' | 'aplicando' | 'hecha' | 'fallida' | 'cancelada'

interface Accion {
  id: number
  resumen: string
  estado: EstadoAccion
  resultado?: string
  reintentable?: boolean
}

interface Mensaje {
  id: string
  rol: 'yo' | 'milo' | 'error'
  texto: string
  acciones?: Accion[]
}

interface Usuario { id: number; nombre: string; activo?: boolean }

const CLAVE_CHAT = 'milo.chatId'
const CLAVE_USUARIO = 'milo.usuario'
const CLAVE_MENSAJES = 'milo.mensajes'
const SUGERENCIAS = ['¿Cuánto me queda?', '¿Qué pagos vienen?', '¿Qué gastos tengo sin asignar?']

// El almacenamiento del navegador puede no estar (modo privado, vista
// previa): todo se envuelve y el chat funciona igual sin el.
function leer(almacen: 'local' | 'session', clave: string): string | null {
  try { return (almacen === 'local' ? localStorage : sessionStorage).getItem(clave) } catch { return null }
}
function guardar(almacen: 'local' | 'session', clave: string, valor: string) {
  try { (almacen === 'local' ? localStorage : sessionStorage).setItem(clave, valor) } catch { /* sin almacenamiento */ }
}

// A nivel de modulo y con un for simple, a proposito. La version anterior
// declaraba el alfabeto dentro de la funcion y lo leia desde un callback de
// Array.from; el minificador de produccion la inlineo en el useEffect, borro
// la declaracion y dejo las referencias: "ReferenceError: letras is not
// defined" y el dashboard entero caido (2026-11-14). En dev no pasaba.
const ALFABETO_CHAT_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function nuevoChatId(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let id = 'web:'
  for (let i = 0; i < bytes.length; i++) id += ALFABETO_CHAT_ID.charAt(bytes[i] % ALFABETO_CHAT_ID.length)
  return id
}

function idLocal() {
  return Math.random().toString(36).slice(2)
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const datos = await res.json().catch(() => null)
  if (!res.ok) throw new Error(datos?.error || 'Milo tuvo un problema. Intenta de nuevo.')
  return datos as T
}

export function MiloChat() {
  const pathname = usePathname()
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [usuario, setUsuario] = useState<string | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [lento, setLento] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Lo guardado en el dispositivo se lee al montar (no en el render: el
  // servidor no tiene localStorage y el HTML tiene que coincidir).
  useEffect(() => {
    let id = leer('local', CLAVE_CHAT)
    if (!id || !/^web:[A-Za-z0-9_-]{6,36}$/.test(id)) {
      id = nuevoChatId()
      guardar('local', CLAVE_CHAT, id)
    }
    let previos: Mensaje[] = []
    try { previos = JSON.parse(leer('session', CLAVE_MENSAJES) || '[]') } catch { previos = [] }
    const timer = window.setTimeout(() => {
      setChatId(id)
      setUsuario(leer('local', CLAVE_USUARIO))
      if (Array.isArray(previos)) setMensajes(previos)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    guardar('session', CLAVE_MENSAJES, JSON.stringify(mensajes.slice(-40)))
  }, [mensajes])

  // Usuarios para "¿Quien eres?": el login del dashboard es uno solo, asi que
  // la persona se elige aqui y se recuerda en el dispositivo.
  useEffect(() => {
    if (!abierto || usuarios) return
    fetch('/api/users')
      .then(r => (r.ok ? r.json() : []))
      .then((lista: Usuario[]) => setUsuarios(Array.isArray(lista) ? lista.filter(u => u.activo !== false) : []))
      .catch(() => setUsuarios([]))
  }, [abierto, usuarios])

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes, enviando, abierto])

  useEffect(() => {
    if (!abierto) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setAbierto(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [abierto])

  const elegirUsuario = useCallback((nombre: string) => {
    setUsuario(nombre)
    guardar('local', CLAVE_USUARIO, nombre)
    setEligiendo(false)
  }, [])

  const enviar = useCallback(async (pregunta: string) => {
    const limpia = pregunta.trim()
    if (!limpia || enviando || !chatId) return
    setTexto('')
    setMensajes(m => [...m, { id: idLocal(), rol: 'yo', texto: limpia }])
    setEnviando(true)
    setLento(false)
    const avisoLento = window.setTimeout(() => setLento(true), 8000)
    try {
      const r = await postJson<{ reply: string | null; error?: string; acciones?: { id: number; resumen: string }[] }>(
        '/api/milo/chat', { pregunta: limpia, chatId, usuario },
      )
      if (!r.reply) {
        setMensajes(m => [...m, { id: idLocal(), rol: 'error', texto: r.error || 'No pude contestar eso ahora.' }])
      } else {
        setMensajes(m => [...m, {
          id: idLocal(),
          rol: 'milo',
          texto: r.reply as string,
          acciones: (r.acciones || []).map(a => ({ id: a.id, resumen: a.resumen, estado: 'pendiente' as const })),
        }])
      }
    } catch (error) {
      setMensajes(m => [...m, { id: idLocal(), rol: 'error', texto: error instanceof Error ? error.message : 'Milo tuvo un problema.' }])
    } finally {
      window.clearTimeout(avisoLento)
      setEnviando(false)
      setLento(false)
    }
  }, [chatId, enviando, usuario])

  const actualizarAccion = useCallback((accionId: number, cambio: Partial<Accion>) => {
    setMensajes(m => m.map(msg => msg.acciones?.some(a => a.id === accionId)
      ? { ...msg, acciones: msg.acciones.map(a => (a.id === accionId ? { ...a, ...cambio } : a)) }
      : msg))
  }, [])

  const resolverAccion = useCallback(async (accionId: number, accion: 'confirmar' | 'cancelar') => {
    if (!chatId) return
    actualizarAccion(accionId, { estado: 'aplicando', resultado: undefined })
    try {
      const r = await postJson<{ ok: boolean; texto: string; reintentable?: boolean }>(
        `/api/milo/acciones/${accionId}`, { accion, chatId, usuario },
      )
      if (r.ok) {
        actualizarAccion(accionId, { estado: accion === 'confirmar' ? 'hecha' : 'cancelada', resultado: r.texto })
        if (accion === 'confirmar') {
          avisarDatosCambiaron()
          router.refresh()
        }
      } else {
        actualizarAccion(accionId, { estado: r.reintentable ? 'fallida' : 'cancelada', resultado: r.texto, reintentable: r.reintentable })
      }
    } catch (error) {
      actualizarAccion(accionId, {
        estado: 'fallida',
        resultado: error instanceof Error ? error.message : 'No se aplicó.',
        reintentable: true,
      })
    }
  }, [actualizarAccion, chatId, router, usuario])

  if (pathname === '/login') return null

  const necesitaUsuario = abierto && (!usuario || eligiendo)

  return (
    <>
      {!abierto && (
        <button onClick={() => setAbierto(true)} aria-label="Abrir chat con Milo"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
          className="fixed right-4 md:!bottom-6 md:right-6 z-[60] flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 cursor-pointer transition-colors">
          <Bot size={20} />
          <span className="text-sm font-semibold">Milo</span>
        </button>
      )}

      {abierto && (
        <div role="dialog" aria-label="Chat con Milo"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
          className="fixed inset-0 md:inset-auto md:bottom-6 md:right-6 md:w-[400px] md:h-[min(640px,calc(100vh-6rem))] md:!p-0 z-[70] flex flex-col bg-white dark:bg-slate-900 md:border md:border-slate-200 md:dark:border-slate-700 md:rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Bot size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Milo</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {usuario ? `Hablando como ${usuario}` : 'Tu asistente de gastos'}
              </p>
            </div>
            {usuario && !eligiendo && (
              <button onClick={() => setEligiendo(true)} aria-label="Cambiar de persona"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <UserRound size={18} />
              </button>
            )}
            <button onClick={() => setAbierto(false)} aria-label="Cerrar chat"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <X size={18} />
            </button>
          </div>

          {necesitaUsuario ? (
            <div className="flex-1 flex flex-col justify-center gap-3 px-6">
              <p className="text-base font-semibold text-slate-800 dark:text-slate-100">¿Quién eres?</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Milo lo usa para saber quién pidió cada cambio. Se recuerda en este dispositivo.</p>
              {usuarios == null ? (
                <Loader2 size={18} className="animate-spin text-slate-400" />
              ) : usuarios.length === 0 ? (
                <p className="text-sm text-rose-600 dark:text-rose-400">No pude cargar los usuarios.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {usuarios.map(u => (
                    <button key={u.id} onClick={() => elegirUsuario(u.nombre)}
                      className={`text-left px-4 py-3 rounded-xl border text-sm font-medium cursor-pointer transition-colors ${
                        u.nombre === usuario
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}>
                      {u.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {mensajes.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Pregúntame por tu dinero o pídeme un cambio, por ejemplo &ldquo;cambia el monto del uber a 90&rdquo;. Los cambios solo se hacen cuando tocas Confirmar.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {SUGERENCIAS.map(s => (
                        <button key={s} onClick={() => enviar(s)}
                          className="px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mensajes.map(m => (
                  <div key={m.id} className={`flex flex-col gap-2 ${m.rol === 'yo' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                      m.rol === 'yo'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : m.rol === 'error'
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-bl-md'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-md'
                    }`}>
                      {m.texto}
                    </div>
                    {m.acciones?.map(a => (
                      <TarjetaAccion key={a.id} accion={a}
                        onConfirmar={() => resolverAccion(a.id, 'confirmar')}
                        onCancelar={() => resolverAccion(a.id, 'cancelar')} />
                    ))}
                  </div>
                ))}

                {enviando && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    {lento ? 'Despertando a Milo (puede tardar hasta un minuto)…' : 'Milo está pensando…'}
                  </div>
                )}
                <div ref={finRef} />
              </div>

              <form onSubmit={e => { e.preventDefault(); void enviar(texto) }}
                className="flex items-end gap-2 px-3 py-3 border-t border-slate-200 dark:border-slate-700">
                <textarea ref={inputRef} value={texto} rows={1} maxLength={1000}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(texto) } }}
                  placeholder="Escribe a Milo…" aria-label="Mensaje para Milo"
                  className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar"
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer">
                  <Send size={17} />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  )
}

function TarjetaAccion({ accion, onConfirmar, onCancelar }: { accion: Accion; onConfirmar: () => void; onCancelar: () => void }) {
  const terminada = accion.estado === 'hecha' || accion.estado === 'cancelada'
  return (
    <div className="w-[85%] rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 overflow-hidden">
      <p className="px-3.5 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Cambio propuesto</p>
      <p className="px-3.5 pb-3 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words">{accion.resumen}</p>
      {accion.resultado && (
        <p className={`mx-3.5 mb-3 px-3 py-2 rounded-lg text-sm ${
          accion.estado === 'hecha'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : accion.estado === 'fallida'
              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
        }`}>{accion.resultado}</p>
      )}
      {!terminada && (
        <div className="flex border-t border-indigo-200 dark:border-indigo-900">
          <button onClick={onConfirmar} disabled={accion.estado === 'aplicando'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-60 cursor-pointer">
            {accion.estado === 'aplicando'
              ? <><Loader2 size={15} className="animate-spin" /> Aplicando…</>
              : accion.estado === 'fallida'
                ? <><RotateCcw size={15} /> Reintentar</>
                : <><Check size={15} /> Confirmar</>}
          </button>
          <button onClick={onCancelar} disabled={accion.estado === 'aplicando'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-slate-500 dark:text-slate-400 border-l border-indigo-200 dark:border-indigo-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 cursor-pointer">
            <X size={15} /> Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
