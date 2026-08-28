/**
 * Búsqueda de segmentación detallada real contra la API de Meta — ciudades
 * e intereses necesitan un ID/key interno de Meta, no basta con el nombre
 * en texto ("Cancún", "bienes raíces"). Este módulo resuelve nombres en
 * texto (los que sugiere Claude) a IDs reales antes de crear el Ad Set.
 *
 * Si una búsqueda no encuentra nada o falla, se omite esa segmentación en
 * particular (la campaña se sigue creando, solo con menos detalle) — nunca
 * bloquea la creación de la campaña por esto.
 */

const GRAPH_BASE = 'https://graph.facebook.com';

export interface GeoLocationResult {
  key: string;
  name: string;
  type: string;
  country_code?: string;
}

export interface InterestResult {
  id: string;
  name: string;
  audience_size_lower_bound?: number;
}

/** Busca una ciudad por nombre y regresa el mejor match (prioriza México si hay varias ciudades con el mismo nombre en distintos países). */
export async function searchCity(query: string, token: string, apiVersion = 'v22.0'): Promise<GeoLocationResult | null> {
  try {
    const url = new URL(`${GRAPH_BASE}/${apiVersion}/search`);
    url.searchParams.set('type', 'adgeolocation');
    url.searchParams.set('location_types', JSON.stringify(['city']));
    url.searchParams.set('q', query);
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`[metaTargetingSearch] Error ${res.status} buscando ciudad "${query}":`, await res.text());
      return null;
    }

    const data = await res.json();
    const results: GeoLocationResult[] = data.data ?? [];
    if (results.length === 0) return null;

    // Prioriza resultados de México si el país no se especificó en la búsqueda.
    const mexicanMatch = results.find((r) => r.country_code === 'MX');
    return mexicanMatch ?? results[0];
  } catch (error) {
    console.error(`[metaTargetingSearch] Error de red buscando ciudad "${query}":`, error);
    return null;
  }
}

/** Busca un interés por palabra clave y regresa el mejor match (el primero, que es el más relevante según Meta). */
export async function searchInterest(query: string, token: string, apiVersion = 'v22.0'): Promise<InterestResult | null> {
  try {
    const url = new URL(`${GRAPH_BASE}/${apiVersion}/search`);
    url.searchParams.set('type', 'adinterest');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`[metaTargetingSearch] Error ${res.status} buscando interés "${query}":`, await res.text());
      return null;
    }

    const data = await res.json();
    const results: InterestResult[] = data.data ?? [];
    return results[0] ?? null;
  } catch (error) {
    console.error(`[metaTargetingSearch] Error de red buscando interés "${query}":`, error);
    return null;
  }
}

/** Resuelve varias ciudades en paralelo, descartando las que no se encontraron. */
export async function resolveCities(
  queries: string[] | null | undefined,
  token: string,
  apiVersion = 'v22.0',
): Promise<GeoLocationResult[]> {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  const results = await Promise.all(queries.map((q) => searchCity(q, token, apiVersion)));
  return results.filter((r): r is GeoLocationResult => r !== null);
}

/** Resuelve varios intereses en paralelo, descartando los que no se encontraron. */
export async function resolveInterests(
  queries: string[] | null | undefined,
  token: string,
  apiVersion = 'v22.0',
): Promise<InterestResult[]> {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  const results = await Promise.all(queries.map((q) => searchInterest(q, token, apiVersion)));
  return results.filter((r): r is InterestResult => r !== null);
}