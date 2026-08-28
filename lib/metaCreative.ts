/**
 * Último paso para completar el anuncio: sube la imagen a la galería de
 * Meta, crea el "ad creative" (el diseño: imagen + copy + botón) y crea el
 * Ad final dentro del Ad Set que ya existe — SIEMPRE en PAUSED, igual que
 * el resto del flujo.
 *
 * No usamos ningún storage propio: la imagen se manda directo desde el
 * navegador a esta ruta, y de aquí se reenvía a Meta en el mismo request
 * (no se guarda en disco en ningún punto).
 */

const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * TypeScript trata Buffer.buffer como ArrayBufferLike (podría en teoría
 * ser un SharedArrayBuffer), pero el constructor de Blob exige
 * ArrayBuffer específicamente. En la práctica, un Buffer de Node siempre
 * está respaldado por un ArrayBuffer real — esta función solo satisface
 * al type-checker sin cambiar nada en tiempo de ejecución.
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Mapa de textos de botón en español (los que genera Claude) a los
 * valores exactos que acepta la API de Meta (catálogo cerrado, en
 * inglés). Si el texto generado no hace match con nada de la lista, se
 * usa LEARN_MORE por default.
 */
const CTA_MAP: Record<string, string> = {
  'más información': 'LEARN_MORE',
  'saber más': 'LEARN_MORE',
  'contáctanos': 'CONTACT_US',
  contactanos: 'CONTACT_US',
  'solicitar cotización': 'GET_QUOTE',
  'solicitar cotizacion': 'GET_QUOTE',
  cotizar: 'GET_QUOTE',
  registrarse: 'SIGN_UP',
  suscribirse: 'SUBSCRIBE',
  'comprar ahora': 'SHOP_NOW',
  'ver más': 'LEARN_MORE',
  'agendar cita': 'BOOK_TRAVEL',
  'enviar mensaje': 'MESSAGE_PAGE',
  whatsapp: 'WHATSAPP_MESSAGE',
  'descargar': 'DOWNLOAD',
  'aplicar ahora': 'APPLY_NOW',
};

export function mapCtaToMetaEnum(ctaText: string): string {
  const normalized = ctaText.trim().toLowerCase();
  return CTA_MAP[normalized] || 'LEARN_MORE';
}

interface GraphError {
  _error: { status: number; message: string; body: unknown };
}

function isGraphError(value: unknown): value is GraphError {
  return !!value && typeof value === 'object' && '_error' in (value as object);
}

async function graphPostForm(path: string, form: FormData, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  form.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();

  if (!res.ok) {
    const err = data?.error ?? {};
    const detailedMessage = [err.error_user_title, err.error_user_msg, err.message, err.error_subcode ? `(subcode ${err.error_subcode})` : null]
      .filter(Boolean)
      .join(' — ');
    console.error(`[metaCreative] POST ${path} falló:`, JSON.stringify(data, null, 2));
    return { _error: { status: res.status, message: detailedMessage || `HTTP ${res.status}`, body: data } } satisfies GraphError;
  }

  return data;
}

async function graphPostJSON(path: string, params: Record<string, unknown>, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  body.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();

  if (!res.ok) {
    const err = data?.error ?? {};
    const detailedMessage = [err.error_user_title, err.error_user_msg, err.message, err.error_subcode ? `(subcode ${err.error_subcode})` : null]
      .filter(Boolean)
      .join(' — ');
    console.error(`[metaCreative] POST ${path} falló:`, JSON.stringify(data, null, 2));
    return { _error: { status: res.status, message: detailedMessage || `HTTP ${res.status}`, body: data } } satisfies GraphError;
  }

  return data;
}

export type ImageSource =
  | { kind: 'file'; file: File }
  | { kind: 'buffer'; buffer: Buffer; filename: string; mimeType: string };

