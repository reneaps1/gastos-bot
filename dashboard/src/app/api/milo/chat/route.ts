import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { CHAT_ID_WEB, MAX_PREGUNTA, MiloBotError, llamarBot } from '@/lib/milo-bot'

// Chat de Milo en el dashboard. Solo para una sesion de USUARIO: el token de
// servicio (que usa el bot para llamar al dashboard) no puede abrir el chat.
// El agente vive en el bot; esta ruta solo valida y reenvia (ver lib/milo-bot).
export async function POST(request: Request) {
  const session = await getSession()
  if (!session || session.servicio) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const pregunta = typeof body?.pregunta === 'string' ? body.pregunta.trim() : ''
  const chatId = typeof body?.chatId === 'string' ? body.chatId : ''
  const usuario = typeof body?.usuario === 'string' ? body.usuario.slice(0, 50) : null

  if (!pregunta || pregunta.length > MAX_PREGUNTA) {
    return NextResponse.json({ error: `Escribe de 1 a ${MAX_PREGUNTA} caracteres.` }, { status: 400 })
  }
  if (!CHAT_ID_WEB.test(chatId)) {
    return NextResponse.json({ error: 'chatId invalido' }, { status: 400 })
  }

  try {
    const r = await llamarBot('/agente/web', { pregunta, chatId, usuario })
    return NextResponse.json(r)
  } catch (error) {
    const e = error instanceof MiloBotError ? error : new MiloBotError('Milo tuvo un problema.')
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
}
