import { JWT } from 'google-auth-library';

/**
 * Lee y descarga imágenes de una carpeta de Google Drive — usado para que
 * Claude elija automáticamente cuál imagen va con cada variante de copy,
 * y para subirla directo a Meta sin que el usuario tenga que hacerlo a
 * mano.
 *
 * IMPORTANTE: usa una cuenta de servicio DISTINTA a la de Google Sheets
 * (por separar permisos — esta solo necesita leer Drive, no escribir
 * Sheets). Variables de entorno nuevas:
 *
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL="live-drive-reader@tu-proyecto.iam.gserviceaccount.com"
 * GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 * GOOGLE_DRIVE_ACCOUNT_FOLDERS='[{"accountId":"act_1586604569106474","folderId":"1AbC2dEfGhIjKlMnOpQrStUvWxYz"}]'
 *
 * Cada carpeta de Drive debe compartirse (permiso "Lector") con el correo
 * de GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL.
 */

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
}

function getDriveJwt(): JWT | null {
  const { GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_DRIVE_PRIVATE_KEY) {
    console.error('[driveImages] Faltan GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY.');
    return null;
  }
  return new JWT({
    email: GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: DRIVE_SCOPES,
  });
}

interface AccountFolderConfig {
  accountId: string;
  /** Puede ser una sola carpeta o varias (ej. varios desarrollos para la misma cuenta). */
  folderId?: string;
  folderIds?: string[];
}

/** Devuelve TODOS los folder IDs configurados para una cuenta (soporta una o varias carpetas). */
export function getFolderIdsForAccount(accountId: string): string[] {
  const raw = process.env.GOOGLE_DRIVE_ACCOUNT_FOLDERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AccountFolderConfig[];
    const config = parsed.find((c) => c.accountId === accountId);
    if (!config) return [];
    if (config.folderIds?.length) return config.folderIds;
    if (config.folderId) return [config.folderId];
    return [];
  } catch {
    console.error('[driveImages] GOOGLE_DRIVE_ACCOUNT_FOLDERS no es JSON válido.');
    return [];
  }
}

/** @deprecated usa getFolderIdsForAccount — se deja por compatibilidad. */
export function getFolderIdForAccount(accountId: string): string | null {
  return getFolderIdsForAccount(accountId)[0] ?? null;
}

export interface DriveMedia {
  id: string;
  name: string;
  mimeType: string;
  mediaType: 'image' | 'video';
}

/** Lista imágenes Y videos dentro de una carpeta de Drive. */
export async function listMediaInFolder(folderId: string): Promise<DriveMedia[]> {
  const jwt = getDriveJwt();
  if (!jwt) return [];

  const { token } = await jwt.getAccessToken();
  if (!token) {
    console.error('[driveImages] No se pudo obtener access token de Google.');
    return [];
  }

  const query = encodeURIComponent(
    `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
  );
  const url = `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name,mimeType)&pageSize=100`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`[driveImages] Error ${res.status} al listar la carpeta:`, await res.text());
    return [];
  }

  const data = await res.json();
  return ((data.files ?? []) as Array<{ id: string; name: string; mimeType: string }>).map((f) => ({
    ...f,
    mediaType: f.mimeType.startsWith('video/') ? ('video' as const) : ('image' as const),
  }));
}

/** Igual que listMediaInFolder, pero combina el contenido de varias carpetas en una sola lista. */
export async function listMediaInFolders(folderIds: string[]): Promise<DriveMedia[]> {
  const results = await Promise.all(folderIds.map((id) => listMediaInFolder(id)));
  return results.flat();
}

/** @deprecated usa listMediaInFolder — se deja por compatibilidad con código existente. */
export async function listImagesInFolder(folderId: string): Promise<DriveImage[]> {
  const media = await listMediaInFolder(folderId);
  return media.filter((m) => m.mediaType === 'image');
}

/** Descarga el contenido crudo (bytes) de un archivo de Drive. */
export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const jwt = getDriveJwt();
  if (!jwt) return null;

  const { token } = await jwt.getAccessToken();
  if (!token) return null;

  const metaRes = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=mimeType`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    console.error(`[driveImages] Error ${metaRes.status} al leer metadata del archivo ${fileId}.`);
    return null;
  }
  const meta = await metaRes.json();

  const fileRes = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) {
    console.error(`[driveImages] Error ${fileRes.status} al descargar el archivo ${fileId}.`);
    return null;
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: meta.mimeType ?? 'image/jpeg' };
}