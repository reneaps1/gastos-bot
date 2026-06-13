import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const deudas = await prisma.deuda.findMany({
      orderBy: { deudaOriginal: 'desc' },
    })

    const catDeudas = await prisma.categoria.findFirst({ where: { nombre: 'Deudas' } })

    const deudasConAbonos = await Promise.all(
      deudas.map(async (d) => {
        let totalAbonado = 0
        if (catDeudas) {
          const res = await prisma.transaccion.aggregate({
            where: {
              categoriaId: catDeudas.id,
              notas: { contains: d.acreedor, mode: 'insensitive' },
            },
            _sum: { monto: true },
          })
          totalAbonado = Number(res._sum.monto ?? 0)
        }
        const original = Number(d.deudaOriginal)
        const saldo = Math.max(original - totalAbonado, 0)
        const pct = original > 0 ? Math.min((totalAbonado / original) * 100, 100) : 0
        const abonoMensual = Number(d.abonoMensual ?? 0)
        const mesesRestantes = abonoMensual > 0 ? Math.ceil(saldo / abonoMensual) : null
        return { ...d, totalAbonado, saldo, pct, mesesRestantes }
      })
    )

    return NextResponse.json(deudasConAbonos)
  } catch (error) {
    console.error('Error fetching deudas:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { acreedor, deudaOriginal, abonoMensual, notas, fechaInicio } = body

    if (!acreedor || !deudaOriginal) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const deuda = await prisma.deuda.create({
      data: {
        acreedor,
        deudaOriginal: parseFloat(deudaOriginal),
        abonoMensual: abonoMensual ? parseFloat(abonoMensual) : null,
        notas,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : null,
      },
    })

    return NextResponse.json(deuda, { status: 201 })
  } catch (error) {
    console.error('Error creating deuda:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
