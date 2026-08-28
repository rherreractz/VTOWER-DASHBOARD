import { AUDIT_CATEGORIES, CONTEXT_NOTES, type AuditCategory } from './metaAuditChecklist';
import type { MetaAdsData } from './metaAds';

/**
 * Cada categoría solo necesita una parte de los datos de la cuenta, no
 * todo. Mandar el objeto completo en las 4 llamadas paralelas multiplica
 * por 4 el tamaño del payload y puede chocar con el límite de tokens de
 * entrada por minuto de la organización en cuentas con muchas campañas/
 * anuncios. Esta función arma una copia recortada por categoría.
 */
function scopeDataForCategory(data: MetaAdsData, categoryKey: string): Partial<MetaAdsData> {
  const base = {
    platform: data.platform,
    account_id: data.account_id,
    date_range: data.date_range,
    errors: data.errors,
  };

  const MAX_ROWS = 300;
  const cappedInsights = data.insights ? (data.insights as unknown[]).slice(0, MAX_ROWS) : undefined;
  const cappedAds = data.ads ? (data.ads as unknown[]).slice(0, MAX_ROWS) : undefined;

  switch (categoryKey) {
    case 'pixel_capi':
      return { ...base, account: data.account, pixel: data.pixel };
    case 'creative':
      return { ...base, ads: cappedAds, insights: cappedInsights };
    case 'account_structure':
      return { ...base, account: data.account, campaigns: data.campaigns, adsets: data.adsets, insights: cappedInsights };
    case 'audience_targeting':
      return { ...base, adsets: data.adsets, customaudiences: data.customaudiences };
    default:
      return data;
  }
}

/**
 * Corre la auditoría de Meta Ads llamando a la API de Claude directamente
 * (no usa Claude Code). En vez de pedir los 50 checks en una sola llamada
 * gigante (que se corta antes de terminar el JSON incluso con max_tokens
 * alto), se hacen 4 llamadas PARALELAS, una por categoría — cada una con un
 * checklist pequeño y un JSON de salida pequeño, mucho más confiable.
 * health_score, grade, quick_wins y critical_issues se calculan en código
 * a partir de los checks ya combinados, no se le pide a Claude que los
 * calcule (menos superficie de error).
 *
 * Variable de entorno requerida:
 * ANTHROPIC_API_KEY="sk-ant-..."
 *
 * Modelo configurable vía ANTHROPIC_MODEL (default: claude-sonnet-5).
 */

interface RawCheck {
  id: string;
  category?: string;
  name?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  result: 'PASS' | 'WARNING' | 'FAIL' | 'N/A';
  finding?: string;
  recommendation?: string;
  fix_time_minutes?: number | null;
}

interface CategoryAuditResponse {
  score: number;
  checks: RawCheck[];
}

export interface MetaAuditResult {
  platform: 'meta';
  version: string;
  generated_at: string;
  account_id?: string;
  data_source?: string;
  health_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  category_scores: Record<string, { score: number; weight: number }>;
  checks: RawCheck[];
  quick_wins: Array<{ check_id: string; action: string; impact_estimate?: string; effort_minutes: number }>;
  critical_issues: Array<{ check_id: string; blocker_reason: string; estimated_revenue_at_risk?: string | null }>;
  notes?: string;
}

const CATEGORY_OUTPUT_INSTRUCTIONS = `
Devuelve EXCLUSIVAMENTE un objeto JSON (sin \`\`\`json, sin texto antes o después), con esta forma exacta:

{
  "score": <número 0-100, qué tan saludable está esta categoría según los checks>,
  "checks": [
    {
      "id": "<el ID exacto del checklist, ej. M01>",
      "name": "<título corto del check, en español>",
      "severity": "critical"|"high"|"medium"|"low",
      "result": "PASS"|"WARNING"|"FAIL"|"N/A",
      "finding": "<qué se observó en los datos, en español, máximo 20 palabras>",
      "recommendation": "<qué hacer al respecto, en español, máximo 20 palabras; cadena vacía si PASS>",
      "fix_time_minutes": <número o null>
    }
    ... (incluye TODOS los checks del checklist de esta categoría, en el mismo orden, ni uno menos)
  ]
}

Reglas:
- Si un check no se puede evaluar por falta de datos, márcalo "N/A" y explica en "finding" qué dato faltó — nunca inventes un resultado.
- "score" es tu evaluación general de la categoría (0-100), no un promedio mecánico — considera severidad de las fallas.
- Todo el texto debe estar en español, corto y directo.

REGLAS DE FORMATO JSON (revísalas antes de responder):
- JSON válido, parseable por JSON.parse() sin ajustes manuales.
- Comillas dobles siempre, nunca comillas simples.
- Sin comas colgantes (trailing commas) después del último elemento.
- Sin comentarios dentro del JSON.
- Escapa comillas dobles dentro de strings como \\".
- No uses saltos de línea literales dentro de un valor string; usa espacios.
- No trunques la respuesta: el JSON debe terminar con su "}" de cierre.

IMPORTANTE: tu respuesta completa debe ser ÚNICAMENTE el objeto JSON. No escribas
ningún razonamiento, cálculo, explicación, ni texto de ningún tipo antes o
después del JSON — ni una sola palabra fuera de las llaves { }. Si necesitas
hacer cálculos (ej. presupuesto vs CPA, frecuencia), hazlos mentalmente y
escribe solo el resultado final dentro de "finding", nunca el proceso.
`;

