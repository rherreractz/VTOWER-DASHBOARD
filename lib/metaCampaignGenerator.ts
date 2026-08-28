/**
 * Genera un brief de campaña de Meta Ads con Claude: nombre, objetivo,
 * presupuesto sugerido, targeting básico, y N variantes de copy para
 * probar. El resultado se usa en metaCampaignCreate.ts para crear la
 * Campaña + Ad Set de verdad en Meta, en estado PAUSED.
 *
 * Usa TOOL CALLING de la API de Claude (no le pedimos "responde solo
 * JSON" en texto libre) — la API garantiza que el objeto que regresa
 * cumple el schema exacto, sin que nosotros tengamos que parsear ni
 * reparar texto. Esto elimina de raíz los errores de "JSON inválido" que
 * pasaban cuando el copy del usuario traía comillas, saltos de línea, etc.
 */

export type CampaignObjective = 'leads' | 'ventas' | 'trafico' | 'reconocimiento' | 'interaccion';

export type CampaignBriefInput =
  | {
      mode: 'structured';
      objective: CampaignObjective;
      businessDescription: string;
      targetDescription: string;
      dailyBudgetMXN: number;
      countryCode?: string;
      /** Resumen de la última auditoría de Meta Ads de esta cuenta (ver lib/campaignAuditContext.ts). */
      auditContext?: string;
      /** Cuántas variantes de copy/anuncio generar. Default 3. */
      numVariants?: number;
    }
  | {
      mode: 'freeform';
      prompt: string;
      countryCode?: string;
      auditContext?: string;
      numVariants?: number;
    };

export interface AdCopyVariant {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
}

export interface CampaignBrief {
  campaignName: string;
  adSetName: string;
  objective: CampaignObjective;
  dailyBudgetMXN: number;
  ageMin: number;
  ageMax: number;
  genders: 'all' | 'men' | 'women';
  targetingSummary: string;
  /** Ciudades sugeridas para segmentación detallada, en texto (ej. "Cancún", "Ciudad de México") — se resuelven a IDs reales de Meta en metaCampaignCreate.ts. Vacío = solo país, sin restricción de ciudad. */
  suggestedCities: string[];
  /** Palabras clave de intereses sugeridas (ej. "bienes raíces", "inversión inmobiliaria") — se resuelven a IDs reales de Meta en metaCampaignCreate.ts. Vacío = sin segmentación detallada por interés. */
  suggestedInterestKeywords: string[];
  adCopyVariants: AdCopyVariant[];
  strategyNotes: string;
}

const AD_COPY_VARIANT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Máximo 40 caracteres' },
    primaryText: { type: 'string', description: 'Máximo 125 palabras' },
    description: { type: 'string', description: 'Máximo 30 caracteres' },
    cta: { type: 'string', description: "Texto de botón en español, ej. 'Más información'" },
  },
  required: ['headline', 'primaryText', 'description', 'cta'],
};

function baseSchemaProperties(numVariants: number) {
  return {
    campaignName: { type: 'string', description: 'Nombre corto y descriptivo, en español' },
    adSetName: { type: 'string', description: 'Nombre corto del ad set, en español' },
    ageMin: { type: 'integer', minimum: 18, maximum: 65 },
    ageMax: { type: 'integer', minimum: 18, maximum: 65 },
    genders: { type: 'string', enum: ['all', 'men', 'women'] },
    targetingSummary: { type: 'string', description: '1-2 frases en español de a quién le habla la campaña' },
    suggestedCities: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description:
        'Ciudades para segmentar, SOLO si el usuario las menciona explícitamente o el negocio claramente es local a una ciudad específica (ej. "Cancún" para un desarrollo inmobiliario ahí). Nombres de ciudad en texto simple, sin país (ej. "Cancún", no "Cancún, México"). Arreglo vacío si no aplica restringir por ciudad — no inventes ciudades si no hay pista clara.',
    },
    suggestedInterestKeywords: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description:
        'Palabras clave de intereses para segmentación detallada, relevantes al negocio y público (ej. "bienes raíces", "inversión inmobiliaria", "viajes de lujo"). 2-4 palabras clave razonables casi siempre ayudan — solo déjalo vacío si el negocio es demasiado genérico para tener intereses claros.',
    },
    adCopyVariants: {
      type: 'array',
      items: AD_COPY_VARIANT_SCHEMA,
      minItems: numVariants,
      maxItems: numVariants,
      description: `Exactamente ${numVariants} variante(s), cada una con un ángulo distinto — no repitas la misma idea con otras palabras`,
    },
    strategyNotes: { type: 'string', description: '2-3 frases en español explicando la estrategia' },
  };
}

