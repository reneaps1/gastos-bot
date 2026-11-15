import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { CAMPOS_TRANSACCION, origenDeLaPeticion, registrarAuditoria } from '@/lib/audit-log'
import { prisma } from '@/lib/prisma'
import { shiftMonth } from '@/lib/periodo'
import { resolverTipoYDireccion } from '@/lib/transaccion-ahorro'
import { validarEnlacePresupuesto } from '@/lib/validar-enlace-presupuesto'

function addMonths(dateString: string, months: number) {
  return new Date(`${shiftMonth(dateString, months)}T00:00:00.000Z`)
}

async function findQuincenaIdForDate(date: Date): Promise<number | null> {
  const quincenas = await prisma.quincena.findMany({ orderBy: { fechaInicio: 'asc' } })
  const found = quincenas.find(q => q.fechaInicio <= date && date <= q.fechaFin)
  // Return null for dates in gaps — callers must handle this explicitly
  return found?.id ?? null
}

// Valor especial para filtrar "sin usuario" / "sin metodo de pago" (columna NULL).
const SIN_VALOR = 'none'

function idOSinValor(v: string): number | null {
  return v === SIN_VALOR ? null : parseInt(v)
}

// Condicion de un campo para 1..n valores. Un valor -> igualdad (lo que
// siempre hizo este endpoint); varios -> IN. Si entre los valores viene
// SIN_VALOR se agrega `OR campo IS NULL`, porque el IN de SQL nunca empata
// con NULL. Devuelve un fragmento para el AND del where, o null si no filtra.
function condicionCampo<T>(campo: string, valores: string[], parse: (v: string) => T | null): object | null {
  if (valores.length === 0) return null
  const parsed = valores.map(parse)
  if (parsed.length === 1) return { [campo]: parsed[0] }
  const noNulos = parsed.filter((v): v is T => v !== null)
  if (noNulos.length === parsed.length) return { [campo]: { in: noNulos } }
  return { OR: [{ [campo]: { in: noNulos } }, { [campo]: null }] }
}

// Orden de la lista. Lista blanca: cualquier `sort` desconocido cae al orden
// de siempre (fecha desc). El `id` de desempate mantiene estable la
// paginacion cuando muchas filas comparten valor (misma fecha, mismo monto).
type Dir = 'asc' | 'desc'
type Orden = Prisma.TransaccionOrderByWithRelationInput
const ORDENES: Record<string, (dir: Dir) => Orden> = {
  descripcion: dir => ({ descripcion: dir }),
  fecha: dir => ({ fecha: dir }),
  monto: dir => ({ monto: dir }),
  tipo: dir => ({ tipo: dir }),
  estatus: dir => ({ estatus: dir }),
  categoria: dir => ({ categoria: { nombre: dir } }),
  usuario: dir => ({ user: { nombre: dir } }),
  metodoPago: dir => ({ metodoPago: { nombre: dir } }),
  quincena: dir => ({ quincena: { fechaInicio: dir } }),
  presupuesto: dir => ({ presupuestoId: { sort: dir, nulls: 'last' } }),
}

