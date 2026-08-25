import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

export const SESSION_COOKIE_NAME = 'milo_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 180 // 180 dias: sesion que se mantiene abierta entre dispositivos

function getSecretKey() {
  const secret = process.env.SESSION_SECRET
  if (secret) return new TextEncoder().encode(secret)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET no esta configurado. Definelo en las variables de entorno antes de arrancar en produccion.')
  }
  // Solo para desarrollo local sin .env configurado. Nunca usar en produccion.
  return new TextEncoder().encode('dev-only-insecure-secret-do-not-use-in-production')
}

interface SessionPayload {
  username: string
}

async function encryptSession(payload: SessionPayload) {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS)
    .sign(getSecretKey())
}

export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] })
    if (typeof payload.username !== 'string') return null
    return { username: payload.username }
  } catch {
    return null
  }
}

function cookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  }
}

export async function createSession(username: string) {
  const token = await encryptSession({ username })
  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, token, cookieOptions())
}

export async function destroySession() {
  const store = await cookies()
  store.delete(SESSION_COOKIE_NAME)
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return decryptSession(store.get(SESSION_COOKIE_NAME)?.value)
}

/** Emite un token nuevo con la expiracion renovada, para la sesion deslizante del proxy. */
export async function reissueSessionToken(username: string) {
  return encryptSession({ username })
}

export function sessionCookieOptions() {
  return cookieOptions()
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}
