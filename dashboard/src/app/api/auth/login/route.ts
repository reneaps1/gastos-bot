import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession, verifyPassword } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña son requeridos' }, { status: 400 })
    }

    const config = await prisma.configuracion.findUnique({ where: { id: 1 } })

    if (!config?.authUsername || !config.authPasswordHash || config.authUsername !== username) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 })
    }

    const valid = await verifyPassword(password, config.authPasswordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 })
    }

    await createSession(config.authUsername)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
