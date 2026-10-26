import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// Historial de mensajes de WhatsApp, con la transaccion que cada uno genero.
//
// El proxy (src/proxy.ts) ya exige sesion en /api/**, asi que esta ruta no es
// publica. Aun asi se valida la sesion aqui adentro: el proxy es una sola
// capa y esta ruta devuelve el historial de TODOS los gastos de la familia,
// con montos y descripciones. Si alguna vez el proxy se desactiva, se renombra
// o el matcher cambia, esta ruta seguiria exigiendo sesion.
export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20') || 20, 200)

    const messages = await prisma.whatsappMessage.findMany({
      orderBy: { fechaMensaje: 'desc' },
      take: limit,
      include: { transaccion: { include: { quincena: true } } },
    })

    return NextResponse.json(messages)
  } catch (error) {
    console.error('Error fetching whatsapp messages:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
