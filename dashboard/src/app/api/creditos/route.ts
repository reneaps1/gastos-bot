import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET() {
  try {
    const creditos = await prisma.credito.findMany({
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      include: {
        user: true,
        cuentaPago: true,
        pagos: {
          include: { quincena: true, categoria: true },
          orderBy: { fechaPagoProgramada: 'asc' },
        },
      },
    })

    const data = creditos.map((credito) => {
      const pendiente = credito.pagos
        .filter((p) => p.estatus === 'Pendiente' || p.estatus === 'Vencido')
        .reduce((sum, p) => sum + Number(p.montoTotal), 0)
      const pagado = credito.pagos
        .filter((p) => p.estatus === 'Pagado')
        .reduce((sum, p) => sum + Number(p.montoTotal), 0)
      const base = Number(credito.montoOriginal ?? credito.saldoInicial ?? 0)
      const saldo = pendiente > 0 ? pendiente : Math.max(base - pagado, 0)

      return { ...credito, pendiente, pagado, saldo }
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching creditos:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      nombre,
      tipoCredito,
      acreedor,
      userId,
      montoOriginal,
      saldoInicial,
      limiteCredito,
      diaCorte,
      diaPago,
      frecuenciaPago,
      montoPagoFijo,
      plazoMeses,
      tasaInteres,
      cuentaPagoId,
      notas,
      fechaInicio,
    } = body

    if (!nombre || !acreedor) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const credito = await prisma.credito.create({
      data: {
        nombre: nombre.trim(),
        tipoCredito: tipoCredito || 'Otro',
        acreedor: acreedor.trim(),
        userId: userId ? parseInt(userId) : null,
        montoOriginal: toNumber(montoOriginal),
        saldoInicial: toNumber(saldoInicial),
        limiteCredito: toNumber(limiteCredito),
        diaCorte: diaCorte ? parseInt(diaCorte) : null,
        diaPago: diaPago ? parseInt(diaPago) : null,
        frecuenciaPago: frecuenciaPago || null,
        montoPagoFijo: toNumber(montoPagoFijo),
        plazoMeses: plazoMeses ? parseInt(plazoMeses) : null,
        tasaInteres: toNumber(tasaInteres),
        cuentaPagoId: cuentaPagoId ? parseInt(cuentaPagoId) : null,
        notas: notas || null,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : null,
      },
      include: { user: true, cuentaPago: true, pagos: true },
    })

    return NextResponse.json(credito, { status: 201 })
  } catch (error) {
    console.error('Error creating credito:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
