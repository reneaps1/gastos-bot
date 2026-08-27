import { NextResponse } from 'next/server'
import { calcularPagosQuincena } from '@/lib/pagos-quincena'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const quincenaIdParam = searchParams.get('quincenaId')
    const quincenaId = quincenaIdParam ? parseInt(quincenaIdParam) : NaN
    if (!quincenaIdParam || isNaN(quincenaId)) {
      return NextResponse.json({ error: 'Missing or invalid quincenaId' }, { status: 400 })
    }

    const resultado = await calcularPagosQuincena(quincenaId)

    return NextResponse.json(resultado)
  } catch (error) {
    console.error('Error calculando pagos de quincena:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
