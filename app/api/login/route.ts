import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const password = process.env.PANEL_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: 'PANEL_PASSWORD no está configurado en el servidor.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const submitted: string | undefined = body?.password;

  if (submitted !== password) {
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('panel_auth', password, {
    httpOnly: true,
    // 'Secure' solo debe ir en producción (HTTPS) — en localhost (http) el
    // navegador puede rechazar guardar la cookie si va marcada Secure, lo
    // que hace que el login "funcione" pero nunca te deje pasar.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return res;
}