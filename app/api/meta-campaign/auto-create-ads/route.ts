import { NextRequest, NextResponse } from 'next/server';
import { getFolderIdsForAccount, listMediaInFolders, downloadDriveFile } from '@/lib/driveImages';
import { pickImagesForVariants } from '@/lib/metaImagePicker';
import { createPausedAdWithImage, createPausedAdWithVideo } from '@/lib/metaCreative';
import { findLeadFormByName } from '@/lib/metaLeadForms';
import type { AdCopyVariant } from '@/lib/metaCampaignGenerator';

export const maxDuration = 60;

interface AutoCreateAdsBody {
  accountId: string;
  adSetId: string;
  pageId: string;
  destinationLink: string;
  campaignName: string;
  adCopyVariants: AdCopyVariant[];
  leadFormId?: string;
  leadFormName?: string;
  campaignContext?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AutoCreateAdsBody;
    const { accountId, adSetId, pageId, destinationLink, campaignName, adCopyVariants, leadFormId: leadFormIdDirect, leadFormName, campaignContext } = body;

    if (!accountId?.startsWith('act_')) {
      return NextResponse.json({ error: 'accountId inválido.' }, { status: 400 });
    }
    if (!adSetId || !pageId || !destinationLink || !adCopyVariants?.length) {
      return NextResponse.json({ error: 'Faltan campos requeridos (adSetId, pageId, destinationLink, adCopyVariants).' }, { status: 400 });
    }

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Falta META_ACCESS_TOKEN.' }, { status: 500 });
    }

    // Si viene el Form ID directo (elegido del desplegable), lo usamos tal
    // cual. leadFormName queda como respaldo (ej. para el cron semanal).
    let leadFormId: string | undefined = leadFormIdDirect;
    if (!leadFormId && leadFormName) {
      const found = await findLeadFormByName(pageId, token, leadFormName);
      if (!found) {
        return NextResponse.json({ error: `No se encontró un formulario llamado "${leadFormName}" en la página ${pageId}.` }, { status: 400 });
      }
      leadFormId = found.id;
    }

    const folderIds = getFolderIdsForAccount(accountId);
    if (folderIds.length === 0) {
      return NextResponse.json(
        { error: 'No hay carpetas de Drive configuradas para esta cuenta en GOOGLE_DRIVE_ACCOUNT_FOLDERS.' },
        { status: 400 },
      );
    }

    const images = await listMediaInFolders(folderIds);
    if (images.length === 0) {
      return NextResponse.json({ error: 'Las carpetas de Drive configuradas no tienen imágenes ni videos (o no se pudieron leer — revisa permisos).' }, { status: 400 });
    }

    const chosenImageIds = await pickImagesForVariants(adCopyVariants, images, campaignContext || campaignName);

    const results = await Promise.allSettled(
      adCopyVariants.map(async (variant, index) => {
        const imageId = chosenImageIds[index];
        if (!imageId) throw new Error('No se eligió ninguna imagen para esta variante.');

        const image = images.find((img) => img.id === imageId);
        const downloaded = await downloadDriveFile(imageId);
        if (!downloaded) throw new Error(`No se pudo descargar "${image?.name ?? imageId}" de Drive.`);

        const result =
          image?.mediaType === 'video'
            ? await createPausedAdWithVideo({
                accountId,
                token,
                adSetId,
                pageId,
                video: { kind: 'buffer', buffer: downloaded.buffer, filename: image?.name ?? `${imageId}.mp4`, mimeType: downloaded.mimeType },
                headline: variant.headline,
                primaryText: variant.primaryText,
                destinationLink,
                ctaText: variant.cta,
                adName: `${campaignName} — Variante ${index + 1}`,
                leadFormId,
                maxWaitMs: 30000,
              })
            : await createPausedAdWithImage({
                accountId,
                token,
                adSetId,
                pageId,
                image: { kind: 'buffer', buffer: downloaded.buffer, filename: image?.name ?? `${imageId}.jpg`, mimeType: downloaded.mimeType },
                headline: variant.headline,
                primaryText: variant.primaryText,
                destinationLink,
                ctaText: variant.cta,
                adName: `${campaignName} — Variante ${index + 1}`,
                leadFormId,
              });

        return { variantIndex: index, imageName: image?.name ?? imageId, mediaType: image?.mediaType ?? 'image', ...result };
      }),
    );

    const summary = results.map((r, i) =>
      r.status === 'fulfilled' ? { ok: true, ...r.value } : { ok: false, variantIndex: i, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
    );

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[meta-campaign/auto-create-ads] Error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}