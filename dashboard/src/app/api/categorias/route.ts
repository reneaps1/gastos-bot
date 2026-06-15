import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const categorias = await prisma.categoria.findMany({
      orderBy: { nombre: 'asc' },
      include: {
        _count: {
          select: { transacciones: true }
        }
      }
    })

    const result = categorias.map(c => ({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      clasificacion: c.clasificacion,
      ejemplos: c.ejemplos,
      activo: c.activo,
      transaccionesCount: c._count.transacciones,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching categorias:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre, tipo, clasificacion, ejemplos } = body

    if (!nombre || !tipo) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const existing = await prisma.categoria.findFirst({ where: { nombre } })
    if (existing) {
      return NextResponse.json({ error: 'Categoria already exists' }, { status: 409 })
    }

    const categoria = await prisma.categoria.create({
      data: {
        nombre,
        tipo,
        clasificacion,
        ejemplos,
      },
    })

    return NextResponse.json(categoria, { status: 201 })
  } catch (error) {
    console.error('Error creating categoria:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
