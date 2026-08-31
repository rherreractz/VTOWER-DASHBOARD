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

/**
 * Meta a veces responde con cuerpo VACÍO o con HTML/texto plano (errores de
 * su edge, límites de tamaño, multipart mal parseado por un filename con
 * caracteres raros, etc.). Hacer `res.json()` directo en esos casos tira
 * "Unexpected end of JSON input" y se pierde el status y el cuerpo reales.
 * Esto lee el texto una sola vez y lo intenta parsear; si no es JSON,
 * devuelve un _error con el status y un fragmento del cuerpo crudo para
 * poder diagnosticar qué pasó de verdad.
 */
async function readGraphResponse(res: Response, path: string): Promise<any> {
  const raw = await res.text();

  let data: any = null;
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      // no era JSON
    }
  }

  if (res.ok && data !== null) return data;

  if (res.ok && data === null) {
    // 2xx pero sin JSON: raro, pero lo tratamos como error para no seguir
    // con `data.id` undefined más abajo.
    console.error(`[metaCreative] POST ${path} devolvió 2xx sin JSON. Cuerpo:`, raw.slice(0, 500));
    return {
      _error: { status: res.status, message: `Meta respondió ${res.status} con un cuerpo vacío o no-JSON.`, body: raw.slice(0, 500) },
    } satisfies GraphError;
  }

  const err = data?.error ?? {};
  const detailedMessage = [
    err.error_user_title,
    err.error_user_msg,
    err.message,
    err.error_subcode ? `(subcode ${err.error_subcode})` : null,
    err.fbtrace_id ? `[trace: ${err.fbtrace_id}]` : null,
  ]
    .filter(Boolean)
    .join(' — ');

  const fallbackMessage = data === null
    ? `Meta respondió HTTP ${res.status} con un cuerpo vacío o no-JSON: ${raw.slice(0, 300) || '(sin cuerpo)'}`
    : `HTTP ${res.status}`;

  console.error(`[metaCreative] POST ${path} falló:`, data !== null ? JSON.stringify(data, null, 2) : raw.slice(0, 500));
  return {
    _error: { status: res.status, message: detailedMessage || fallbackMessage, body: data ?? raw.slice(0, 500) },
  } satisfies GraphError;
}

async function graphPostForm(path: string, form: FormData, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  form.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body: form });
  return readGraphResponse(res, path);
}

async function graphPostJSON(path: string, params: Record<string, unknown>, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  body.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body });
  return readGraphResponse(res, path);
}

/**
 * Meta parsea mal el multipart cuando el `filename` de la parte trae bytes
 * no-ASCII (acentos, ñ, emojis) — en muchos casos responde con un cuerpo
 * vacío. Los archivos de Drive suelen nombrarse con el desarrollo ("Señorío",
 * "Olivia SQ", etc.), así que normalizamos: quitamos acentos, dejamos solo
 * ASCII seguro y conservamos la extensión.
 */
function asciiFilename(name: string, fallbackExt: string): string {
  // NFKD separa "é" en "e" + acento combinante; luego quitamos todo lo que
  // no sea ASCII imprimible (el acento, la ñ, emojis…) y dejamos solo
  // caracteres seguros para un header de multipart.
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^\w.\- ]+/g, '_')
    .trim();
  const safe = normalized || `upload${fallbackExt}`;
  return /\.[a-z0-9]{2,4}$/i.test(safe) ? safe : `${safe}${fallbackExt}`;
}

/**
 * Sube un video a Meta usando el protocolo RESUMABLE (por partes):
 * `upload_phase=start` → varios `transfer` (Meta dicta el tamaño de cada
 * chunk con el end_offset que devuelve) → `finish`.
 *
 * La subida en un solo request (`source=<archivo entero>`) hace que el
 * edge de Meta devuelva HTTP 413 ("Payload Too Large", cuerpo vacío) en
 * cuanto el video pesa un poco. El protocolo por partes no tiene ese tope.
 *
 * Devuelve el video_id ya subido (todavía puede estar procesándose del
 * lado de Meta — eso se espera con el polling de status aparte).
 */
