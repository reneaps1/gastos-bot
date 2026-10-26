import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Publica y sin autenticacion a proposito: es el endpoint que usa Render para
// el healthcheck del servicio (ver render.yaml). El proxy la deja pasar.
//
// SIEMPRE responde 200. Si devolviera 503 cuando la base no responde, Render
// reiniciaria el servicio en bucle sin arreglar nada: el problema no es del
// proceso sino de la base, y un reinicio no arregla una base caida. La verdad
// va en el cuerpo, para que se pueda leer sin depender de los logs.
//
// force-dynamic es obligatorio: sin esto, Next.js evalua la ruta en build time
// y guarda la respuesta como estatica. El estado de la base quedaria congelado
// en el momento del build, y el endpoint que existe justamente para ver si la
// base esta viva reportaria siempre lo mismo. Ademas, el build no debe
// depender de que la base este disponible.
export const dynamic = 'force-dynamic'

export async function GET() {
  let database = { ok: true, error: null as string | null }

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    database = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  return NextResponse.json({
    status: database.ok ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  })
}
