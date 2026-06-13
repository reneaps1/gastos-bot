import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const metodos = await prisma.metodoPago.findMany({
      orderBy: { nombre: 'asc' },
    })

    return NextResponse.json(metodos)
  } catch (error) {
    console.error('Error fetching metodos pago:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre } = body

    if (!nombre) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.metodoPago.findFirst({ where: { nombre } })
    if (existing) {
      return NextResponse.json({ error: 'Método de pago already exists' }, { status: 409 })
    }

    const metodo = await prisma.metodoPago.create({
      data: { nombre },
    })

    return NextResponse.json(metodo, { status: 201 })
  } catch (error) {
    console.error('Error creating metodo pago:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