function ordenDeLaLista(sort: string | null, dirParam: string | null): Orden[] {
  const dir: Dir = dirParam === 'asc' ? 'asc' : 'desc'
  const orden = sort ? ORDENES[sort] : undefined
  if (!orden) return [{ fecha: 'desc' }, { id: 'desc' }]
  return [orden(dir), { id: dir }]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    // Uno o varios ?quincenaId= (para combinar quincenas en Presupuesto/
    // Transacciones con Ctrl/Cmd+clic) -- un solo valor sigue siendo
    // where.quincenaId = N como antes, no cambia nada para el resto de callers.
    const quincenaIds = searchParams.getAll('quincenaId')
    // tipo, categoriaId, userId, estatus y metodoPagoId aceptan varios valores
    // (?tipo=Gasto&tipo=Ingreso) para el autofiltro por columna de la tabla de
    // Transacciones. Un solo valor sigue siendo igualdad, como antes.
    const tipos = searchParams.getAll('tipo').filter(Boolean)
    const categoriaIds = searchParams.getAll('categoriaId').filter(Boolean)
    const userIds = searchParams.getAll('userId').filter(Boolean)
    const estatuses = searchParams.getAll('estatus').filter(Boolean)
    const metodoPagoIds = searchParams.getAll('metodoPagoId').filter(Boolean)
    const montoMin = searchParams.get('montoMin')
    const montoMax = searchParams.get('montoMax')
    const page = parseInt(searchParams.get('page') ?? '1')
    const limit = parseInt(searchParams.get('limit') ?? '50')
    const skip = (page - 1) * limit

    const busqueda = searchParams.get('busqueda')
    const asignado = searchParams.get('asignado')
    const presupuestoId = searchParams.get('presupuestoId')
    const fechaDesde = searchParams.get('fechaDesde')
    const fechaHasta = searchParams.get('fechaHasta')

    const where: any = {}
    if (quincenaIds.length === 1) where.quincenaId = parseInt(quincenaIds[0])
    else if (quincenaIds.length > 1) where.quincenaId = { in: quincenaIds.map(id => parseInt(id)) }
    if (fechaDesde || fechaHasta) {
      where.fecha = {}
      if (fechaDesde) where.fecha.gte = new Date(`${fechaDesde}T00:00:00.000Z`)
      if (fechaHasta) where.fecha.lte = new Date(`${fechaHasta}T23:59:59.999Z`)
    }
    // `tipo` va directo en where (no en el AND): el agregado de
    // GastoParaLimite de abajo lo sobreescribe con tipo:'Gasto' a proposito.
    if (tipos.length === 1) where.tipo = tipos[0]
    else if (tipos.length > 1) where.tipo = { in: tipos }
    const condiciones = [
      condicionCampo('categoriaId', categoriaIds, v => parseInt(v)),
      condicionCampo('userId', userIds, idOSinValor),
      condicionCampo('estatus', estatuses, v => v),
      condicionCampo('metodoPagoId', metodoPagoIds, idOSinValor),
    ].filter((c): c is object => c !== null)
    if (condiciones.length > 0) where.AND = condiciones
    const min = montoMin !== null && montoMin !== '' ? Number(montoMin) : NaN
    const max = montoMax !== null && montoMax !== '' ? Number(montoMax) : NaN
    if (Number.isFinite(min) || Number.isFinite(max)) {
      where.monto = {}
      if (Number.isFinite(min)) where.monto.gte = min
      if (Number.isFinite(max)) where.monto.lte = max
    }
    if (busqueda) where.descripcion = { contains: busqueda, mode: 'insensitive' }
    // presupuestoId gana sobre `asignado`: filtra a una linea concreta, que es
    // lo que consume el detalle de gasto en la pagina de Presupuesto. Con
    // tipo=Gasto reproduce exactamente el `real` que calcula /api/presupuestos.
    if (presupuestoId) where.presupuestoId = parseInt(presupuestoId)
    else if (asignado === 'si') where.presupuestoId = { not: null }
    else if (asignado === 'no') where.presupuestoId = null

    const [transacciones, total, totalesPorTipo, gastoParaLimiteAgg] = await Promise.all([
      prisma.transaccion.findMany({
        where,
        orderBy: ordenDeLaLista(searchParams.get('sort'), searchParams.get('dir')),
        skip,
        take: limit,
        include: { categoria: true, user: true, quincena: true, metodoPago: true, presupuesto: true },
      }),
      prisma.transaccion.count({ where }),
      prisma.transaccion.groupBy({
        by: ['tipo', 'estatus', 'direccion'],
        where,
        _sum: { monto: true },
      }),
      // Agregado aparte (no paginado) del gasto que cuenta para el limite de
      // referencia (Categoria.cuentaParaLimite) — respeta los mismos filtros
      // que la lista, pero siempre fuerza tipo=Gasto sin importar el filtro
      // `tipo` que haya llegado en la query.
      prisma.transaccion.aggregate({
        where: { ...where, tipo: 'Gasto', categoria: { cuentaParaLimite: true } },
        _sum: { monto: true },
      }),
    ])

    // Suma real (no paginada) por tipo, respetando los mismos filtros que la
    // lista — evita que las tarjetas de totales se calculen sobre solo la
    // página de resultados devuelta.
    //
    // Ahorro se "netea" por direccion (Aporte suma, Retiro resta) en vez de
    // sumarse bruto: desde que toda transaccion de categoria Ahorro guarda
    // tipo:'Ahorro' (ver @/lib/transaccion-ahorro), tanto aportaciones como
    // retiros comparten ese tipo y solo se distinguen por `direccion`.
    const totales = { Gasto: 0, Ingreso: 0, Ahorro: 0, GastoPagado: 0, IngresoPagado: 0, GastoParaLimite: Number(gastoParaLimiteAgg._sum.monto ?? 0) }
    for (const row of totalesPorTipo) {
      const monto = Number(row._sum.monto ?? 0)
      if (row.tipo === 'Ahorro') totales.Ahorro += row.direccion === 'Retiro' ? -monto : monto
      else if (row.tipo === 'Gasto') totales.Gasto += monto
      else if (row.tipo === 'Ingreso') totales.Ingreso += monto
      if (row.tipo === 'Gasto' && row.estatus === 'Pagado') totales.GastoPagado += monto
      if (row.tipo === 'Ingreso' && row.estatus === 'Pagado') totales.IngresoPagado += monto
    }

    return NextResponse.json({
      data: transacciones,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      totales,
    })
  } catch (error) {
    console.error('Error fetching transacciones:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { fecha, quincenaId, quincenaConsumoId, userId, descripcion, categoriaId, tipo, direccion, apartadoId, monto, metodoPagoId, creditoId, fechaPagoProgramada, totalPagos, estatus, notas, source, presupuestoId } = body

    if (!fecha || !quincenaId || !descripcion || !categoriaId || !tipo || monto === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const categoria = await prisma.categoria.findUnique({ where: { id: parseInt(categoriaId) } })
    if (!categoria) {
      return NextResponse.json({ error: 'Categoria not found' }, { status: 400 })
    }
    // Toda transaccion de categoria "Ahorro" siempre queda tipo:'Ahorro' sin
    // importar lo que haya elegido el cliente — ver @/lib/transaccion-ahorro.
    const { tipo: tipoResuelto, direccion: direccionResuelta } = resolverTipoYDireccion(categoria.tipo, tipo, direccion)

    const enlaceInvalido = await validarEnlacePresupuesto(
      presupuestoId ? parseInt(presupuestoId) : null,
      parseInt(quincenaId),
    )
    if (enlaceInvalido) {
      return NextResponse.json({ error: enlaceInvalido.error }, { status: 400 })
    }

    const parsedMonto = parseFloat(monto)
    const parsedCreditoId = creditoId ? parseInt(creditoId) : null
    const parsedTotalPagos = totalPagos ? parseInt(totalPagos) : (parsedCreditoId && fechaPagoProgramada ? 1 : null)

    if (parsedCreditoId && parsedTotalPagos && parsedTotalPagos > 0 && !fechaPagoProgramada) {
      return NextResponse.json({ error: 'fechaPagoProgramada required for credit payments' }, { status: 400 })
    }

    const pagosData: Array<{
      creditoId: number
      quincenaId: number
      categoriaId: number
      numeroPago: number
      totalPagos: number
      fechaPagoProgramada: Date
      montoCapital: number
      montoInteres: number
      montoTotal: number
      estatus: 'Pendiente'
      notas: string
    }> = []
    if (parsedCreditoId && parsedTotalPagos && parsedTotalPagos > 0) {
      const base = Math.floor((parsedMonto / parsedTotalPagos) * 100) / 100
      let accumulated = 0
      for (let i = 0; i < parsedTotalPagos; i++) {
        const paymentDate = addMonths(fechaPagoProgramada, i)
        const paymentQuincenaId = await findQuincenaIdForDate(paymentDate)
        if (!paymentQuincenaId) {
          return NextResponse.json({ error: `No quincena for payment ${i + 1}` }, { status: 400 })
        }

        const montoTotal = i === parsedTotalPagos - 1
          ? Number((parsedMonto - accumulated).toFixed(2))
          : base
        accumulated = Number((accumulated + montoTotal).toFixed(2))

        pagosData.push({
          creditoId: parsedCreditoId,
          quincenaId: paymentQuincenaId,
          categoriaId: parseInt(categoriaId),
          numeroPago: i + 1,
          totalPagos: parsedTotalPagos,
          fechaPagoProgramada: paymentDate,
          montoCapital: montoTotal,
          montoInteres: 0,
          montoTotal,
          estatus: 'Pendiente' as const,
          notas: `${descripcion} ${i + 1}/${parsedTotalPagos}`,
        })
      }
    }

    const origen = await origenDeLaPeticion()
    const transaccion = await prisma.$transaction(async (tx) => {
      const created = await tx.transaccion.create({
        data: {
          fecha: new Date(fecha),
          quincenaId: parseInt(quincenaId),
          quincenaConsumoId: quincenaConsumoId ? parseInt(quincenaConsumoId) : parseInt(quincenaId),
          userId: userId ? parseInt(userId) : null,
          descripcion,
          categoriaId: parseInt(categoriaId),
          tipo: tipoResuelto,
          direccion: direccionResuelta,
          apartadoId: apartadoId ? parseInt(apartadoId) : null,
          monto: parsedMonto,
          metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null,
          creditoId: parsedCreditoId,
          presupuestoId: presupuestoId ? parseInt(presupuestoId) : null,
          fechaPagoProgramada: fechaPagoProgramada ? new Date(fechaPagoProgramada) : null,
          estatus: parsedCreditoId ? 'Pendiente' : (estatus ?? 'Pendiente'),
          notas,
          source: source ?? 'api',
        },
        include: { categoria: true, user: true, quincena: true, presupuesto: true },
      })

      await registrarAuditoria(tx, {
        tabla: 'transacciones', registroId: created.id, operacion: 'INSERT',
        antes: null, despues: created, campos: CAMPOS_TRANSACCION, origen,
      })

      if (pagosData.length > 0) {
        await tx.creditoPago.createMany({
          data: pagosData.map(p => ({ ...p, transaccionId: created.id })),
        })
      }

      return created
    })

    return NextResponse.json(transaccion, { status: 201 })
  } catch (error) {
    console.error('Error creating transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
