import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TIPOS_VALIDOS = ['QUINCENAL', 'SEMANAL', 'MENSUAL']

export async function GET() {
  try {
    const config = await prisma.configuracion.findFirst()
    return NextResponse.json(config ?? { id: 1, frecuenciaPagoDefault: 'QUINCENAL' })
  } catch (error) {
    console.error('Error fetching configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { frecuenciaPagoDefault } = body

    if (!TIPOS_VALIDOS.includes(frecuenciaPagoDefault)) {
      return NextResponse.json({ error: `frecuenciaPagoDefault debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` }, { status: 400 })
    }

    const config = await prisma.configuracion.upsert({
      where: { id: 1 },
      update: { frecuenciaPagoDefault },
      create: { id: 1, frecuenciaPagoDefault },
    })

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error updating configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
