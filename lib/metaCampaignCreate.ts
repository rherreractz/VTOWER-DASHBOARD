import type { CampaignBrief, CampaignObjective } from './metaCampaignGenerator';
import { resolveCities, resolveInterests } from './metaTargetingSearch';

/**
 * Crea la estructura real de Campaña + Ad Set en Meta (Marketing API),
 * SIEMPRE en estado PAUSED — nunca se activa sola. Queda lista en Ads
 * Manager para que alguien la revise y la active con un clic, sin riesgo
 * de gasto accidental.
 *
 * IMPORTANTE: esto SÍ escribe en la cuenta real del cliente (a diferencia
 * de metaAds.ts, que solo lee). El token META_ACCESS_TOKEN necesita el
 * scope ads_management (no solo ads_read) para que esto funcione.
 *
 * Deliberadamente NO se crea el anuncio (Ad) final con creativo/imagen —
 * eso requiere una Página de Facebook conectada y assets visuales, que
 * quedan fuera de este alcance. El copy generado se muestra en el
 * dashboard para pegarlo manualmente al crear el anuncio en Ads Manager.
 */

const GRAPH_BASE = 'https://graph.facebook.com';

const OBJECTIVE_MAP: Record<CampaignObjective, { objective: string; optimization_goal: string; billing_event: string }> = {
  leads: { objective: 'OUTCOME_LEADS', optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS' },
  ventas: { objective: 'OUTCOME_SALES', optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
  trafico: { objective: 'OUTCOME_TRAFFIC', optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS' },
  reconocimiento: { objective: 'OUTCOME_AWARENESS', optimization_goal: 'REACH', billing_event: 'IMPRESSIONS' },
  interaccion: { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'POST_ENGAGEMENT', billing_event: 'IMPRESSIONS' },
};

const GENDER_MAP: Record<CampaignBrief['genders'], number[] | undefined> = {
  all: undefined,
  men: [1],
  women: [2],
};

interface GraphError {
  _error: { status: number; message: string; body: unknown };
}

function isGraphError(value: unknown): value is GraphError {
  return !!value && typeof value === 'object' && '_error' in (value as object);
}

async function graphPost(path: string, params: Record<string, unknown>, token: string, apiVersion: string): Promise<any> {
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
    const detailedMessage = [
      err.error_user_title,
      err.error_user_msg,
      err.message,
      err.error_subcode ? `(subcode ${err.error_subcode})` : null,
      err.fbtrace_id ? `[trace: ${err.fbtrace_id}]` : null,
    ]
      .filter(Boolean)
      .join(' — ');

    console.error(`[metaCampaignCreate] POST ${path} falló. Params enviados:`, params);
    console.error(`[metaCampaignCreate] Respuesta completa de Meta:`, JSON.stringify(data, null, 2));

    return {
      _error: { status: res.status, message: detailedMessage || `HTTP ${res.status}`, body: data },
    } satisfies GraphError;
  }

  return data;
}

export interface CreatePausedCampaignResult {
  campaignId: string;
  adSetId: string;
  adsManagerUrl: string;
  /** Qué ciudades/intereses de los sugeridos por Claude sí se lograron resolver y aplicar de verdad — para mostrárselo al usuario, no queda "invisible". */
  appliedTargeting: {
    cities: string[];
    interests: string[];
    unresolvedCities: string[];
    unresolvedInterests: string[];
  };
}

export async function createPausedCampaign(
  accountId: string,
  token: string,
  brief: CampaignBrief,
  dailyBudgetMXN: number,
  countryCode = 'MX',
  pageId?: string,
): Promise<CreatePausedCampaignResult> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const mapping = OBJECTIVE_MAP[brief.objective];

  // 1. Campaña, PAUSED desde el día uno.
  const campaign = await graphPost(
    `${accountId}/campaigns`,
    {
      name: brief.campaignName,
      objective: mapping.objective,
      status: 'PAUSED',
      special_ad_categories: [],
      buying_type: 'AUCTION',
      // Requerido por Meta cuando el presupuesto se maneja a nivel Ad Set
      // (ABO, nuestro caso) en vez de a nivel Campaña (CBO). false = cada
      // ad set usa su propio presupuesto sin compartir con otros.
      is_adset_budget_sharing_enabled: false,
    },
    token,
    apiVersion,
  );

  if (isGraphError(campaign)) {
    throw new Error(`No se pudo crear la campaña en Meta: ${campaign._error.message}`);
  }

  const campaignId: string = campaign.id;

  // 2. Ad Set, también PAUSED, con el targeting y presupuesto del brief.
  // Base amplia (país + edad + género) que se acota con ciudades/intereses
  // reales más abajo, SOLO cuando Claude los sugirió y se lograron
  // resolver contra la API de Meta — nunca se inventa un ID.
  const genders = GENDER_MAP[brief.genders];

  // Segmentación detallada real (ciudades + intereses) — se resuelven
  // contra la API de Meta a partir de lo que sugirió Claude en el brief.
  // Si algo no se encuentra, simplemente se omite (no bloquea la campaña).
  const [resolvedCities, resolvedInterests] = await Promise.all([
    brief.suggestedCities?.length ? resolveCities(brief.suggestedCities, token, apiVersion) : Promise.resolve([]),
    brief.suggestedInterestKeywords?.length ? resolveInterests(brief.suggestedInterestKeywords, token, apiVersion) : Promise.resolve([]),
  ]);

  const unresolvedCities = (brief.suggestedCities ?? []).filter(
    (q) => !resolvedCities.some((c) => c.name.toLowerCase().includes(q.toLowerCase())),
  );
  const unresolvedInterests = (brief.suggestedInterestKeywords ?? []).filter(
    (q) => !resolvedInterests.some((i) => i.name.toLowerCase().includes(q.toLowerCase())),
  );

  // Meta exige un "promoted_object" en el Ad Set para varios objetivos —
  // sin esto, la creación del Ad final falla con "Invalid parameter"
  // (subcode 1885154). Para leads/reconocimiento/interacción, el objeto
  // promocionado es la Página; para tráfico/ventas no hace falta (van por
  // el link del creativo).
  const needsPromotedObject = brief.objective === 'leads' || brief.objective === 'reconocimiento' || brief.objective === 'interaccion';
  if (needsPromotedObject && !pageId) {
    throw new Error(
      `El objetivo "${brief.objective}" requiere un Page ID (promoted_object) para crear el Ad Set. Llena el campo "Page ID de Facebook" antes de generar.`,
    );
  }

  const adSet = await graphPost(
    `${accountId}/adsets`,
    {
      name: brief.adSetName,
      campaign_id: campaignId,
      status: 'PAUSED',
      daily_budget: Math.round(dailyBudgetMXN * 100), // Meta espera centavos
      billing_event: mapping.billing_event,
      optimization_goal: mapping.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      ...(needsPromotedObject ? { promoted_object: { page_id: pageId } } : {}),
      // Requerido por Meta para poder usar Formulario Instantáneo al crear
      // el Ad después. Estuvo desactivado temporalmente por un bug de Meta
      // (subcode 1815089, "Condiciones del servicio no aceptadas" pese a
      // que sí estaban aceptadas) — confirmado resuelto el 14 de agosto de
      // 2026 con una prueba directa vía API (Ad Set creado sin error). Si
      // el bug regresara, comenta la línea de abajo como respaldo.
      ...(brief.objective === 'leads' ? { destination_type: 'ON_AD' } : {}),
      targeting: {
        geo_locations:
          resolvedCities.length > 0
            ? // Si se resolvieron ciudades, se targetea SOLO esas ciudades
              // (sin "countries" — Meta trata país + ciudades como "cualquiera
              // de los dos", lo que seguiría siendo todo el país y anularía
              // el propósito de acotar por ciudad).
              { cities: resolvedCities.map((c) => ({ key: c.key, radius: 25, distance_unit: 'kilometer' })) }
            : { countries: [countryCode] },
        age_min: brief.ageMin,
        age_max: brief.ageMax,
        ...(genders ? { genders } : {}),
        ...(resolvedInterests.length > 0
          ? { flexible_spec: [{ interests: resolvedInterests.map((i) => ({ id: i.id, name: i.name })) }] }
          : {}),
        // Requerido por Meta desde 2026: hay que decidir explícitamente si
        // se activa Advantage+ Audience (Meta puede expandir el targeting
        // más allá de lo que definiste, si detecta que rinde mejor). En 0
        // (desactivado) para que el targeting se quede exacto como lo
        // generó Claude — cámbialo a 1 si prefieres dejar que Meta expanda.
        targeting_automation: { advantage_audience: 0 },
      },
      start_time: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min en el futuro, requerido por la API aunque esté PAUSED
    },
    token,
    apiVersion,
  );

  if (isGraphError(adSet)) {
    // Si el ad set falla, la campaña quedó creada (vacía) — lo dejamos así
    // en vez de borrarla, para no complicar el flujo; queda visible en Ads
    // Manager como borrador sin ad sets.
    throw new Error(`La campaña se creó, pero no se pudo crear el Ad Set: ${adSet._error.message}`);
  }

  const adSetId: string = adSet.id;

  return {
    campaignId,
    adSetId,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace('act_', '')}&selected_campaign_ids=${campaignId}`,
    appliedTargeting: {
      cities: resolvedCities.map((c) => c.name),
      interests: resolvedInterests.map((i) => i.name),
      unresolvedCities,
      unresolvedInterests,
    },
  };
}