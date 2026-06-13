import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')
    const tipo = searchParams.get('tipo')
    const categoriaId = searchParams.get('categoriaId')
    const userId = searchParams.get('userId')
    const page = parseInt(searchParams.get('page') ?? '1')
    const limit = parseInt(searchParams.get('limit') ?? '50')
    const skip = (page - 1) * limit

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (tipo) where.tipo = tipo
    if (categoriaId) where.categoriaId = parseInt(categoriaId)
    if (userId) where.userId = parseInt(userId)

    const [transacciones, total] = await Promise.all([
      prisma.transaccion.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
        include: { categoria: true, user: true, quincena: true, metodoPago: true },
      }),
      prisma.transaccion.count({ where }),
    ])

    return NextResponse.json({
      data: transacciones,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching transacciones:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { fecha, quincenaId, userId, descripcion, categoriaId, tipo, monto, metodoPagoId, estatus, notas, source } = body

    if (!fecha || !quincenaId || !descripcion || !categoriaId || !tipo || monto === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const transaccion = await prisma.transaccion.create({
      data: {
        fecha: new Date(fecha),
        quincenaId: parseInt(quincenaId),
        userId: userId ? parseInt(userId) : null,
        descripcion,
        categoriaId: parseInt(categoriaId),
        tipo,
        monto: parseFloat(monto),
        metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null,
        estatus: estatus ?? 'Pendiente',
        notas,
        source: source ?? 'api',
      },
      include: { categoria: true, user: true, quincena: true },
    })

    return NextResponse.json(transaccion, { status: 201 })
  } catch (error) {
    console.error('Error creating transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
