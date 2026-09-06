import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const activoParam = searchParams.get('activo')

    const cuentas = await prisma.cuenta.findMany({
      where: activoParam != null ? { activo: activoParam === 'true' } : undefined,
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
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
    const { nombre, tipo, icono, color, orden } = body

    if (!nombre) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.cuenta.findFirst({ where: { nombre } })
    if (existing) {
      return NextResponse.json({ error: 'Cuenta already exists' }, { status: 409 })
    }

    const cuenta = await prisma.cuenta.create({
      data: {
        nombre,
        tipo: tipo || null,
        icono: icono || null,
        color: color || null,
        orden: orden !== undefined && orden !== null && orden !== '' ? parseInt(orden) : 0,
      },
    })

    return NextResponse.json(cuenta, { status: 201 })
  } catch (error) {
    console.error('Error creating cuenta:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
