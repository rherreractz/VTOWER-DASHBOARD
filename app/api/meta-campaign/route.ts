import { NextRequest, NextResponse } from 'next/server';
import { generateCampaignBrief, type CampaignObjective } from '@/lib/metaCampaignGenerator';
import { createPausedCampaign } from '@/lib/metaCampaignCreate';
import { logCampaignGenerated } from '@/lib/campaignHistoryStorage';
import { buildCampaignContext } from '@/lib/campaignAuditContext';

export const maxDuration = 60;

const VALID_OBJECTIVES: CampaignObjective[] = ['leads', 'ventas', 'trafico', 'reconocimiento', 'interaccion'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId: string | undefined = body?.accountId;
    const countryCode: string | undefined = body?.countryCode;
    const prompt: string | undefined = body?.prompt;
    const pageId: string | undefined = body?.pageId;
    const numVariantsRaw = Number(body?.numVariants);
    const numVariants = Number.isFinite(numVariantsRaw) && numVariantsRaw > 0 ? numVariantsRaw : undefined;

    if (!accountId || !accountId.startsWith('act_')) {
      return NextResponse.json({ error: 'accountId es requerido y debe tener el formato "act_1234567890".' }, { status: 400 });
    }

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Falta la variable de entorno META_ACCESS_TOKEN en el servidor.' }, { status: 500 });
    }

    // Cada campaña nueva (manual o automática) nace informada por la
    // última auditoría guardada de esta cuenta, si existe.
    const auditContext = await buildCampaignContext(accountId);

    let brief;

    if (prompt?.trim()) {
      // Modo prompt libre: Claude infiere objetivo y presupuesto del texto.
      brief = await generateCampaignBrief({ mode: 'freeform', prompt: prompt.trim(), countryCode, auditContext, numVariants });
    } else {
      // Modo estructurado: campos separados.
      const objective: string | undefined = body?.objective;
      const businessDescription: string | undefined = body?.businessDescription;
      const targetDescription: string | undefined = body?.targetDescription;
      const dailyBudgetMXN: number | undefined = Number(body?.dailyBudgetMXN);

      if (!objective || !VALID_OBJECTIVES.includes(objective as CampaignObjective)) {
        return NextResponse.json({ error: `objective debe ser uno de: ${VALID_OBJECTIVES.join(', ')}` }, { status: 400 });
      }
      if (!businessDescription?.trim() || !targetDescription?.trim()) {
        return NextResponse.json({ error: 'businessDescription y targetDescription son requeridos.' }, { status: 400 });
      }
      if (!Number.isFinite(dailyBudgetMXN) || (dailyBudgetMXN as number) <= 0) {
        return NextResponse.json({ error: 'dailyBudgetMXN debe ser un número mayor a 0.' }, { status: 400 });
      }

      brief = await generateCampaignBrief({
        mode: 'structured',
        objective: objective as CampaignObjective,
        businessDescription,
        targetDescription,
        dailyBudgetMXN: dailyBudgetMXN as number,
        countryCode,
        auditContext,
        numVariants,
      });
    }

    // 2. Se crea de verdad en Meta, SIEMPRE en PAUSED.
    const created = await createPausedCampaign(accountId, token, brief, brief.dailyBudgetMXN, countryCode, pageId);

    // 3. Registro en el historial (no bloquea la respuesta si falla).
    logCampaignGenerated(accountId, brief, created, 'manual').catch((err) =>
      console.error('[meta-campaign] Error al guardar el historial:', err),
    );

    return NextResponse.json({ brief, created });
  } catch (error) {
    console.error('[meta-campaign] Error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido al generar la campaña.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}