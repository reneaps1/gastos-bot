import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaId = searchParams.get('quincenaId')
    const procesado = searchParams.get('procesado')

    const where: any = {}
    if (quincenaId) where.quincenaId = parseInt(quincenaId)
    if (procesado !== null && procesado !== undefined && procesado !== '') where.procesado = procesado === 'true'

    const entradas = await prisma.entradaRapida.findMany({
      where,
      include: { categoria: true, quincena: true, transaccion: true },
      orderBy: { fechaRegistro: 'desc' },
    })

    return NextResponse.json(entradas)
  } catch (error) {
    console.error('Error fetching entradas rapidas:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { fecha, descripcion, monto, categoriaId, tipo, quincenaId, notas } = body

    if (!fecha || !descripcion || !monto) {
      return NextResponse.json({ error: 'Missing required fields: fecha, descripcion, monto' }, { status: 400 })
    }

    const entrada = await prisma.entradaRapida.create({
      data: {
        fecha: new Date(fecha),
        descripcion,
        monto: parseFloat(monto),
        categoriaId: categoriaId ? parseInt(categoriaId) : null,
        tipo: tipo || null,
        quincenaId: quincenaId ? parseInt(quincenaId) : null,
        notas: notas || null,
      },
      include: { categoria: true, quincena: true },
    })

    return NextResponse.json(entrada, { status: 201 })
  } catch (error) {
    console.error('Error creating entrada rapida:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