async function uploadVideoResumable(opts: {
  accountId: string;
  token: string;
  apiVersion: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  const { accountId, token, apiVersion } = opts;
  const path = `${accountId}/advideos`;
  const fileName = asciiFilename(opts.filename, '.mp4');
  const mimeType = opts.mimeType || 'video/mp4';
  const fileSize = opts.buffer.byteLength;

  if (fileSize === 0) {
    throw new Error('El archivo de video está vacío (0 bytes).');
  }

  // --- start ---
  const startForm = new FormData();
  startForm.set('upload_phase', 'start');
  startForm.set('file_size', String(fileSize));
  const startRes = await graphPostForm(path, startForm, token, apiVersion);
  if (isGraphError(startRes)) {
    throw new Error(`No se pudo iniciar la subida del video a Meta: ${startRes._error.message}`);
  }

  const uploadSessionId: string | undefined = startRes.upload_session_id;
  const videoId: string | undefined = startRes.video_id;
  if (!uploadSessionId || !videoId) {
    throw new Error('Meta no devolvió upload_session_id / video_id al iniciar la subida del video.');
  }

  // Meta dice cuánto quiere en cada chunk con end_offset, pero a veces
  // devuelve una ventana enorme; el protocolo permite mandar MENOS y Meta
  // responde con el siguiente offset. Capamos a 8 MB por request para no
  // volver a chocar con el 413 por tamaño.
  const MAX_CHUNK = 8 * 1024 * 1024;

  let startOffset = Number(startRes.start_offset);
  let endOffset = Number(startRes.end_offset);

  // --- transfer (chunks) ---
  let guard = 0;
  while (startOffset < endOffset) {
    if (++guard > 100000) {
      throw new Error('Demasiados chunks al subir el video — se abortó por seguridad.');
    }

    const chunkEnd = Math.min(endOffset, startOffset + MAX_CHUNK);
    const chunk = new Uint8Array(opts.buffer.subarray(startOffset, chunkEnd));

    let transferRes: any;
    let attempt = 0;
    while (true) {
      const transferForm = new FormData();
      transferForm.set('upload_phase', 'transfer');
      transferForm.set('upload_session_id', uploadSessionId);
      transferForm.set('start_offset', String(startOffset));
      transferForm.set('video_file_chunk', new Blob([chunk], { type: mimeType }), fileName);

      transferRes = await graphPostForm(path, transferForm, token, apiVersion);
      if (!isGraphError(transferRes)) break;

      if (++attempt >= 3) {
        throw new Error(`Falló la transferencia del video a Meta (offset ${startOffset}): ${transferRes._error.message}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    startOffset = Number(transferRes.start_offset);
    endOffset = Number(transferRes.end_offset);
  }

  // --- finish ---
  const finishForm = new FormData();
  finishForm.set('upload_phase', 'finish');
  finishForm.set('upload_session_id', uploadSessionId);
  const finishRes = await graphPostForm(path, finishForm, token, apiVersion);
  if (isGraphError(finishRes)) {
    throw new Error(`Meta no pudo finalizar la subida del video: ${finishRes._error.message}`);
  }

  return videoId;
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
    const blob = new Blob([bufferToArrayBuffer(input.image.buffer)], { type: input.image.mimeType || 'image/jpeg' });
    imageForm.set('source', blob, asciiFilename(input.image.filename, '.jpg'));
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

  // 1. Subir el video con el protocolo resumable (por partes) — la subida
  //    en un solo request revienta con HTTP 413 en cuanto el video pesa.
  let videoBuffer: Buffer;
  let videoFilename: string;
  let videoMime: string;
  if (input.video.kind === 'file') {
    videoBuffer = Buffer.from(await input.video.file.arrayBuffer());
    videoFilename = input.video.file.name || 'video.mp4';
    videoMime = input.video.file.type || 'video/mp4';
  } else {
    videoBuffer = input.video.buffer;
    videoFilename = input.video.filename;
    videoMime = input.video.mimeType || 'video/mp4';
  }

  const videoId = await uploadVideoResumable({
    accountId: input.accountId,
    token: input.token,
    apiVersion,
    buffer: videoBuffer,
    filename: videoFilename,
    mimeType: videoMime,
  });

  // 2. Esperar a que termine de procesar (polling).
  const start = Date.now();
  let thumbnailUrl: string | undefined;
  let ready = false;

  while (Date.now() - start < maxWaitMs) {
    const statusUrl = `${GRAPH_BASE}/${apiVersion}/${videoId}?fields=status,thumbnails&access_token=${input.token}`;
    const res = await fetch(statusUrl);
    const rawStatus = await res.text();
    let data: any = null;
    try {
      data = rawStatus.trim() ? JSON.parse(rawStatus) : null;
    } catch {
      // respuesta no-JSON de Meta durante el polling: la ignoramos y
      // reintentamos en la siguiente vuelta en vez de tumbar el flujo.
      console.error('[metaCreative] status del video devolvió no-JSON:', rawStatus.slice(0, 300));
    }

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