import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseMontoReferencia } from '@/lib/referencia'

const TIPOS_VALIDOS = ['QUINCENAL', 'SEMANAL', 'MENSUAL']

// La fila de Configuracion tambien guarda el usuario y el HASH de la
// contraseña del login (authUsername, authPasswordHash). Antes el GET devolvia
// la fila completa a cualquier sesion, incluido el token del bot. Solo salen
// los campos que la app usa.
const CAMPOS_PUBLICOS = {
  id: true,
  frecuenciaPagoDefault: true,
  ingresoReferencia: true,
  limiteGastoReferencia: true,
} as const

export async function GET() {
  try {
    const config = await prisma.configuracion.findFirst({ select: CAMPOS_PUBLICOS })
    return NextResponse.json(config ?? { id: 1, frecuenciaPagoDefault: 'QUINCENAL', ingresoReferencia: null, limiteGastoReferencia: null })
  } catch (error) {
    console.error('Error fetching configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
      select: CAMPOS_PUBLICOS,
    })

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error updating configuracion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
