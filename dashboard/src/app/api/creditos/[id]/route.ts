import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await request.json()
    const credito = await prisma.credito.update({
      where: { id },
      data: {
        ...(body.nombre !== undefined && { nombre: body.nombre.trim() }),
        ...(body.tipoCredito !== undefined && { tipoCredito: body.tipoCredito || 'Otro' }),
        ...(body.acreedor !== undefined && { acreedor: body.acreedor.trim() }),
        ...(body.userId !== undefined && { userId: body.userId ? parseInt(body.userId) : null }),
        ...(body.montoOriginal !== undefined && { montoOriginal: toNumber(body.montoOriginal) }),
        ...(body.saldoInicial !== undefined && { saldoInicial: toNumber(body.saldoInicial) }),
        ...(body.limiteCredito !== undefined && { limiteCredito: toNumber(body.limiteCredito) }),
        ...(body.diaCorte !== undefined && { diaCorte: body.diaCorte ? parseInt(body.diaCorte) : null }),
        ...(body.diaPago !== undefined && { diaPago: body.diaPago ? parseInt(body.diaPago) : null }),
        ...(body.frecuenciaPago !== undefined && { frecuenciaPago: body.frecuenciaPago || null }),
        ...(body.montoPagoFijo !== undefined && { montoPagoFijo: toNumber(body.montoPagoFijo) }),
        ...(body.plazoMeses !== undefined && { plazoMeses: body.plazoMeses ? parseInt(body.plazoMeses) : null }),
        ...(body.tasaInteres !== undefined && { tasaInteres: toNumber(body.tasaInteres) }),
        ...(body.cuentaPagoId !== undefined && { cuentaPagoId: body.cuentaPagoId ? parseInt(body.cuentaPagoId) : null }),
        ...(body.activo !== undefined && { activo: Boolean(body.activo) }),
        ...(body.notas !== undefined && { notas: body.notas || null }),
        ...(body.fechaInicio !== undefined && { fechaInicio: body.fechaInicio ? new Date(body.fechaInicio) : null }),
      },
      include: { user: true, cuentaPago: true, pagos: true },
    })

    return NextResponse.json(credito)
  } catch (error) {
    console.error('Error updating credito:', error)
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
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    await prisma.credito.update({ where: { id }, data: { activo: false } })
    return NextResponse.json({ message: 'Credito archived' })
  } catch (error) {
    console.error('Error archiving credito:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
