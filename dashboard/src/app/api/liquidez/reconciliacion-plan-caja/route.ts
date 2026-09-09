import { NextResponse } from 'next/server'
import { calcularReconciliacionPlanCaja } from '@/lib/reconciliacion-plan-caja-server'

export async function GET(request: Request) {
  try {
    const quincenaIdParam = new URL(request.url).searchParams.get('quincenaId')
    const quincenaId = quincenaIdParam ? Number(quincenaIdParam) : NaN

    if (!Number.isInteger(quincenaId) || quincenaId <= 0) {
      return NextResponse.json({ error: 'quincenaId invalido' }, { status: 400 })
    }

    const resultado = await calcularReconciliacionPlanCaja(quincenaId)
    if (!resultado) {
      return NextResponse.json({ error: 'Quincena no encontrada' }, { status: 404 })
    }

    return NextResponse.json(resultado)
  } catch (error) {
    console.error('Error reconciliando plan vs caja:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