function buildToolSchema(isFreeform: boolean, numVariants: number) {
  const base = baseSchemaProperties(numVariants);

  if (!isFreeform) {
    return {
      type: 'object',
      properties: base,
      required: [
        'campaignName',
        'adSetName',
        'ageMin',
        'ageMax',
        'genders',
        'targetingSummary',
        'suggestedCities',
        'suggestedInterestKeywords',
        'adCopyVariants',
        'strategyNotes',
      ],
    };
  }

  return {
    type: 'object',
    properties: {
      objective: { type: 'string', enum: ['leads', 'ventas', 'trafico', 'reconocimiento', 'interaccion'] },
      dailyBudgetMXN: {
        type: 'number',
        description: 'Si el usuario no menciona presupuesto, infiere uno razonable (300-500 MXN/día como punto de partida conservador)',
      },
      ...base,
      strategyNotes: {
        type: 'string',
        description: '2-3 frases en español explicando la estrategia Y qué información infirió que el usuario no dio explícitamente',
      },
    },
    required: [
      'objective',
      'dailyBudgetMXN',
      'campaignName',
      'adSetName',
      'ageMin',
      'ageMax',
      'genders',
      'targetingSummary',
      'suggestedCities',
      'suggestedInterestKeywords',
      'adCopyVariants',
      'strategyNotes',
    ],
  };
}

const TOOL_NAME = 'submit_campaign_brief';

export async function generateCampaignBrief(input: CampaignBriefInput): Promise<CampaignBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Falta la variable de entorno ANTHROPIC_API_KEY.');
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const isFreeform = input.mode === 'freeform';
  const numVariants = input.numVariants && input.numVariants > 0 ? Math.min(input.numVariants, 10) : 3;

  const systemPrompt = `Eres un estratega senior de Meta Ads (Facebook + Instagram), especializado en generar briefs de campaña listos para lanzar. Trabajas para una agencia que atiende clientes reales — tu copy debe sonar profesional y persuasivo, no genérico.

Si el usuario te da un copy base o texto ya escrito, úsalo como punto de partida para las variantes (ajústalo ligeramente por variante), no lo ignores ni inventes uno completamente distinto.

Si te dan contexto adicional de la cuenta, viene en dos partes distintas, úsalas activamente y de forma diferenciada:

1. Auditoría técnica de Meta Ads: prioriza corregir en esta campaña nueva los problemas de targeting/estructura que haya detectado, y aprovecha los quick wins como inspiración de ángulo — no los ignores ni los repitas literal.

2. Calidad real de los leads (histórica, medida por si de verdad avanzaron o se descartaron — no solo cuántos se registraron): si algún canal o campaña anterior muestra baja calidad (% bajo de leads que avanzaron), considera ajustar el ángulo del copy o el targeting para no repetir el mismo patrón; si alguno muestra alta calidad, puedes tomarlo como referencia de qué está funcionando. Menciona en strategyNotes qué de esta calidad histórica tomaste en cuenta, si aplica.

Sobre segmentación detallada (ciudades e intereses): si el usuario menciona ciudades o intereses específicos en su instrucción, respétalos exactamente en suggestedCities/suggestedInterestKeywords — esto tiene prioridad sobre cualquier otro criterio. Si no los menciona pero el negocio tiene una ubicación/interés obvio (ej. un desarrollo inmobiliario en una ciudad específica), sugiere algo razonable de todas formas — no dejes esto vacío solo por default, la segmentación amplia sin ningún detalle es la excepción, no la regla.

Llama a la herramienta "${TOOL_NAME}" con el brief completo. Responde SIEMPRE llamando a esa herramienta, nunca con texto plano.`;

  const auditSection = input.auditContext ? `\n\nContexto de la última auditoría de Meta Ads de esta cuenta:\n${input.auditContext}` : '';

  const userMessage = isFreeform
    ? `Esto es lo que pidió el usuario, tal cual, en un solo texto:\n\n"""\n${input.prompt}\n"""\n\nPaís: ${input.countryCode || 'MX'}${auditSection}`
    : `Genera el brief para esta campaña:

- Objetivo: ${input.objective}
- Descripción del negocio/producto: ${input.businessDescription}
- Público objetivo (descripción libre del cliente): ${input.targetDescription}
- Presupuesto diario: $${input.dailyBudgetMXN} MXN
- País: ${input.countryCode || 'MX'}${auditSection}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096 + Math.max(0, numVariants - 3) * 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Envía el brief de campaña completo, ya estructurado.',
          input_schema: buildToolSchema(isFreeform, numVariants),
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error de la API de Anthropic (${res.status}): ${errorText}`);
  }

  const json = await res.json();

  if (json.stop_reason === 'max_tokens') {
    throw new Error('La respuesta de Claude se cortó por max_tokens antes de terminar la herramienta. Sube el valor o pide menos variantes.');
  }

  const toolUseBlock = (json.content ?? []).find((block: any) => block.type === 'tool_use' && block.name === TOOL_NAME);
  if (!toolUseBlock?.input) {
    console.error('[metaCampaignGenerator] Respuesta sin tool_use:', JSON.stringify(json.content ?? [], null, 2).slice(0, 800));
    throw new Error('Claude no devolvió el brief a través de la herramienta esperada.');
  }

  // toolUseBlock.input YA es un objeto JS parseado por la API — no hace
  // falta JSON.parse ni reparación de texto.
  if (isFreeform) {
    return toolUseBlock.input as CampaignBrief;
  }

  const parsed = toolUseBlock.input as Omit<CampaignBrief, 'objective' | 'dailyBudgetMXN'>;
  return { ...parsed, objective: input.objective, dailyBudgetMXN: input.dailyBudgetMXN };
}