import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const presupuestoId = parseInt(idStr)
    if (isNaN(presupuestoId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const comentarios = await prisma.comentarioPresupuesto.findMany({
      where: { presupuestoId },
      orderBy: { fechaCreacion: 'asc' },
      include: { user: { select: { id: true, nombre: true } } },
    })

    return NextResponse.json(comentarios)
  } catch (error) {
    console.error('Error fetching comentarios:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const presupuestoId = parseInt(idStr)
    if (isNaN(presupuestoId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await request.json()
    const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
    if (!texto) return NextResponse.json({ error: 'texto es requerido' }, { status: 400 })

    const presupuesto = await prisma.presupuesto.findUnique({ where: { id: presupuestoId } })
    if (!presupuesto) return NextResponse.json({ error: 'Presupuesto not found' }, { status: 404 })

    const userId = body.userId ? parseInt(body.userId) : null

    const comentario = await prisma.comentarioPresupuesto.create({
      data: { presupuestoId, userId: userId && !isNaN(userId) ? userId : null, texto },
      include: { user: { select: { id: true, nombre: true } } },
    })

    return NextResponse.json(comentario, { status: 201 })
  } catch (error) {
    console.error('Error creating comentario:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
