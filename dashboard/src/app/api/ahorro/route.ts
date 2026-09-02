import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const catAhorro = await prisma.categoria.findFirst({ where: { nombre: 'Ahorro' } })
    if (!catAhorro) {
      return NextResponse.json({ total: 0, porQuincena: [], porApartado: [], transacciones: [] })
    }

    const [txs, apartados] = await Promise.all([
      prisma.transaccion.findMany({
        where: { categoriaId: catAhorro.id },
        orderBy: { fecha: 'asc' },
        include: { quincena: true, user: true, apartado: true },
      }),
      prisma.apartado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ])

    // Aporte suma al saldo, Retiro resta. monto siempre es positivo, la
    // direccion es la unica forma de saber el signo (ver
    // @/lib/transaccion-ahorro). Antes de que direccion existiera, esto se
    // inferia de tipo==='Ingreso' -- ya no aplica, toda transaccion de esta
    // categoria queda con tipo:'Ahorro' (ver migracion de backfill).
    let running = 0
    const conBalance = txs.map(t => {
      const monto = Number(t.monto)
      running += t.direccion === 'Retiro' ? -monto : monto
      return { ...t, balanceAcumulado: running }
    })
    const total = running

    const porQuincenaMap = new Map<number, { quincena: (typeof txs)[number]['quincena']; aportado: number; retirado: number }>()
    for (const t of txs) {
      const monto = Number(t.monto)
      const entry = porQuincenaMap.get(t.quincenaId) ?? { quincena: t.quincena, aportado: 0, retirado: 0 }
      if (t.direccion === 'Retiro') entry.retirado += monto
      else entry.aportado += monto
      porQuincenaMap.set(t.quincenaId, entry)
    }
    const porQuincena = Array.from(porQuincenaMap.values())
      .sort((a, b) => a.quincena.fechaInicio.getTime() - b.quincena.fechaInicio.getTime())

    // Desglose por apartado, incluyendo un bucket sintetico "General" para
    // las transacciones sin apartadoId asignado.
    type ApartadoBucket = { apartado: (typeof apartados)[number] | null; aportado: number; retirado: number; balance: number }
    const porApartadoMap = new Map<number | null, ApartadoBucket>()
    porApartadoMap.set(null, { apartado: null, aportado: 0, retirado: 0, balance: 0 })
    for (const a of apartados) porApartadoMap.set(a.id, { apartado: a, aportado: 0, retirado: 0, balance: 0 })
    for (const t of txs) {
      const monto = Number(t.monto)
      const key = t.apartadoId ?? null
      const entry = porApartadoMap.get(key) ?? { apartado: t.apartado, aportado: 0, retirado: 0, balance: 0 }
      if (t.direccion === 'Retiro') { entry.retirado += monto; entry.balance -= monto }
      else { entry.aportado += monto; entry.balance += monto }
      porApartadoMap.set(key, entry)
    }
    const porApartado = Array.from(porApartadoMap.values())

    return NextResponse.json({ total, porQuincena, porApartado, transacciones: [...conBalance].reverse() })
  } catch (error) {
    console.error('Error fetching ahorro:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
