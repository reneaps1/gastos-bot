import { NextResponse } from 'next/server'

// Publica y sin autenticacion a proposito: es el endpoint que usa Render para
// el healthcheck del servicio (ver render.yaml). El proxy la deja pasar.
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
