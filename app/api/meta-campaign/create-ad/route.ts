import { NextRequest, NextResponse } from 'next/server';
import { createPausedAdWithImage, createPausedAdWithVideo } from '@/lib/metaCreative';
import { findLeadFormByName } from '@/lib/metaLeadForms';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const accountId = form.get('accountId') as string | null;
    const adSetId = form.get('adSetId') as string | null;
    const pageId = form.get('pageId') as string | null;
    const headline = form.get('headline') as string | null;
    const primaryText = form.get('primaryText') as string | null;
    const destinationLink = form.get('destinationLink') as string | null;
    const ctaText = form.get('ctaText') as string | null;
    const adName = form.get('adName') as string | null;
    const imageFile = form.get('image') as File | null;
    const videoFile = form.get('video') as File | null;
    const leadFormName = (form.get('leadFormName') as string | null) || undefined;
    const leadFormIdDirect = (form.get('leadFormId') as string | null) || undefined;

    if (!accountId || !accountId.startsWith('act_')) {
      return NextResponse.json({ error: 'accountId es requerido y debe tener el formato "act_1234567890".' }, { status: 400 });
    }
    if (!adSetId) return NextResponse.json({ error: 'adSetId es requerido.' }, { status: 400 });
    if (!pageId) return NextResponse.json({ error: 'pageId es requerido.' }, { status: 400 });
    if (!headline || !primaryText || !destinationLink || !ctaText || !adName) {
      return NextResponse.json({ error: 'Faltan campos de texto del anuncio.' }, { status: 400 });
    }
    const hasImage = imageFile && imageFile.size > 0;
    const hasVideo = videoFile && videoFile.size > 0;
    if (!hasImage && !hasVideo) {
      return NextResponse.json({ error: 'Falta la imagen o el video del anuncio.' }, { status: 400 });
    }

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Falta la variable de entorno META_ACCESS_TOKEN en el servidor.' }, { status: 500 });
    }

    // Si viene el Form ID directo (elegido del desplegable), lo usamos tal
    // cual — más confiable que buscar por nombre. leadFormName queda como
    // respaldo para llamadas que todavía no mandan el ID (ej. integraciones viejas).
    let leadFormId: string | undefined = leadFormIdDirect;
    if (!leadFormId && leadFormName) {
      const found = await findLeadFormByName(pageId, token, leadFormName);
      if (!found) {
        return NextResponse.json({ error: `No se encontró un formulario llamado "${leadFormName}" en la página ${pageId}.` }, { status: 400 });
      }
      leadFormId = found.id;
    }

    const result = hasVideo
      ? await createPausedAdWithVideo({
          accountId,
          token,
          adSetId,
          pageId,
          video: { kind: 'file', file: videoFile as File },
          headline,
          primaryText,
          destinationLink,
          ctaText,
          adName,
          leadFormId,
        })
      : await createPausedAdWithImage({
          accountId,
          token,
          adSetId,
          pageId,
          image: { kind: 'file', file: imageFile as File },
          headline,
          primaryText,
          destinationLink,
          ctaText,
          adName,
          leadFormId,
        });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[meta-campaign/create-ad] Error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido al crear el anuncio.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}