export interface CreateAdInput {
  accountId: string;
  token: string;
  adSetId: string;
  pageId: string;
  image: ImageSource;
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string; // texto libre en español (de la variante generada) o la selección del usuario
  adName: string;
  /**
   * Si se da, el anuncio abre el Instant Form de Meta en vez de mandar a
   * destinationLink (típico para objetivo "leads"). destinationLink igual
   * se manda como respaldo/fallback en algunos placements.
   */
  leadFormId?: string;
}

export interface CreateAdResult {
  adId: string;
  creativeId: string;
  adsManagerUrl: string;
}

function buildLinkData(input: {
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string;
  leadFormId?: string;
  imageHash?: string;
  videoId?: string;
}) {
  const ctaType = input.leadFormId ? 'SIGN_UP' : mapCtaToMetaEnum(input.ctaText);
  const ctaValue: Record<string, unknown> = input.leadFormId
    ? { lead_gen_form_id: input.leadFormId }
    : { link: input.destinationLink };

  return {
    message: input.primaryText,
    link: input.destinationLink,
    name: input.headline,
    ...(input.imageHash ? { image_hash: input.imageHash } : {}),
    call_to_action: { type: ctaType, value: ctaValue },
  };
}

export async function createPausedAdWithImage(input: CreateAdInput): Promise<CreateAdResult> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';

  // 1. Subir la imagen a la galería de anuncios de la cuenta.
  const imageForm = new FormData();
  if (input.image.kind === 'file') {
    imageForm.set('source', input.image.file, input.image.file.name);
  } else {
    const blob = new Blob([bufferToArrayBuffer(input.image.buffer)], { type: input.image.mimeType });
    imageForm.set('source', blob, input.image.filename);
  }

  const uploadResult = await graphPostForm(`${input.accountId}/adimages`, imageForm, input.token, apiVersion);
  if (isGraphError(uploadResult)) {
    throw new Error(`No se pudo subir la imagen a Meta: ${uploadResult._error.message}`);
  }

  // La respuesta viene como { images: { "nombre-del-archivo": { hash, url, ... } } }
  const imagesObj = uploadResult.images ?? {};
  const firstImageKey = Object.keys(imagesObj)[0];
  const imageHash: string | undefined = firstImageKey ? imagesObj[firstImageKey]?.hash : undefined;

  if (!imageHash) {
    throw new Error('Meta no devolvió un hash de imagen válido tras la subida.');
  }

  // 2. Crear el ad creative (el diseño del anuncio).
  const creative = await graphPostJSON(
    `${input.accountId}/adcreatives`,
    {
      name: `${input.adName} — creativo`,
      object_story_spec: {
        page_id: input.pageId,
        link_data: buildLinkData({ ...input, imageHash }),
      },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(creative)) {
    throw new Error(`No se pudo crear el creativo: ${creative._error.message}`);
  }

  const creativeId: string = creative.id;

  // 3. Crear el Ad final, PAUSED.
  const ad = await graphPostJSON(
    `${input.accountId}/ads`,
    {
      name: input.adName,
      adset_id: input.adSetId,
      status: 'PAUSED',
      creative: { creative_id: creativeId },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(ad)) {
    throw new Error(`El creativo se creó, pero no se pudo crear el anuncio: ${ad._error.message}`);
  }

  return {
    adId: ad.id,
    creativeId,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${input.accountId.replace('act_', '')}&selected_ad_ids=${ad.id}`,
  };
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export type VideoSource =
  | { kind: 'file'; file: File }
  | { kind: 'buffer'; buffer: Buffer; filename: string; mimeType: string };

export interface CreateVideoAdInput {
  accountId: string;
  token: string;
  adSetId: string;
  pageId: string;
  video: VideoSource;
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string;
  adName: string;
  leadFormId?: string;
  /** Cuánto esperar máximo (ms) a que Meta termine de procesar el video antes de rendirse. Default 45s. */
  maxWaitMs?: number;
}

/**
 * Sube el video, espera a que Meta lo termine de procesar (es asíncrono —
 * puede tardar de segundos a un par de minutos según duración/peso), y
 * arma el Ad final. Si no termina de procesar dentro de maxWaitMs, avisa
 * con un error claro en vez de fallar en silencio — el video sigue
 * procesándose del lado de Meta aunque nuestra función se rinda, así que
 * reintentar más tarde con el mismo video_id (no implementado todavía,
 * ver nota abajo) funcionaría.
 */
export async function createPausedAdWithVideo(input: CreateVideoAdInput): Promise<CreateAdResult> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const maxWaitMs = input.maxWaitMs ?? 45000;

  // 1. Subir el video.
  const videoForm = new FormData();
  if (input.video.kind === 'file') {
    videoForm.set('source', input.video.file, input.video.file.name);
  } else {
    const blob = new Blob([bufferToArrayBuffer(input.video.buffer)], { type: input.video.mimeType });
    videoForm.set('source', blob, input.video.filename);
  }

  const uploadResult = await graphPostForm(`${input.accountId}/advideos`, videoForm, input.token, apiVersion);
  if (isGraphError(uploadResult)) {
    throw new Error(`No se pudo subir el video a Meta: ${uploadResult._error.message}`);
  }

  const videoId: string | undefined = uploadResult.id;
  if (!videoId) {
    throw new Error('Meta no devolvió un ID de video tras la subida.');
  }

  // 2. Esperar a que termine de procesar (polling).
  const start = Date.now();
  let thumbnailUrl: string | undefined;
  let ready = false;

  while (Date.now() - start < maxWaitMs) {
    const statusUrl = `${GRAPH_BASE}/${apiVersion}/${videoId}?fields=status,thumbnails&access_token=${input.token}`;
    const res = await fetch(statusUrl);
    const data = await res.json();

    const videoStatus = data?.status?.video_status;
    if (videoStatus === 'ready') {
      ready = true;
      thumbnailUrl = data?.thumbnails?.data?.[0]?.uri;
      break;
    }
    if (videoStatus === 'error') {
      throw new Error('Meta reportó un error al procesar el video (formato/tamaño no soportado).');
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (!ready) {
    throw new Error(
      `El video se subió (ID ${videoId}) pero Meta todavía lo está procesando después de ${Math.round(maxWaitMs / 1000)}s. Espera unos minutos y vuelve a intentar crear el anuncio — videos largos/pesados pueden tardar más.`,
    );
  }

  // 3. Crear el ad creative de video.
  const ctaType = input.leadFormId ? 'SIGN_UP' : mapCtaToMetaEnum(input.ctaText);
  const ctaValue: Record<string, unknown> = input.leadFormId
    ? { lead_gen_form_id: input.leadFormId }
    : { link: input.destinationLink };

  const creative = await graphPostJSON(
    `${input.accountId}/adcreatives`,
    {
      name: `${input.adName} — creativo`,
      object_story_spec: {
        page_id: input.pageId,
        video_data: {
          video_id: videoId,
          title: input.headline,
          message: input.primaryText,
          link_description: input.destinationLink,
          call_to_action: { type: ctaType, value: ctaValue },
          ...(thumbnailUrl ? { image_url: thumbnailUrl } : {}),
        },
      },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(creative)) {
    throw new Error(`No se pudo crear el creativo de video: ${creative._error.message}`);
  }

  const creativeId: string = creative.id;

  // 4. Crear el Ad final, PAUSED.
  const ad = await graphPostJSON(
    `${input.accountId}/ads`,
    {
      name: input.adName,
      adset_id: input.adSetId,
      status: 'PAUSED',
      creative: { creative_id: creativeId },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(ad)) {
    throw new Error(`El creativo de video se creó, pero no se pudo crear el anuncio: ${ad._error.message}`);
  }

  return {
    adId: ad.id,
    creativeId,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${input.accountId.replace('act_', '')}&selected_ad_ids=${ad.id}`,
  };
}