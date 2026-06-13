import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
    })

    return NextResponse.json(cuentas)
  } catch (error) {
    console.error('Error fetching cuentas:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre, tipo } = body

    if (!nombre) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.cuenta.findFirst({ where: { nombre } })
    if (existing) {
      return NextResponse.json({ error: 'Cuenta already exists' }, { status: 409 })
    }

    const cuenta = await prisma.cuenta.create({
      data: { nombre, tipo },
    })

    return NextResponse.json(cuenta, { status: 201 })
  } catch (error) {
    console.error('Error creating cuenta:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