async function runCategoryAudit(category: AuditCategory, data: MetaAdsData, apiKey: string, model: string): Promise<CategoryAuditResponse> {
  const scopedData = scopeDataForCategory(data, category.key);

  const systemPrompt = `Eres un auditor experto de Meta Ads (Facebook + Instagram). Evalúa SOLO la categoría "${category.label}" de la cuenta publicitaria del cliente, usando este checklist:

${category.checklist}

${CONTEXT_NOTES}

${CATEGORY_OUTPUT_INSTRUCTIONS}`;

  const userMessage = `Datos reales de la cuenta de Meta Ads (Marketing API), recortados a lo relevante para la categoría "${category.label}". Evalúa cada check usando SOLO estos datos; no inventes información. Si algún dato no viene aquí porque no aplica a esta categoría, márcalo "N/A".

Rango de fechas: ${data.date_range.since} a ${data.date_range.until}

\`\`\`json
${JSON.stringify(scopedData, null, 2)}
\`\`\``;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`[${category.label}] Error de la API de Anthropic (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const wasTruncated = json.stop_reason === 'max_tokens';

  const textBlock = (json.content ?? []).find((block: any) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error(`[${category.label}] La respuesta de Claude no incluyó ningún bloque de texto.`);
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/[\r\n\t]+/g, ' ');

  const repaired = cleaned.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(repaired) as CategoryAuditResponse;
    parsed.checks = (parsed.checks ?? []).map((check) => ({ ...check, category: category.label }));
    return parsed;
  } catch (error) {
    if (wasTruncated) {
      const lastCompleteObject = repaired.lastIndexOf('},');
      if (lastCompleteObject > 0) {
        const salvaged = `${repaired.slice(0, lastCompleteObject + 1)}]}`;
        try {
          const parsed = JSON.parse(salvaged) as CategoryAuditResponse;
          parsed.checks = (parsed.checks ?? []).map((check) => ({ ...check, category: category.label }));
          console.error(
            `[metaAudit] [${category.label}] Se cortó por max_tokens; se rescataron ${parsed.checks.length} checks completos de esta categoría.`,
          );
          return { score: parsed.score ?? 50, checks: parsed.checks };
        } catch {
          // sigue abajo al error original si el rescate también falla
        }
      }
      throw new Error(
        `[${category.label}] La respuesta de Claude se cortó por max_tokens y no se pudo rescatar ningún check completo. Sube max_tokens en lib/metaAudit.ts.`,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[metaAudit] [${category.label}] JSON inválido. Texto crudo:`, cleaned.slice(0, 500));
    throw new Error(`[${category.label}] No se pudo interpretar el JSON de Claude: ${message}`);
  }
}

function gradeFromScore(score: number): MetaAuditResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export async function runMetaAudit(data: MetaAdsData): Promise<MetaAuditResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Falta la variable de entorno ANTHROPIC_API_KEY.');
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const results = await Promise.all(
    AUDIT_CATEGORIES.map((category) => runCategoryAudit(category, data, apiKey, model)),
  );

  const category_scores: MetaAuditResult['category_scores'] = {};
  const allChecks: RawCheck[] = [];

  AUDIT_CATEGORIES.forEach((category, index) => {
    const result = results[index];
    category_scores[category.key] = { score: result.score, weight: category.weight };
    allChecks.push(...result.checks);
  });

  const health_score = AUDIT_CATEGORIES.reduce(
    (sum, category, index) => sum + results[index].score * category.weight,
    0,
  );

  const quick_wins = allChecks
    .filter(
      (check) =>
        (check.severity === 'critical' || check.severity === 'high') &&
        check.result !== 'PASS' &&
        check.result !== 'N/A' &&
        typeof check.fix_time_minutes === 'number' &&
        check.fix_time_minutes <= 15,
    )
    .sort((a, b) => (a.fix_time_minutes ?? 0) - (b.fix_time_minutes ?? 0))
    .map((check) => ({
      check_id: check.id,
      action: check.recommendation || check.finding || '',
      effort_minutes: check.fix_time_minutes ?? 0,
    }));

  const critical_issues = allChecks
    .filter((check) => check.severity === 'critical' && check.result === 'FAIL')
    .map((check) => ({
      check_id: check.id,
      blocker_reason: check.finding || check.name || 'Revisar este check crítico.',
    }));

  return {
    platform: 'meta',
    version: '1.0',
    generated_at: new Date().toISOString(),
    account_id: data.account_id,
    data_source: data.data_source,
    health_score,
    grade: gradeFromScore(health_score),
    category_scores,
    checks: allChecks,
    quick_wins,
    critical_issues,
  };
}