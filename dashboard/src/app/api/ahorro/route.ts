import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const catAhorro = await prisma.categoria.findFirst({ where: { nombre: 'Ahorro' } })
    if (!catAhorro) {
      return NextResponse.json({ total: 0, porQuincena: [], transacciones: [] })
    }

    const txs = await prisma.transaccion.findMany({
      where: { categoriaId: catAhorro.id },
      orderBy: { fecha: 'asc' },
      include: { quincena: true, user: true },
    })

    // Aportación (Gasto o Ahorro tipo) suma al saldo; retiro (Ingreso tipo) resta.
    let running = 0
    const conBalance = txs.map(t => {
      const monto = Number(t.monto)
      running += t.tipo === 'Ingreso' ? -monto : monto
      return { ...t, balanceAcumulado: running }
    })
    const total = running

    const porQuincenaMap = new Map<number, { quincena: (typeof txs)[number]['quincena']; aportado: number; retirado: number }>()
    for (const t of txs) {
      const monto = Number(t.monto)
      const entry = porQuincenaMap.get(t.quincenaId) ?? { quincena: t.quincena, aportado: 0, retirado: 0 }
      if (t.tipo === 'Ingreso') entry.retirado += monto
      else entry.aportado += monto
      porQuincenaMap.set(t.quincenaId, entry)
    }
    const porQuincena = Array.from(porQuincenaMap.values())
      .sort((a, b) => a.quincena.fechaInicio.getTime() - b.quincena.fechaInicio.getTime())

    return NextResponse.json({ total, porQuincena, transacciones: [...conBalance].reverse() })
  } catch (error) {
    console.error('Error fetching ahorro:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
