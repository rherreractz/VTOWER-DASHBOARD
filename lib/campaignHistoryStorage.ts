import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import type { CampaignBrief } from './metaCampaignGenerator';
import type { CreatePausedCampaignResult } from './metaCampaignCreate';

/**
 * Guarda un renglón por cada campaña generada (manual desde el dashboard, o
 * automática desde el cron semanal) — a diferencia de metaAuditStorage.ts
 * (que solo guarda LA ÚLTIMA), aquí queremos el historial completo, para
 * poder responder "¿cuántas campañas se generaron este mes?" y para tener
 * rastro de qué se creó automáticamente sin que nadie lo pidiera esa
 * semana.
 *
 * Configuración en tu Google Sheet (igual que MetaAudits):
 * 1. Crea una pestaña nueva llamada exactamente: CampaignHistory
 * 2. Encabezados en la fila 1: AccountId | GeneratedAt | Source | CampaignName | CampaignId | AdSetId | DailyBudgetMXN
 * 3. Mismas variables de entorno de Google que ya tienes, con permiso de Editor.
 */

const WRITE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_TITLE = 'CampaignHistory';

export type CampaignSource = 'manual' | 'weekly-cron';

async function getCampaignHistorySheet() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.error('[campaignHistory] Faltan variables de entorno de Google.');
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
      `[campaignHistory] No existe la pestaña "${SHEET_TITLE}". Créala con encabezados: AccountId, GeneratedAt, Source, CampaignName, CampaignId, AdSetId, DailyBudgetMXN.`,
    );
    return null;
  }

  return sheet;
}

/** Agrega un renglón nuevo al historial. No lanza error si falla (no debe tumbar la generación de campaña en sí). */
export async function logCampaignGenerated(
  accountId: string,
  brief: CampaignBrief,
  created: CreatePausedCampaignResult,
  source: CampaignSource,
): Promise<void> {
  try {
    const sheet = await getCampaignHistorySheet();
    if (!sheet) return;

    await sheet.addRow({
      AccountId: accountId,
      GeneratedAt: new Date().toISOString(),
      Source: source,
      CampaignName: brief.campaignName,
      CampaignId: created.campaignId,
      AdSetId: created.adSetId,
      DailyBudgetMXN: String(brief.dailyBudgetMXN),
    });
  } catch (error) {
    console.error('[campaignHistory] Error al guardar el historial (la campaña igual se creó en Meta):', error);
  }
}

export interface CampaignHistoryEntry {
  accountId: string;
  generatedAt: string;
  source: CampaignSource;
  campaignName: string;
  campaignId: string;
  adSetId: string;
  dailyBudgetMXN: number;
}

/** Lee todo el historial de una cuenta (o de todas, si no se especifica accountId), más reciente primero. */
export async function getCampaignHistory(accountId?: string): Promise<CampaignHistoryEntry[]> {
  try {
    const sheet = await getCampaignHistorySheet();
    if (!sheet) return [];

    const rows = await sheet.getRows();
    return rows
      .filter((r) => !accountId || r.get('AccountId') === accountId)
      .map((r) => ({
        accountId: r.get('AccountId') ?? '',
        generatedAt: r.get('GeneratedAt') ?? '',
        source: (r.get('Source') as CampaignSource) ?? 'manual',
        campaignName: r.get('CampaignName') ?? '',
        campaignId: r.get('CampaignId') ?? '',
        adSetId: r.get('AdSetId') ?? '',
        dailyBudgetMXN: Number(r.get('DailyBudgetMXN')) || 0,
      }))
      .reverse();
  } catch (error) {
    console.error('[campaignHistory] Error al leer el historial:', error);
    return [];
  }
}