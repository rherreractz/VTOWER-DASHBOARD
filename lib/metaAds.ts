/**
 * Fetch de datos de la Marketing API de Meta (Facebook + Instagram).
 * Es un puerto a TypeScript de scripts/api/meta_fetch.py del repo
 * rherreractz/claude-ads, adaptado para correr server-side en Next.js.
 *
 * Variables de entorno requeridas (.env.local):
 *
 * META_ACCESS_TOKEN="EAA..."
 *   Token de la Marketing API (User token o, mejor, System User token que
 *   no caduca). Ver scripts/api/README.md del repo claude-ads para el setup.
 *
 * META_API_VERSION="v22.0"   (opcional, default v22.0)
 * META_PIXEL_ID="..."        (opcional, para incluir diagnóstico del pixel)
 */

const GRAPH_BASE = 'https://graph.facebook.com';

const CAMPAIGN_FIELDS =
  'id,name,objective,status,bid_strategy,daily_budget,lifetime_budget,buying_type,special_ad_categories,start_time,stop_time,created_time,updated_time';
const ADSET_FIELDS =
  'id,name,campaign_id,status,daily_budget,lifetime_budget,bid_strategy,billing_event,optimization_goal,attribution_spec,targeting,learning_stage_info,start_time,end_time,created_time';
const AD_FIELDS = 'id,name,adset_id,campaign_id,status,creative{id,name,object_type,thumbnail_url},created_time';
const INSIGHTS_FIELDS =
  'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,quality_ranking,engagement_rate_ranking,conversion_rate_ranking';
const AUDIENCE_FIELDS = 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status';
const ACCOUNT_FIELDS =
  'id,name,account_id,account_status,currency,timezone_name,amount_spent,balance,business_country_code,disable_reason,owner';
const PIXEL_FIELDS = 'id,name,last_fired_time,creation_time,is_unavailable,code';

interface GraphError {
  _error: { status: number | null; message: string; body?: unknown };
}

function isGraphError(value: unknown): value is GraphError {
  return !!value && typeof value === 'object' && '_error' in (value as object);
}

async function graphGet(
  path: string,
  params: Record<string, string>,
  token: string,
  apiVersion: string,
): Promise<any> {
  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`);
  Object.entries({ ...params, access_token: token }).forEach(([key, value]) => url.searchParams.set(key, value));

  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const body = await res.json();
    if (!res.ok) {
      return { _error: { status: res.status, message: `HTTP ${res.status}`, body } } satisfies GraphError;
    }
    return body;
  } catch (error) {
    return { _error: { status: null, message: error instanceof Error ? error.message : String(error) } } satisfies GraphError;
  }
}

async function paginate(
  path: string,
  params: Record<string, string>,
  token: string,
  apiVersion: string,
  maxPages = 20,
): Promise<any[]> {
  const items: any[] = [];
  let nextUrl: string | null = null;
  let page = 0;

  while (page < maxPages) {
    let resp: any;
    if (!nextUrl) {
      resp = await graphGet(path, params, token, apiVersion);
    } else {
      try {
        const res = await fetch(nextUrl, { headers: { Accept: 'application/json' } });
        resp = await res.json();
      } catch (error) {
        items.push({ _error: { status: null, message: error instanceof Error ? error.message : String(error) } });
        break;
      }
    }

    if (isGraphError(resp)) {
      items.push(resp);
      break;
    }

    items.push(...(resp.data ?? []));
    nextUrl = resp.paging?.next ?? null;
    if (!nextUrl) break;
    page += 1;
  }

  return items;
}

export interface MetaAdsData {
  platform: 'meta';
  account_id: string;
  fetched_at: string;
  data_source: 'direct_api';
  api_version: string;
  date_range: { since: string; until: string };
  errors: Array<Record<string, unknown>>;
  account?: unknown;
  campaigns?: unknown[];
  adsets?: unknown[];
  ads?: unknown[];
  customaudiences?: unknown[];
  insights?: unknown[];
  pixel?: unknown;
}

function defaultDateRange(): { since: string; until: string } {
  const today = new Date();
  const since = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
  return { since: since.toISOString().slice(0, 10), until: today.toISOString().slice(0, 10) };
}

export interface FetchMetaAdsOptions {
  accountId: string;
  token: string;
  since?: string;
  until?: string;
}

export async function fetchMetaAdsData({ accountId, token, since, until }: FetchMetaAdsOptions): Promise<MetaAdsData> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const defaults = defaultDateRange();
  const dateSince = since || defaults.since;
  const dateUntil = until || defaults.until;

  const result: MetaAdsData = {
    platform: 'meta',
    account_id: accountId,
    fetched_at: new Date().toISOString(),
    data_source: 'direct_api',
    api_version: apiVersion,
    date_range: { since: dateSince, until: dateUntil },
    errors: [],
  };

  function record(key: keyof MetaAdsData, payload: any) {
    if (isGraphError(payload)) {
      result.errors.push({ section: key, ...payload._error });
      return;
    }
    if (Array.isArray(payload)) {
      const errs = payload.filter(isGraphError) as GraphError[];
      if (errs.length) {
        errs.forEach((e) => result.errors.push({ section: key, ...e._error }));
        payload = payload.filter((p) => !isGraphError(p));
      }
    }
    (result as any)[key] = payload;
  }

  const [account, campaigns, adsets, ads, customaudiences, insights] = await Promise.all([
    graphGet(accountId, { fields: ACCOUNT_FIELDS }, token, apiVersion),
    paginate(`${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: '100' }, token, apiVersion),
    paginate(`${accountId}/adsets`, { fields: ADSET_FIELDS, limit: '100' }, token, apiVersion),
    paginate(`${accountId}/ads`, { fields: AD_FIELDS, limit: '100' }, token, apiVersion),
    paginate(`${accountId}/customaudiences`, { fields: AUDIENCE_FIELDS, limit: '100' }, token, apiVersion),
    paginate(
      `${accountId}/insights`,
      { level: 'ad', fields: INSIGHTS_FIELDS, time_range: JSON.stringify({ since: dateSince, until: dateUntil }), limit: '100' },
      token,
      apiVersion,
    ),
  ]);

  record('account', account);
  record('campaigns', campaigns);
  record('adsets', adsets);
  record('ads', ads);
  record('customaudiences', customaudiences);
  record('insights', insights);

  const pixelId = process.env.META_PIXEL_ID;
  if (pixelId) {
    const pixel = await graphGet(pixelId, { fields: PIXEL_FIELDS }, token, apiVersion);
    record('pixel', pixel);
  } else {
    result.errors.push({ section: 'pixel', message: 'META_PIXEL_ID no está configurado; se omitió el fetch del pixel.' });
  }

  return result;
}