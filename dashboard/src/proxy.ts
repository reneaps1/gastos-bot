import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, decryptSession, reissueSessionToken, sessionCookieOptions } from '@/lib/auth'

// Rutas alcanzables sin sesion. /privacy es exigida por Apple para el listado en
// App Store y /api/health es lo que usa Render para el healthcheck del servicio.
const PUBLIC_PATHS = new Set(['/login', '/privacy', '/api/health', '/api/auth/login'])

const PUBLIC_ASSET_RE = /^\/(manifest\.json|icon(-\d+)?\.png|apple-touch-icon.*\.png|splash.*\.png|robots\.txt|favicon\.ico)$/

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_ASSET_RE.test(pathname)
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await decryptSession(token)

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Sesion deslizante: cada visita autenticada renueva la expiracion, para que
  // la sesion se mantenga abierta mientras el dispositivo se siga usando.
  const response = NextResponse.next()
  const refreshed = await reissueSessionToken(session.username)
  response.cookies.set(SESSION_COOKIE_NAME, refreshed, sessionCookieOptions())
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
