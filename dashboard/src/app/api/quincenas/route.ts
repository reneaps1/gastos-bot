import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const codigo = searchParams.get('codigo')

    const where: any = {}
    if (codigo) where.codigo = codigo

    const quincenas = await prisma.quincena.findMany({
      where,
      orderBy: { fechaInicio: 'asc' },
    })

    return NextResponse.json(quincenas)
  } catch (error) {
    console.error('Error fetching quincenas:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { codigo, fechaInicio, fechaFin } = body

    if (!codigo || !fechaInicio || !fechaFin) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.quincena.findFirst({ where: { codigo } })
    if (existing) {
      return NextResponse.json({ error: 'Quincena already exists' }, { status: 409 })
    }

    const quincena = await prisma.quincena.create({
      data: {
        codigo,
        fechaInicio: new Date(fechaInicio),
        fechaFin: new Date(fechaFin),
      },
    })

    return NextResponse.json(quincena, { status: 201 })
  } catch (error) {
    console.error('Error creating quincena:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
