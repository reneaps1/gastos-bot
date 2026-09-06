import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const apartados = await prisma.apartado.findMany({
      orderBy: { nombre: 'asc' },
      include: {
        _count: {
          select: { transacciones: true }
        }
      }
    })

    const result = apartados.map(a => ({
      id: a.id,
      nombre: a.nombre,
      metaMonto: a.metaMonto,
      icono: a.icono,
      color: a.color,
      activo: a.activo,
      fechaCreacion: a.fechaCreacion,
      transaccionesCount: a._count.transacciones,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching apartados:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre, metaMonto, icono, color } = body

    if (!nombre) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.apartado.findFirst({ where: { nombre } })
    if (existing) {
      return NextResponse.json({ error: 'Apartado already exists' }, { status: 409 })
    }

    const apartado = await prisma.apartado.create({
      data: {
        nombre,
        metaMonto: metaMonto !== undefined && metaMonto !== null && metaMonto !== '' ? parseFloat(metaMonto) : null,
        icono: icono || null,
        color: color || null,
      },
    })

    return NextResponse.json(apartado, { status: 201 })
  } catch (error) {
    console.error('Error creating apartado:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
