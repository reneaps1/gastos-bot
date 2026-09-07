import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Datos auxiliares que Presupuesto -> Analisis necesita y que no existen
 * dentro de una linea de presupuesto.
 *
 * Por ahora expone gasto sin presupuesto agrupado por quincena + categoria.
 * Se agrega en servidor para no depender de listas paginadas de transacciones
 * y para que el historico siempre cuadre con el gasto real del sistema.
 */
export async function GET() {
  try {
    const rows = await prisma.transaccion.groupBy({
      by: ['quincenaId', 'categoriaId'],
      where: {
        tipo: 'Gasto',
        presupuestoId: null,
      },
      _sum: { monto: true },
    })

    return NextResponse.json({
      gastosSinPresupuesto: rows.map(row => ({
        quincenaId: row.quincenaId,
        categoriaId: row.categoriaId,
        monto: Number(row._sum.monto ?? 0),
      })),
    })
  } catch (error) {
    console.error('Error fetching presupuesto analysis data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
