import { NextRequest, NextResponse } from 'next/server';
import { generateCampaignBrief } from '@/lib/metaCampaignGenerator';
import { createPausedCampaign } from '@/lib/metaCampaignCreate';
import { logCampaignGenerated } from '@/lib/campaignHistoryStorage';
import { buildCampaignContext } from '@/lib/campaignAuditContext';

export const maxDuration = 60;

/**
 * Corre automáticamente cada semana (ver vercel.json) — genera y crea UNA
 * campaña PAUSADA por cada cuenta configurada en META_WEEKLY_CAMPAIGN_ACCOUNTS,
 * usando los Quick Wins de la última auditoría guardada como inspiración
 * para el prompt (ya que no hay un humano escribiéndolo esa semana).
 *
 * SIEMPRE crea en PAUSED — igual que el flujo manual — así que no hay
 * riesgo de gasto automático; solo aparece un borrador nuevo cada semana
 * para que alguien lo revise y active.
 *
 * Variable de entorno nueva requerida:
 *
 * META_WEEKLY_CAMPAIGN_ACCOUNTS='[
 *   {
 *     "accountId": "act_1586604569106474",
 *     "businessDescription": "Desarrollo residencial Live Neo en Cancún, departamentos desde $2.5 MDP",
 *     "targetDescription": "Inversionistas y compradores de segunda vivienda, 30-55 años, interesados en bienes raíces en el Caribe mexicano",
 *     "dailyBudgetMXN": 300,
 *     "pageId": "100041452645865"
 *   }
 * ]'
 *
 * Seguridad: Vercel manda automáticamente el header
 * "Authorization: Bearer $CRON_SECRET" en cada invocación programada
 * (CRON_SECRET lo genera Vercel solo). Verificamos ese header para que
 * nadie más pueda disparar esta ruta y generar campañas a tu costo.
 */

interface WeeklyAccountConfig {
  accountId: string;
  businessDescription: string;
  targetDescription: string;
  dailyBudgetMXN?: number;
  countryCode?: string;
  /** Requerido si el objetivo termina siendo "leads" (u otros que necesitan promoted_object). */
  pageId?: string;
}

function getWeeklyAccounts(): WeeklyAccountConfig[] {
  const raw = process.env.META_WEEKLY_CAMPAIGN_ACCOUNTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('[cron/weekly-campaign] META_WEEKLY_CAMPAIGN_ACCOUNTS no es JSON válido.');
    return [];
  }
}

async function buildPromptForAccount(accountConfig: WeeklyAccountConfig): Promise<{ prompt: string; auditContext: string }> {
  const auditContext = await buildCampaignContext(accountConfig.accountId);
  const budgetLine = accountConfig.dailyBudgetMXN ? `Presupuesto diario: $${accountConfig.dailyBudgetMXN} MXN.` : '';

  const prompt = `Genera una campaña de generación de leads.

Negocio: ${accountConfig.businessDescription}
Público objetivo: ${accountConfig.targetDescription}
${budgetLine}`;

  return { prompt, auditContext };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Falta META_ACCESS_TOKEN.' }, { status: 500 });
  }

  const accounts = getWeeklyAccounts();
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'META_WEEKLY_CAMPAIGN_ACCOUNTS está vacío o no configurado — nada que generar.' });
  }

  const results = await Promise.allSettled(
    accounts.map(async (accountConfig) => {
      const { prompt, auditContext } = await buildPromptForAccount(accountConfig);
      const brief = await generateCampaignBrief({
        mode: 'freeform',
        prompt,
        countryCode: accountConfig.countryCode,
        auditContext,
      });
      const created = await createPausedCampaign(
        accountConfig.accountId,
        token,
        brief,
        brief.dailyBudgetMXN,
        accountConfig.countryCode,
        accountConfig.pageId,
      );
      await logCampaignGenerated(accountConfig.accountId, brief, created, 'weekly-cron');
      return { accountId: accountConfig.accountId, campaignId: created.campaignId, campaignName: brief.campaignName };
    }),
  );

  const summary = results.map((r, i) =>
    r.status === 'fulfilled'
      ? { accountId: accounts[i].accountId, ok: true, ...r.value }
      : { accountId: accounts[i].accountId, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );

  console.log('[cron/weekly-campaign] Resultado:', JSON.stringify(summary));

  return NextResponse.json({ summary });
}