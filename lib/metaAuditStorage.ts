import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import type { MetaAuditResult } from './metaAudit';

/**
 * Guarda y lee el último resultado de auditoría de Meta Ads por cuenta, en
 * una pestaña dedicada del mismo Google Sheet que ya usas para los leads.
 * Así el panel puede mostrar la última auditoría guardada al entrar, sin
 * gastar en la API de Claude cada vez que alguien abre la página — solo se
 * vuelve a llamar a Claude cuando el usuario le da clic a "Correr
 * auditoría" explícitamente.
 *
 * IMPORTANTE — a diferencia de lib/googleSheets.ts (que es solo lectura),
 * este módulo necesita permiso de ESCRITURA en el Sheet:
 *
 * 1. En tu Google Sheet, crea una pestaña nueva llamada exactamente:
 *    MetaAudits
 * 2. En la fila 1 de esa pestaña, agrega estos encabezados exactos:
 *    AccountId | GeneratedAt | HealthScore | Grade | AuditJson
 * 3. Usa las MISMAS variables de entorno que ya tienes
 *    (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID) —
 *    la cuenta de servicio ya tiene acceso al documento, solo necesita
 *    permiso de "Editor" en vez de "Lector" para poder escribir.
 */

const WRITE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_TITLE = 'MetaAudits';

async function getMetaAuditsSheet() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.error('[metaAuditStorage] Faltan variables de entorno de Google.');
    return null;
  }

  const jwt = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: WRITE_SCOPES,
  });

  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_TITLE];
  if (!sheet) {
    console.error(
      `[metaAuditStorage] No existe la pestaña "${SHEET_TITLE}" en el Sheet. Créala con encabezados: AccountId, GeneratedAt, HealthScore, Grade, AuditJson.`,
    );
    return null;
  }

  return sheet;
}

export interface StoredMetaAudit {
  generatedAt: string;
  audit: MetaAuditResult;
}

/** Lee la última auditoría guardada para una cuenta, o null si nunca se ha guardado una. */
export async function getLastMetaAudit(accountId: string): Promise<StoredMetaAudit | null> {
  try {
    const sheet = await getMetaAuditsSheet();
    if (!sheet) return null;

    const rows = await sheet.getRows();
    const row = rows.find((r) => r.get('AccountId') === accountId);
    if (!row) return null;

    const auditJson = row.get('AuditJson');
    if (!auditJson) return null;

    return {
      generatedAt: row.get('GeneratedAt') ?? '',
      audit: JSON.parse(auditJson) as MetaAuditResult,
    };
  } catch (error) {
    console.error('[metaAuditStorage] Error al leer la última auditoría:', error);
    return null;
  }
}

/** Guarda (o reemplaza) el resultado de auditoría de una cuenta — un renglón por cuenta, siempre el más reciente. */
export async function saveMetaAudit(accountId: string, audit: MetaAuditResult): Promise<void> {
  try {
    const sheet = await getMetaAuditsSheet();
    if (!sheet) return;

    const rows = await sheet.getRows();
    const existing = rows.find((r) => r.get('AccountId') === accountId);

    const values = {
      AccountId: accountId,
      GeneratedAt: audit.generated_at,
      HealthScore: String(Math.round(audit.health_score)),
      Grade: audit.grade,
      AuditJson: JSON.stringify(audit),
    };

    if (existing) {
      existing.set('AccountId', values.AccountId);
      existing.set('GeneratedAt', values.GeneratedAt);
      existing.set('HealthScore', values.HealthScore);
      existing.set('Grade', values.Grade);
      existing.set('AuditJson', values.AuditJson);
      await existing.save();
    } else {
      await sheet.addRow(values);
    }
  } catch (error) {
    // Si guardar falla, no tumbamos la auditoría en sí — el usuario ya vio
    // su resultado, solo no quedó cacheado para la próxima visita.
    console.error('[metaAuditStorage] Error al guardar la auditoría (el resultado igual se mostró al usuario):', error);
  }
}