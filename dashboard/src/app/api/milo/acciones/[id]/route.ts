import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { CHAT_ID_WEB, MiloBotError, llamarBot } from '@/lib/milo-bot'

// Confirmar o cancelar una propuesta de Milo desde el chat del dashboard. La
// validacion de verdad (mismo chat, pendiente, vigente, un toque una
// ejecucion) vive en el bot, en src/miloAcciones.js.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session || session.servicio) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { id } = await params
  if (!/^\d{1,10}$/.test(id)) return NextResponse.json({ error: 'Id invalido' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const accion = body?.accion
  const chatId = typeof body?.chatId === 'string' ? body.chatId : ''
  const usuario = typeof body?.usuario === 'string' ? body.usuario.slice(0, 50) : null
  if (accion !== 'confirmar' && accion !== 'cancelar') {
    return NextResponse.json({ error: 'accion invalida' }, { status: 400 })
  }
  if (!CHAT_ID_WEB.test(chatId)) return NextResponse.json({ error: 'chatId invalido' }, { status: 400 })

  try {
    const r = await llamarBot(`/agente/web/acciones/${id}`, { accion, chatId, usuario })
    return NextResponse.json(r)
  } catch (error) {
    const e = error instanceof MiloBotError ? error : new MiloBotError('Milo tuvo un problema.')
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
}
