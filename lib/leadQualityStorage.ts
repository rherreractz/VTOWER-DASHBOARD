import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import type { LeadQualityGroup } from './leadUtils';

/**
 * Guarda un HISTORIAL de snapshots (una fila nueva por día) con la
 * calidad de leads, calculada cada vez que alguien carga el dashboard de
 * Leads (ver app/page.tsx). getLeadQualitySummary() sigue devolviendo
 * solo el más reciente (lo que usa la generación de campañas);
 * getLeadQualityHistory() devuelve la serie completa (para la gráfica de
 * línea del tiempo).
 *
 * Se guarda como MÁXIMO una fila por día (si ya hay una del día de hoy,
 * se actualiza esa en vez de crear otra) — así el Sheet no se llena de
 * cientos de filas casi idénticas si el dashboard se recarga muchas veces
 * en un mismo día. El histórico real (mes a mes, semana a semana) sigue
 * intacto.
 *
 * Configuración en tu Google Sheet (mismo patrón que MetaAudits):
 * 1. Crea una pestaña nueva llamada exactamente: LeadQualitySummary
 * 2. Encabezados en la fila 1: GeneratedAt | DateKey | SummaryJson
 * 3. Mismas variables de entorno de Google que ya tienes, con permiso de Editor.
 *
 * Si ya tenías esta pestaña de antes de este cambio (con encabezados
 * GeneratedAt | SummaryJson, sin DateKey), agrégale la columna DateKey en
 * la fila 1 — la fila vieja que ya tenías simplemente se tratará como si
 * fuera de hace mucho y se creará una fila nueva para hoy, sin que se
 * pierda nada.
 */

const WRITE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_TITLE = 'LeadQualitySummary';

export interface LeadQualitySnapshot {
  generatedAt: string;
  byFuente: LeadQualityGroup[];
  byCampana: LeadQualityGroup[];
}

async function getSheet() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.error('[leadQualityStorage] Faltan variables de entorno de Google.');
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
    console.error(`[leadQualityStorage] No existe la pestaña "${SHEET_TITLE}". Créala con encabezados: GeneratedAt, DateKey, SummaryJson.`);
    return null;
  }

  return sheet;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

/** Guarda el snapshot de hoy (actualiza la fila de hoy si ya existe, si no crea una nueva) — nunca lanza error, no debe tumbar la carga del dashboard. */
export async function saveLeadQualitySummary(snapshot: LeadQualitySnapshot): Promise<void> {
  try {
    const sheet = await getSheet();
    if (!sheet) return;

    const dateKey = todayKey();
    const rows = await sheet.getRows();
    const todayRow = rows.find((r) => r.get('DateKey') === dateKey);

    const values = {
      GeneratedAt: snapshot.generatedAt,
      DateKey: dateKey,
      SummaryJson: JSON.stringify({ byFuente: snapshot.byFuente, byCampana: snapshot.byCampana }),
    };

    if (todayRow) {
      todayRow.set('GeneratedAt', values.GeneratedAt);
      todayRow.set('SummaryJson', values.SummaryJson);
      await todayRow.save();
    } else {
      await sheet.addRow(values);
    }
  } catch (error) {
    console.error('[leadQualityStorage] Error al guardar (no crítico):', error);
  }
}

/** Lee el snapshot más reciente (por fecha) — lo que usa la generación de campañas. */
export async function getLeadQualitySummary(): Promise<LeadQualitySnapshot | null> {
  try {
    const sheet = await getSheet();
    if (!sheet) return null;

    const rows = await sheet.getRows();
    if (rows.length === 0) return null;

    // Ordena por DateKey descendente y toma la más reciente — no asume
    // que la última fila del Sheet sea la más nueva (por si alguna vez
    // se edita el orden a mano).
    const sorted = [...rows].sort((a, b) => (b.get('DateKey') ?? '').localeCompare(a.get('DateKey') ?? ''));
    const row = sorted[0];

    const json = row.get('SummaryJson');
    if (!json) return null;

    const parsed = JSON.parse(json) as { byFuente?: LeadQualityGroup[]; byCampana?: LeadQualityGroup[] };
    return {
      generatedAt: row.get('GeneratedAt') ?? '',
      byFuente: parsed.byFuente ?? [],
      byCampana: parsed.byCampana ?? [],
    };
  } catch (error) {
    console.error('[leadQualityStorage] Error al leer:', error);
    return null;
  }
}

export interface LeadQualityHistoryPoint {
  dateKey: string;
  generatedAt: string;
  byFuente: LeadQualityGroup[];
  byCampana: LeadQualityGroup[];
}

/**
 * Lee TODO el historial guardado (un punto por día), ordenado del más
 * antiguo al más reciente — para graficar "cómo fue mejorando/empeorando
 * la calidad de leads a lo largo del tiempo".
 */
export async function getLeadQualityHistory(): Promise<LeadQualityHistoryPoint[]> {
  try {
    const sheet = await getSheet();
    if (!sheet) return [];

    const rows = await sheet.getRows();

    return rows
      .map((row) => {
        const json = row.get('SummaryJson');
        if (!json) return null;
        try {
          const parsed = JSON.parse(json) as { byFuente?: LeadQualityGroup[]; byCampana?: LeadQualityGroup[] };
          return {
            dateKey: row.get('DateKey') ?? '',
            generatedAt: row.get('GeneratedAt') ?? '',
            byFuente: parsed.byFuente ?? [],
            byCampana: parsed.byCampana ?? [],
          };
        } catch {
          return null; // fila con JSON corrupto — se omite, no tumba el resto del historial
        }
      })
      .filter((point): point is LeadQualityHistoryPoint => point !== null)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  } catch (error) {
    console.error('[leadQualityStorage] Error al leer historial:', error);
    return [];
  }
}