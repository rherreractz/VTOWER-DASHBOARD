import { NextRequest, NextResponse } from 'next/server';

/**
 * Protección simple de contraseña compartida para todo el panel — pensada
 * para Vercel Hobby, donde el Password Protection nativo no está disponible
 * (requiere Pro + add-on de $150/mes). No es autenticación de nivel
 * empresarial (no hay usuarios individuales, todos comparten la misma
 * contraseña), pero es suficiente para que solo tu equipo/cliente con la
 * contraseña puedan entrar, en vez de cualquiera con la URL.
 *
 * Variable de entorno requerida (.env.local y en Vercel):
 * PANEL_PASSWORD="lo-que-quieras"
 *
 * Cómo funciona:
 * 1. Si no existe la cookie panel_auth (o no coincide con PANEL_PASSWORD),
 *    redirige a /login.
 * 2. /login y /api/login quedan siempre accesibles (si no, nadie podría
 *    ni llegar al formulario de login).
 */

export function middleware(request: NextRequest) {
  const password = process.env.PANEL_PASSWORD;

  // Si no configuraste PANEL_PASSWORD, no bloqueamos nada (evita que te
  // quedes fuera de tu propio panel por olvidar la variable). Bórralo una
  // vez que ya la tengas puesta si quieres forzar siempre la protección.
  if (!password) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get('panel_auth')?.value;
  if (cookie === password) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!login|api/login|privacidad|_next/static|_next/image|favicon.ico).*)'],
};