import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const cuenta = await prisma.cuenta.findUnique({ where: { id } })
    if (!cuenta) return NextResponse.json({ error: 'Cuenta not found' }, { status: 404 })

    return NextResponse.json(cuenta)
  } catch (error) {
    console.error('Error fetching cuenta:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await request.json()
    const { nombre, tipo, icono, color, activo, orden } = body

    if (nombre !== undefined) {
      const existing = await prisma.cuenta.findFirst({ where: { nombre, NOT: { id } } })
      if (existing) {
        return NextResponse.json({ error: 'Cuenta already exists' }, { status: 409 })
      }
    }

    const cuenta = await prisma.cuenta.update({
      where: { id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(tipo !== undefined && { tipo: tipo || null }),
        ...(icono !== undefined && { icono: icono || null }),
        ...(color !== undefined && { color: color || null }),
        ...(activo !== undefined && { activo }),
        ...(orden !== undefined && { orden: orden === null || orden === '' ? 0 : parseInt(orden) }),
      },
    })

    return NextResponse.json(cuenta)
  } catch (error) {
    console.error('Error updating cuenta:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const [creditosCount, liquidezCount] = await Promise.all([
      prisma.credito.count({ where: { cuentaPagoId: id } }),
      prisma.liquidezSnapshotCuenta.count({ where: { cuentaId: id } }),
    ])
    if (creditosCount > 0 || liquidezCount > 0) {
      return NextResponse.json({
        error: `No se puede eliminar: tiene ${creditosCount} crédito(s) y ${liquidezCount} corte(s) de liquidez asociados. Desactívala en su lugar.`,
      }, { status: 409 })
    }

    await prisma.cuenta.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting cuenta:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
