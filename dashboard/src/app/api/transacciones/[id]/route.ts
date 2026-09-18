import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolverTipoYDireccion } from '@/lib/transaccion-ahorro'
import { validarEnlacePresupuesto } from '@/lib/validar-enlace-presupuesto'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const transaccion = await prisma.transaccion.findUnique({
      where: { id },
      include: { categoria: true, user: true, quincena: true, metodoPago: true, presupuesto: true },
    })

    if (!transaccion) {
      return NextResponse.json({ error: 'Transacción not found' }, { status: 404 })
    }

    return NextResponse.json(transaccion)
  } catch (error) {
    console.error('Error fetching transaccion:', error)
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
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const body = await request.json()
    const { fecha, quincenaId, userId, descripcion, categoriaId, tipo, direccion, apartadoId, monto, metodoPagoId, estatus, notas, presupuestoId } = body

    // Si cambia la categoria, el tipo, o la direccion, hay que re-resolver
    // contra la categoria efectiva para que una transaccion de "Ahorro"
    // nunca pueda terminar con otro tipo (ver @/lib/transaccion-ahorro).
    let tipoResuelto: string | undefined
    let direccionResuelta: string | null | undefined
    if (categoriaId !== undefined || tipo !== undefined || direccion !== undefined) {
      const current = await prisma.transaccion.findUnique({ where: { id }, select: { categoriaId: true } })
      if (!current) {
        return NextResponse.json({ error: 'Transacción not found' }, { status: 404 })
      }
      const effectiveCategoriaId = categoriaId ? parseInt(categoriaId) : current.categoriaId
      const categoria = await prisma.categoria.findUnique({ where: { id: effectiveCategoriaId } })
      if (!categoria) {
        return NextResponse.json({ error: 'Categoria not found' }, { status: 400 })
      }
      const resuelto = resolverTipoYDireccion(categoria.tipo, tipo, direccion)
      tipoResuelto = resuelto.tipo
      direccionResuelta = resuelto.direccion
    }

    // La linea de presupuesto tiene que ser de la misma quincena que la
    // transaccion. Hay que mirar las dos juntas porque cualquiera de las dos
    // puede venir en el body: asignar una linea de otra quincena se rechaza, y
    // mover la transaccion a otra quincena suelta el enlace que acaba de dejar
    // de tener sentido (en vez de dejarlo sumando en la quincena equivocada).
    // La categoria se trata aparte, mas abajo: ahi no hay rechazo, solo se
    // suelta un enlace heredado que el cambio de categoria dejo descolocado.
    let presupuestoIdFinal: number | null | undefined =
      presupuestoId !== undefined ? (presupuestoId ? parseInt(presupuestoId) : null) : undefined

    if (quincenaId || categoriaId || presupuestoIdFinal !== undefined) {
      const actual = await prisma.transaccion.findUnique({
        where: { id },
        select: { quincenaId: true, categoriaId: true, presupuestoId: true },
      })
      if (!actual) {
        return NextResponse.json({ error: 'Transacción not found' }, { status: 404 })
      }
      const quincenaFinal = quincenaId ? parseInt(quincenaId) : actual.quincenaId
      const enlaceAValidar = presupuestoIdFinal !== undefined ? presupuestoIdFinal : actual.presupuestoId
      const enlaceInvalido = await validarEnlacePresupuesto(enlaceAValidar, quincenaFinal)

      if (enlaceInvalido) {
        // Enlace explicito en el body: es un error del que llama.
        if (presupuestoIdFinal !== undefined) {
          return NextResponse.json({ error: enlaceInvalido.error }, { status: 400 })
        }
        // Enlace heredado que dejo de cuadrar al mover de quincena: se suelta.
        presupuestoIdFinal = null
      }

      // Cambiar de categoria puede dejar el enlace cruzado: la linea sigue
      // siendo de la quincena correcta, pero ya no es de la categoria de la
      // transaccion.
      //
      // ANTES esto soltaba el enlace en silencio cuando cuadraba con la
      // categoria anterior. Eso tenia sentido cuando cruzar era una rareza; ya
      // no lo es: la clasificacion se entra por la linea, y un cruce es un
      // estado normal, visible en la tabla y medido por el check 21 de
      // scripts/audit-datos.sql. Borrar la asignacion de alguien sin avisar es
      // justo la sobrescritura silenciosa que este cambio existe para evitar.
      //
      // Lo que SI se suelta es el cruce de TIPO, y esa es otra cosa: los
      // agregados filtran por `categoria.tipo` (ver calcularFaltaPorPagar en
      // @/lib/presupuesto-totales y @/lib/cierre-quincena), asi que un Gasto
      // colgado de una linea de Ingreso no lo cuenta nadie -- el monto no
      // cambia de columna, desaparece. Ahi soltar el enlace es lo correcto.
      if (categoriaId && presupuestoIdFinal === undefined && actual.presupuestoId != null) {
        const categoriaFinal = parseInt(categoriaId)
        if (categoriaFinal !== actual.categoriaId) {
          const [linea, categoriaNueva] = await Promise.all([
            prisma.presupuesto.findUnique({
              where: { id: actual.presupuestoId },
              select: { categoria: { select: { tipo: true } } },
            }),
            prisma.categoria.findUnique({
              where: { id: categoriaFinal },
              select: { tipo: true },
            }),
          ])
          if (linea && categoriaNueva && linea.categoria?.tipo !== categoriaNueva.tipo) {
            presupuestoIdFinal = null
          }
        }
      }
    }

    const transaccion = await prisma.transaccion.update({
      where: { id },
      data: {
        ...(fecha && { fecha: new Date(fecha) }),
        ...(quincenaId && { quincenaId: parseInt(quincenaId) }),
        ...(userId !== undefined && { userId: userId ? parseInt(userId) : null }),
        ...(descripcion && { descripcion }),
        ...(categoriaId && { categoriaId: parseInt(categoriaId) }),
        ...(tipoResuelto !== undefined && { tipo: tipoResuelto, direccion: direccionResuelta }),
        ...(apartadoId !== undefined && { apartadoId: apartadoId ? parseInt(apartadoId) : null }),
        ...(monto !== undefined && { monto: parseFloat(monto) }),
        ...(metodoPagoId !== undefined && { metodoPagoId: metodoPagoId ? parseInt(metodoPagoId) : null }),
        ...(estatus && { estatus }),
        ...(notas !== undefined && { notas }),
        ...(presupuestoIdFinal !== undefined && { presupuestoId: presupuestoIdFinal }),
      },
      // metodoPago va incluido igual que en el GET de la lista: quien parchea
      // su copia local con esta respuesta (la edicion inline de la tabla)
      // necesita el nombre, no solo el metodoPagoId.
      include: { categoria: true, user: true, quincena: true, metodoPago: true, presupuesto: true },
    })

    return NextResponse.json(transaccion)
  } catch (error) {
    console.error('Error updating transaccion:', error)
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
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    await prisma.transaccion.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Transacción deleted' })
  } catch (error) {
    console.error('Error deleting transaccion:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
