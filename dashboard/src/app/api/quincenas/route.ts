import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findOverlap, findGapWarnings } from '@/lib/quincena-validation'
import { parseMontoReferencia } from '@/lib/referencia'

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
    const { codigo, fechaInicio, fechaFin, tipo, ingresoReferencia, limiteGastoReferencia } = body

    if (!codigo || !fechaInicio || !fechaFin) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (fechaFin < fechaInicio) {
      return NextResponse.json({ error: 'fechaFin debe ser posterior a fechaInicio' }, { status: 400 })
    }

    const ingreso = parseMontoReferencia(ingresoReferencia, 'ingresoReferencia')
    if (!ingreso.ok) return NextResponse.json({ error: ingreso.error }, { status: 400 })
    const limite = parseMontoReferencia(limiteGastoReferencia, 'limiteGastoReferencia')
    if (!limite.ok) return NextResponse.json({ error: limite.error }, { status: 400 })

    const existing = await prisma.quincena.findFirst({ where: { codigo } })
    if (existing) {
      return NextResponse.json({ error: 'Quincena already exists' }, { status: 409 })
    }

    const others = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
    const overlap = findOverlap(others, fechaInicio, fechaFin)
    if (overlap) {
      return NextResponse.json({ error: `Se traslapa con ${overlap.codigo}` }, { status: 409 })
    }

    const quincena = await prisma.quincena.create({
      data: {
        codigo,
        fechaInicio: new Date(fechaInicio),
        fechaFin: new Date(fechaFin),
        ...(tipo !== undefined && { tipo }),
        ...(ingreso.value !== undefined && { ingresoReferencia: ingreso.value }),
        ...(limite.value !== undefined && { limiteGastoReferencia: limite.value }),
      },
    })

    const warnings = findGapWarnings(others, fechaInicio, fechaFin)

    return NextResponse.json({ ...quincena, warnings }, { status: 201 })
  } catch (error) {
    console.error('Error creating quincena:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
