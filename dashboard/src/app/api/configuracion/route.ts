import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TIPOS_VALIDOS = ['QUINCENAL', 'SEMANAL', 'MENSUAL']

export async function GET() {
  try {
    const config = await prisma.configuracion.findFirst()
    return NextResponse.json(config ?? { id: 1, frecuenciaPagoDefault: 'QUINCENAL', ingresoReferencia: null, limiteGastoReferencia: null })
  } catch (error) {
    console.error('Error fetching configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Valida un monto de referencia opcional: null limpia el valor, un numero >= 0
// lo fija, cualquier otra cosa es invalido. undefined significa "no tocar".
function parseMontoReferencia(value: unknown, campo: string) {
  if (value === undefined) return { ok: true as const, value: undefined }
  if (value === null) return { ok: true as const, value: null }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false as const, error: `${campo} debe ser un numero mayor o igual a 0, o null` }
  }
  return { ok: true as const, value: n }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { frecuenciaPagoDefault, ingresoReferencia, limiteGastoReferencia } = body

    if (frecuenciaPagoDefault !== undefined && !TIPOS_VALIDOS.includes(frecuenciaPagoDefault)) {
      return NextResponse.json({ error: `frecuenciaPagoDefault debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` }, { status: 400 })
    }

    const ingreso = parseMontoReferencia(ingresoReferencia, 'ingresoReferencia')
    if (!ingreso.ok) return NextResponse.json({ error: ingreso.error }, { status: 400 })

    const limite = parseMontoReferencia(limiteGastoReferencia, 'limiteGastoReferencia')
    if (!limite.ok) return NextResponse.json({ error: limite.error }, { status: 400 })

    const config = await prisma.configuracion.upsert({
      where: { id: 1 },
      update: {
        ...(frecuenciaPagoDefault !== undefined && { frecuenciaPagoDefault }),
        ...(ingreso.value !== undefined && { ingresoReferencia: ingreso.value }),
        ...(limite.value !== undefined && { limiteGastoReferencia: limite.value }),
      },
      create: {
        id: 1,
        frecuenciaPagoDefault: frecuenciaPagoDefault ?? 'QUINCENAL',
        ingresoReferencia: ingreso.value ?? null,
        limiteGastoReferencia: limite.value ?? null,
      },
    })

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error updating configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
