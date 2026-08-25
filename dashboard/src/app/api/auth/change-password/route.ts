import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword, verifyPassword } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, { status: 400 })
    }

    const config = await prisma.configuracion.findUnique({ where: { id: 1 } })
    if (!config?.authPasswordHash || config.authUsername !== session.username) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const valid = await verifyPassword(currentPassword, config.authPasswordHash)
    if (!valid) {
      return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 400 })
    }

    const newHash = await hashPassword(newPassword)
    await prisma.configuracion.update({
      where: { id: 1 },
      data: { authPasswordHash: newHash },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error cambiando password:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
