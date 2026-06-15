import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') ?? '20')

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
