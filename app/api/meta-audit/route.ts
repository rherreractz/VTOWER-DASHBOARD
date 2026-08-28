import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaAdsData } from '@/lib/metaAds';
import { runMetaAudit } from '@/lib/metaAudit';
import { getLastMetaAudit, saveMetaAudit } from '@/lib/metaAuditStorage';

// Una auditoría completa (fetch de Meta + análisis con Claude sobre 50
// checks, ahora con max_tokens más alto para evitar respuestas cortadas)
// puede tardar bastante en generarse. En el plan Hobby de Vercel el máximo
// permitido es 60s — si sigue tardando más que eso, necesitas el plan Pro
// (hasta 300s) o mover esta ruta a tu VPS.
export const maxDuration = 60;

/**
 * Devuelve la última auditoría guardada para una cuenta (?accountId=act_...),
 * sin volver a llamar a Meta ni a Claude. El panel la usa para mostrar algo
 * de inmediato al entrar, en vez de correr una auditoría nueva cada vez
 * (eso solo pasa cuando el usuario le da clic a "Correr auditoría").
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId es requerido.' }, { status: 400 });
  }

  const stored = await getLastMetaAudit(accountId);
  return NextResponse.json({ stored });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId: string | undefined = body?.accountId;
    const since: string | undefined = body?.since;
    const until: string | undefined = body?.until;

    if (!accountId || !accountId.startsWith('act_')) {
      return NextResponse.json(
        { error: 'accountId es requerido y debe tener el formato "act_1234567890".' },
        { status: 400 },
      );
    }

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: 'Falta la variable de entorno META_ACCESS_TOKEN en el servidor.' },
        { status: 500 },
      );
    }

    const data = await fetchMetaAdsData({ accountId, token, since, until });
    const audit = await runMetaAudit(data);

    // Guardamos el resultado para la próxima vez que alguien entre al panel
    // (no bloqueamos la respuesta al usuario si esto falla).
    saveMetaAudit(accountId, audit).catch((err) => console.error('[meta-audit] Error al guardar el cache:', err));

    return NextResponse.json({ data, audit });
  } catch (error) {
    console.error('[meta-audit] Error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido al correr la auditoría.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}